import * as vscode from 'vscode';
import * as stream from 'stream';
import * as crypto from 'crypto';
import * as k8s from '@kubernetes/client-node';
import { Logger } from '../util/Logger';
import { DW_API_GROUP, DW_API_VERSION, DW_PLURAL } from '../constants';
import { DevWorkspaceResource } from '../kubernetes/DevWorkspaceTypes';
import { getServerConfig } from './ServerConfig';
import { installServerViaExec } from './ServerSetup';
import { WorkspaceConnectionInfo } from './DevSpacesResolver';

type WorkspacePhase = 'Running' | 'Starting' | 'Stopping' | 'Stopped' | 'Failed' | 'NotFound' | 'Unknown';

export interface StatusMonitorDeps {
  getKubeConfig: (clusterUrl: string) => Promise<k8s.KubeConfig | undefined>;
  findWorkspacePod: (kubeConfig: k8s.KubeConfig, namespace: string, devworkspaceId: string) => Promise<{ podName: string; containerName: string }>;
  checkAndStartWorkspace: (clusterUrl: string, namespace: string, workspaceName: string) => Promise<'running' | 'started' | 'failed' | 'auth_failed' | 'not_found'>;
}

/**
 * Monitors workspace pod health and handles pod death/recovery.
 *
 * Polls pod health every 5 seconds. When the pod dies:
 * 1. Waits for DevWorkspace phase to reach "Running"
 * 2. Waits for NEW pod (different name from lastResolvedPodName)
 * 3. Pre-installs server on new pod with stable connection token
 * 4. Auto-reloads the window
 *
 * This beats the IDE's internal reconnection timeout (~15-20s) so the user
 * sees a clean reload instead of the "Cannot reconnect" dialog.
 */
export class WorkspaceStatusMonitor implements vscode.Disposable {
  private logger = Logger.getInstance();
  private statusPoller: ReturnType<typeof setInterval> | undefined;
  private isHandlingPodDeath = false;

  constructor(
    private deps: StatusMonitorDeps,
    private kubeConfig: k8s.KubeConfig,
    private lastResolvedPodName: string,
    private stableConnectionToken: string | undefined
  ) {}

  /**
   * Start polling pod health for the given workspace connection.
   */
  start(connInfo: WorkspaceConnectionInfo): void {
    this.stop();

    this.statusPoller = setInterval(async () => {
      if (this.isHandlingPodDeath) { return; }

      try {
        const phase = await this.queryWorkspacePhase(connInfo);

        if (phase === 'NotFound') {
          this.stop();
          await this.showWorkspaceDeletedDialog(connInfo);
          return;
        }

        if (phase === 'Stopped' || phase === 'Failed') {
          this.stop();
          await this.showWorkspaceStoppedDialog(connInfo);
          return;
        }

        // Check if the pod is still alive
        try {
          const { podName } = await this.deps.findWorkspacePod(this.kubeConfig, connInfo.namespace, connInfo.devworkspaceId);
          if (this.lastResolvedPodName && podName !== this.lastResolvedPodName) {
            this.isHandlingPodDeath = true;
            this.logger.info(`Pod changed: ${this.lastResolvedPodName} → ${podName}. Pre-installing server...`);
            await this.handlePodRecovery(connInfo);
          }
        } catch {
          this.isHandlingPodDeath = true;
          this.logger.info('Pod not found, waiting for new pod before reloading...');
          await this.handlePodRecovery(connInfo);
        }
      } catch (err) {
        this.logger.debug(`Status poll error: ${err}`);
      }
    }, 5_000);
  }

  stop(): void {
    if (this.statusPoller) {
      clearInterval(this.statusPoller);
      this.statusPoller = undefined;
    }
  }

  dispose(): void {
    this.stop();
  }

  // ─── Pod Recovery ────────────────────────────────────────────────────────

  /**
   * Unified pod recovery: wait for workspace Running → wait for new pod → pre-install → reload.
   */
  private async handlePodRecovery(connInfo: WorkspaceConnectionInfo): Promise<void> {
    try {
      this.logger.info('Waiting for DevWorkspace phase to reach Running...');
      const phaseReached = await this.waitForPhase(connInfo, 'Running', 300_000);
      if (!phaseReached) {
        this.logger.warn('DevWorkspace did not reach Running phase');
        this.stop();
        await this.showWorkspaceStoppedDialog(connInfo);
        return;
      }

      this.logger.info('Waiting for new pod to be ready...');
      const { podName, containerName } = await this.waitForNewPod(connInfo, 120_000);

      this.logger.info(`Pre-installing server on ${podName}/${containerName}...`);
      const serverConfig = await getServerConfig();
      const token = this.stableConnectionToken || crypto.randomUUID();
      await installServerViaExec(
        this.kubeConfig, connInfo.namespace, podName, containerName, serverConfig, token
      );

      this.logger.info('Server pre-installed, reloading window...');
      this.stop();
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    } catch (err) {
      this.logger.error(`Pod recovery failed: ${err}`);
      this.isHandlingPodDeath = false;
    }
  }

  // ─── Workspace Phase Queries ─────────────────────────────────────────────

  async queryWorkspacePhase(connInfo: WorkspaceConnectionInfo): Promise<WorkspacePhase> {
    try {
      const kc = this.kubeConfig ?? await this.deps.getKubeConfig(connInfo.clusterUrl);
      if (!kc) { return 'Unknown'; }

      const customApi = kc.makeApiClient(k8s.CustomObjectsApi);
      const dw = await customApi.getNamespacedCustomObject({
        group: DW_API_GROUP,
        version: DW_API_VERSION,
        namespace: connInfo.namespace,
        plural: DW_PLURAL,
        name: connInfo.workspaceName,
      }) as DevWorkspaceResource;

      const phase = dw?.status?.phase;
      if (phase === 'Failing') { return 'Failed'; }
      const valid: WorkspacePhase[] = ['Running', 'Starting', 'Stopping', 'Stopped', 'Failed'];
      return (phase && valid.includes(phase as WorkspacePhase)) ? phase as WorkspacePhase : 'Unknown';
    } catch (err: any) {
      if (isNotFoundError(err)) {
        this.logger.warn(`Workspace ${connInfo.workspaceName} not found (404) — deleted?`);
        return 'NotFound';
      }
      this.logger.error(`queryWorkspacePhase failed: ${err}`);
      return 'Unknown';
    }
  }

  async waitForPhase(
    connInfo: WorkspaceConnectionInfo,
    targetPhase: WorkspacePhase,
    timeoutMs: number
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await this.sleep(3000);
      const current = await this.queryWorkspacePhase(connInfo);
      if (current === targetPhase) { return true; }
      if (current === 'Failed' || current === 'Stopped') { return false; }
    }
    return false;
  }

  async waitForPodReady(connInfo: WorkspaceConnectionInfo, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const kc = this.kubeConfig ?? await this.deps.getKubeConfig(connInfo.clusterUrl);
        if (kc) {
          this.kubeConfig = kc;
          const { podName, containerName } = await this.deps.findWorkspacePod(kc, connInfo.namespace, connInfo.devworkspaceId);
          await this.verifyPodExec(connInfo.namespace, podName, containerName);
          return;
        }
      } catch { /* not ready yet */ }
      await this.sleep(3000);
    }
    this.logger.warn(`Pod not ready after ${timeoutMs / 1000}s`);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async waitForNewPod(
    connInfo: WorkspaceConnectionInfo,
    timeoutMs: number
  ): Promise<{ podName: string; containerName: string }> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const kc = this.kubeConfig ?? await this.deps.getKubeConfig(connInfo.clusterUrl);
        if (kc) {
          this.kubeConfig = kc;
          const result = await this.deps.findWorkspacePod(kc, connInfo.namespace, connInfo.devworkspaceId);

          if (result.podName === this.lastResolvedPodName) {
            this.logger.debug(`Still on old pod ${result.podName}, waiting for new one...`);
            await this.sleep(3000);
            continue;
          }

          await this.verifyPodExec(connInfo.namespace, result.podName, result.containerName);
          return result;
        }
      } catch { /* not ready yet */ }
      await this.sleep(3000);
    }
    throw new Error(`New pod not ready after ${timeoutMs / 1000}s`);
  }

  private async verifyPodExec(namespace: string, podName: string, containerName: string): Promise<void> {
    const exec = new k8s.Exec(this.kubeConfig);
    await new Promise<void>((resolve, reject) => {
      const stdout = new stream.Writable({ write(_c: any, _e: any, cb: any) { cb(); } });
      exec.exec(namespace, podName, containerName, ['echo', 'ready'], stdout, stdout, null, false,
        (status: any) => {
          if (status?.status === 'Success') { resolve(); }
          else { reject(new Error('exec failed')); }
        }
      ).catch(reject);
    });
  }

  private async showWorkspaceStoppedDialog(connInfo: WorkspaceConnectionInfo): Promise<void> {
    this.logger.show();
    const choice = await vscode.window.showErrorMessage(
      'Your workspace is not running.',
      { modal: true },
      'Restart Workspace',
      'Close Remote'
    );

    if (choice === 'Restart Workspace') {
      await this.restartAndReload(connInfo);
    } else {
      await vscode.commands.executeCommand('workbench.action.remote.close');
    }
  }

  private async showWorkspaceDeletedDialog(connInfo: WorkspaceConnectionInfo): Promise<void> {
    this.logger.show();
    await vscode.window.showErrorMessage(
      `Workspace "${connInfo.workspaceName}" no longer exists. It may have been deleted from the cluster.`,
      { modal: true },
      'Close Remote',
    );
    await vscode.commands.executeCommand('workbench.action.remote.close');
  }

  private async restartAndReload(connInfo: WorkspaceConnectionInfo): Promise<void> {
    try {
      await vscode.window.withProgress(
        { title: `Restarting ${connInfo.workspaceName}`, location: vscode.ProgressLocation.Notification, cancellable: false },
        async (progress) => {
          progress.report({ message: 'Starting workspace...' });
          const status = await this.deps.checkAndStartWorkspace(connInfo.clusterUrl, connInfo.namespace, connInfo.workspaceName);
          if (status === 'failed') { throw new Error('Workspace failed to start'); }

          progress.report({ message: 'Waiting for pod...' });
          await this.waitForPodReady(connInfo, 60_000);
          progress.report({ message: 'Reloading...' });
        }
      );
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    } catch (err) {
      this.logger.error(`Restart failed: ${err}`);
      vscode.window.showErrorMessage(`Failed to restart: ${err instanceof Error ? err.message : String(err)}`);
      await vscode.commands.executeCommand('workbench.action.remote.close');
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Detect a 404 Not Found error from the Kubernetes client.
 *
 * The K8s JS client can surface 404 in multiple ways:
 * - err.statusCode = 404 (newer client versions)
 * - err.response.statusCode = 404
 * - err.body.code = 404
 * - err.message contains "HTTP-Code: 404" (older client / string-based errors)
 */
function isNotFoundError(err: any): boolean {
  if (err?.statusCode === 404) { return true; }
  if (err?.response?.statusCode === 404) { return true; }
  if (err?.body?.code === 404) { return true; }
  const msg = err?.message ?? '';
  if (msg.includes('HTTP-Code: 404') || msg.includes('"code":404')) { return true; }
  return false;
}
