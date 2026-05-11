import * as vscode from 'vscode';
import * as k8s from '@kubernetes/client-node';
import * as jsYaml from 'js-yaml';
import { Logger } from '../util/Logger';
import { TokenManager } from '../auth/TokenManager';
import { ClusterDiscovery } from '../auth/ClusterDiscovery';
import { KubeClientFactory } from '../kubernetes/KubeClientFactory';
import { execOnPod } from '../kubernetes/execHelper';
import { STATE_CACHED_TOKEN, SIDECAR_PREFIXES } from '../constants';

export interface ActiveConnectionInfo {
  workspaceName: string;
  namespace: string;
  devworkspaceId: string;
  clusterUrl: string;
  hostAlias?: string;
  sshUsername?: string;
  localPort?: number;
  projectFolder?: string;
}

/**
 * Register commands available in the remote session (connected to a workspace).
 * These use the stored connection info + token to interact with the K8s API.
 */
export function registerRemoteCommands(
  context: vscode.ExtensionContext,
  conn: ActiveConnectionInfo
): void {
  const logger = Logger.getInstance();
  const tokenManager = new TokenManager(context.globalState);
  const clusterDiscovery = new ClusterDiscovery();
  const kubeClientFactory = new KubeClientFactory();

  async function getKubeConfig(): Promise<k8s.KubeConfig> {
    let accessToken: string | undefined;
    const storedToken = await tokenManager.getToken(conn.clusterUrl);
    if (storedToken && tokenManager.isTokenValid(storedToken)) {
      accessToken = storedToken.accessToken;
    }
    if (!accessToken) {
      accessToken = context.globalState.get<string>(STATE_CACHED_TOKEN);
    }
    if (!accessToken) { throw new Error('Not authenticated — please sign in again.'); }
    const endpoints = await clusterDiscovery.discover(conn.clusterUrl);
    return kubeClientFactory.createConfig(endpoints.apiUrl, accessToken);
  }

  function getCustomApi(kc: k8s.KubeConfig): k8s.CustomObjectsApi {
    return kc.makeApiClient(k8s.CustomObjectsApi);
  }

  const DW = { group: 'workspace.devfile.io', version: 'v1alpha2', plural: 'devworkspaces' };

  async function patchWorkspace(customApi: k8s.CustomObjectsApi, body: any[]): Promise<void> {
    await customApi.patchNamespacedCustomObject({
      ...DW, namespace: conn.namespace, name: conn.workspaceName, body,
    });
  }

  async function getWorkspacePhase(customApi: k8s.CustomObjectsApi): Promise<string> {
    const dw = await customApi.getNamespacedCustomObject({
      ...DW, namespace: conn.namespace, name: conn.workspaceName,
    }) as any;
    return dw?.status?.phase ?? 'Unknown';
  }

  async function waitForPhase(
    customApi: k8s.CustomObjectsApi,
    targetPhases: string[],
    failPhases: string[] = ['Failed'],
    timeoutMs = 120_000
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      const phase = await getWorkspacePhase(customApi);
      if (targetPhases.includes(phase)) { return phase; }
      if (failPhases.includes(phase)) {
        throw new Error(`Workspace entered ${phase} state`);
      }
    }
    throw new Error(`Timed out waiting for workspace to reach ${targetPhases.join('/')}`);
  }

  // --- Stop Workspace ---
  context.subscriptions.push(
    vscode.commands.registerCommand('devspaces.stopWorkspace', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Stop this workspace? The remote session will close.',
        { modal: true }, 'Stop'
      );
      if (confirm !== 'Stop') { return; }
      try {
        const kc = await getKubeConfig();
        await patchWorkspace(getCustomApi(kc), [
          { op: 'replace', path: '/spec/started', value: false },
        ]);
        vscode.window.showInformationMessage('Workspace stopping...');
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to stop workspace: ${err instanceof Error ? err.message : err}`);
      }
    })
  );

  // --- Restart Workspace ---
  context.subscriptions.push(
    vscode.commands.registerCommand('devspaces.restartWorkspace', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Restart this workspace? The remote session will reconnect.',
        { modal: true }, 'Restart'
      );
      if (confirm !== 'Restart') { return; }
      try {
        const kc = await getKubeConfig();
        const api = getCustomApi(kc);
        await patchWorkspace(api, [{ op: 'replace', path: '/spec/started', value: false }]);
        await waitForPhase(api, ['Stopped', 'Failed']);
        await patchWorkspace(api, [{ op: 'replace', path: '/spec/started', value: true }]);
        await waitForPhase(api, ['Running']);
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to restart workspace: ${err instanceof Error ? err.message : err}`);
      }
    })
  );

  // --- Restart from Local Devfile ---
  context.subscriptions.push(
    vscode.commands.registerCommand('devspaces.restartFromLocalDevfile', async () => {
      try {
        const kc = await getKubeConfig();

        // Find the pod and main container
        const coreApi = kc.makeApiClient(k8s.CoreV1Api);
        const podList = await coreApi.listNamespacedPod({
          namespace: conn.namespace,
          labelSelector: `controller.devfile.io/devworkspace_id=${conn.devworkspaceId}`,
        });
        if (podList.items.length === 0) { throw new Error('Workspace pod not found'); }
        const pod = podList.items[0];
        const podName = pod.metadata?.name ?? '';
        const containers = pod.spec?.containers ?? [];
        const mainContainer = containers.find(
          (c) => !SIDECAR_PREFIXES.some((p) => c.name.startsWith(p))
        ) ?? containers[0];
        const containerName = mainContainer?.name ?? 'tools';

        // Helper: exec a command on the pod
        const execCmd = (cmd: string) => execOnPod(kc, conn.namespace, podName, containerName, cmd);

        // Scan for devfiles
        const findResult = await execCmd(
          'find /projects -maxdepth 2 \\( -name "devfile.yaml" -o -name ".devfile.yaml" -o -name "devfile.yml" -o -name ".devfile.yml" \\) -type f 2>/dev/null'
        );
        const devfiles = findResult.split('\n').filter((f) => f.trim().length > 0);

        // Build quick pick
        const items: vscode.QuickPickItem[] = devfiles.map((f) => ({
          label: f,
          detail: f.split('/').slice(2, 3).join('/'),
        }));
        items.push({ kind: vscode.QuickPickItemKind.Separator, label: '' });
        items.push({ label: '/projects/*', detail: 'Select a Devfile with a different name' });

        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: 'Select a Devfile to be applied to the current workspace',
        });
        if (!picked) { return; }

        let devfilePath: string;
        if (picked.label === '/projects/*') {
          const typed = await vscode.window.showInputBox({
            prompt: 'Enter the full path to the devfile on the workspace',
            placeHolder: '/projects/my-app/my-devfile.yaml',
            ignoreFocusOut: true,
          });
          if (!typed) { return; }
          devfilePath = typed.trim();
        } else {
          devfilePath = picked.label;
        }

        // Confirm
        const action = await vscode.window.showWarningMessage(
          `Restart workspace from ${devfilePath}? This will update the workspace configuration and restart.`,
          { modal: true }, 'Restart'
        );
        if (action !== 'Restart') { return; }

        // Validate and read devfile from pod
        if (/[\x00-\x1f]/.test(devfilePath)) {
          throw new Error('Invalid devfile path: contains control characters');
        }
        const safePath = devfilePath.replace(/'/g, "'\\''");
        const devfileContent = await execCmd(`cat -- '${safePath}'`);

        // Get current DevWorkspace CR
        const api = getCustomApi(kc);
        const dw = await api.getNamespacedCustomObject({
          ...DW, namespace: conn.namespace, name: conn.workspaceName,
        }) as any;

        // Parse and merge
        const localDevfile = jsYaml.load(devfileContent) as Record<string, any>;
        const currentTemplate = dw.spec?.template ?? {};
        const updatedTemplate: any = { ...currentTemplate };

        if (localDevfile.components) {
          const editorComponents = (currentTemplate.components ?? []).filter(
            (c: any) => c.container && SIDECAR_PREFIXES.some((p) => c.name.startsWith(p))
          );
          updatedTemplate.components = [...localDevfile.components, ...editorComponents];
        }
        if (localDevfile.commands) {
          updatedTemplate.commands = localDevfile.commands;
        }

        // Patch, stop, wait, start, wait, reload
        await patchWorkspace(api, [
          { op: 'replace', path: '/spec/template', value: updatedTemplate },
          { op: 'replace', path: '/spec/started', value: false },
        ]);
        await waitForPhase(api, ['Stopped', 'Failed']);
        await patchWorkspace(api, [{ op: 'replace', path: '/spec/started', value: true }]);
        await waitForPhase(api, ['Running']);
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
      } catch (err) {
        vscode.window.showErrorMessage(
          `Failed to restart from devfile: ${err instanceof Error ? err.message : err}`
        );
      }
    })
  );

  // --- Open Dashboard ---
  context.subscriptions.push(
    vscode.commands.registerCommand('devspaces.openInDashboard', async () => {
      const dashboardUrl = `${conn.clusterUrl}/dashboard/#/workspaces`;
      await vscode.env.openExternal(vscode.Uri.parse(dashboardUrl));
    })
  );

  logger.info('Remote commands registered');
}
