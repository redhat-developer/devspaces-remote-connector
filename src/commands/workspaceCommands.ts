import { ClusterEntry } from '../cluster/ClusterManager';
import * as vscode from 'vscode';
import { Logger } from '../util/Logger';
import { WorkspaceTreeItem } from '../ui/WorkspaceTreeItem';
import { WorkspaceManager } from '../workspace/WorkspaceManager';
import { WorkspaceModel } from '../workspace/WorkspaceModel';
import { WorkspacePhase, PROJECTS_ROOT, STATE_ACTIVE_CONNECTION, STATE_CONNECTIONS_MAP, DEVSPACES_AUTHORITY } from '../constants';
import { KubeClientFactory } from '../kubernetes/KubeClientFactory';
import { ClusterManager } from '../cluster/ClusterManager';
import { ActiveConnectionInfo } from './remoteCommands';
import { copyKiroAuthToPod, discoverProjectFolder } from './workspaceHelpers';

export interface WorkspaceCommandContext {
  context: vscode.ExtensionContext;
  getManagerForCommand: (item?: WorkspaceTreeItem) => Promise<WorkspaceManager>;
  ensureWorkspaceManager: () => Promise<WorkspaceManager>;
  clusterWorkspaceManagers: Map<string, WorkspaceManager>;
  loadAllClusters: () => Promise<void>;
  clusterManager: ClusterManager;
  authProvider: { getAccessToken(): Promise<string>; getEndpoints(): any };
  kubeClientFactory: KubeClientFactory;
}

/**
 * Register all workspace lifecycle commands (local window).
 */
export function registerWorkspaceCommands(ctx: WorkspaceCommandContext): void {
  const logger = Logger.getInstance();
  const { context, getManagerForCommand, ensureWorkspaceManager, clusterWorkspaceManagers,
    loadAllClusters, clusterManager, authProvider, kubeClientFactory } = ctx;

  // --- Refresh ---
  context.subscriptions.push(
    vscode.commands.registerCommand('devspaces.refreshWorkspaces', async () => {
      try {
        for (const wm of clusterWorkspaceManagers.values()) { await wm.refresh(); }
        await loadAllClusters();
      } catch (err) {
        vscode.window.showErrorMessage(`Refresh failed: ${err instanceof Error ? err.message : err}`);
      }
    })
  );

  // --- Start ---
  context.subscriptions.push(
    vscode.commands.registerCommand('devspaces.startWorkspace', async (item?: WorkspaceTreeItem) => {
      try {
        const wm = await getManagerForCommand(item);
        const name = item?.workspace.name ?? (await pickWorkspace(wm));
        if (!name) { return; }
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Starting workspace ${item?.workspace.displayName ?? name}`, cancellable: false },
          async (progress) => { await wm.startWorkspace(name, progress); }
        );
        vscode.window.showInformationMessage(`Workspace ${item?.workspace.displayName ?? name} is running`);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to start workspace: ${err instanceof Error ? err.message : err}`);
      }
    })
  );

  // --- Stop ---
  context.subscriptions.push(
    vscode.commands.registerCommand('devspaces.stopWorkspace', async (item?: WorkspaceTreeItem) => {
      try {
        const wm = await getManagerForCommand(item);
        const name = item?.workspace.name ?? (await pickWorkspace(wm));
        if (!name) { return; }
        await wm.stopWorkspace(name);
        vscode.window.showInformationMessage(`Workspace ${item?.workspace.displayName ?? name} stopped`);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to stop workspace: ${err instanceof Error ? err.message : err}`);
      }
    })
  );

  // --- Restart ---
  context.subscriptions.push(
    vscode.commands.registerCommand('devspaces.restartWorkspace', async (item?: WorkspaceTreeItem) => {
      try {
        const wm = await getManagerForCommand(item);
        const name = item?.workspace.name ?? (await pickWorkspace(wm));
        const label = item?.workspace.displayName ?? name;
        if (!name) { return; }
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Restarting workspace ${label}`, cancellable: false },
          async (progress) => {
            progress.report({ message: 'Stopping...' });
            await wm.stopWorkspace(name);
            await new Promise((r) => setTimeout(r, 2000));
            progress.report({ message: 'Starting...' });
            await wm.startWorkspace(name, progress);
          }
        );
        vscode.window.showInformationMessage(`Workspace ${label} restarted`);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to restart workspace: ${err instanceof Error ? err.message : err}`);
      }
    })
  );

  // --- Delete ---
  context.subscriptions.push(
    vscode.commands.registerCommand('devspaces.deleteWorkspace', async (item?: WorkspaceTreeItem) => {
      try {
        const wm = await getManagerForCommand(item);
        const name = item?.workspace.name ?? (await pickWorkspace(wm));
        const label = item?.workspace.displayName ?? name;
        if (!name) { return; }
        const confirm = await vscode.window.showWarningMessage(
          `Are you sure you want to delete workspace "${label}"? This cannot be undone.`,
          { modal: true }, 'Delete'
        );
        if (confirm !== 'Delete') { return; }
        await wm.deleteWorkspace(name);
        vscode.window.showInformationMessage(`Workspace ${label} deleted`);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to delete workspace: ${err instanceof Error ? err.message : err}`);
      }
    })
  );

  // --- New Workspace (unified entry point) ---
  context.subscriptions.push(
    vscode.commands.registerCommand('devspaces.newWorkspace', async (item?: any) => {
      const choice = await vscode.window.showQuickPick([
        { label: '$(repo-clone) From Git Repository', description: 'Clone a Git repo into a new workspace', value: 'git' as const },
        { label: '$(file-add) Empty Workspace', description: 'Start with a blank workspace', value: 'empty' as const },
      ], { placeHolder: 'What kind of workspace do you want to create?', ignoreFocusOut: true });
      if (!choice) { return; }
      try {
        const cluster = await pickCluster(clusterManager, item);
        if (!cluster) { return; }
        if (choice.value === 'git') {
          const gitUrl = await vscode.window.showInputBox({
            prompt: 'Enter the Git repository URL',
            placeHolder: 'https://github.com/org/my-app.git',
            ignoreFocusOut: true,
            validateInput: (v) => {
              const t = v.trim();
              if (!t) { return 'Please enter a URL'; }
              if (!t.startsWith('http') && !t.startsWith('git@')) { return 'Please enter a valid Git URL'; }
              return undefined;
            },
          });
          if (!gitUrl) { return; }
          const dashboardUrl = `${cluster.devSpacesUrl}/dashboard/#/load-factory?url=${encodeURIComponent(gitUrl.trim())}`;
          await createViaDashboard(dashboardUrl, cluster.id);
        } else {
          const emptyDevfileUrl = `${cluster.devSpacesUrl}/dashboard/devfile-registry/devfiles/empty.yaml`;
          const dashboardUrl = `${cluster.devSpacesUrl}/dashboard/#/load-factory?url=${encodeURIComponent(emptyDevfileUrl)}&policies.create=perclick`;
          await createViaDashboard(dashboardUrl, cluster.id);
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to create workspace: ${err instanceof Error ? err.message : err}`);
      }
    })
  );

  // --- Create from Git URL ---
  context.subscriptions.push(
    vscode.commands.registerCommand('devspaces.createWorkspace', async (item?: any) => {
      try {
        const cluster = await pickCluster(clusterManager, item);
        if (!cluster) { return; }
        const gitUrl = await vscode.window.showInputBox({
          prompt: 'Enter the Git repository URL',
          placeHolder: 'https://github.com/org/my-app.git',
          ignoreFocusOut: true,
          validateInput: (v) => {
            const t = v.trim();
            if (!t) { return 'Please enter a URL'; }
            if (!t.startsWith('http') && !t.startsWith('git@')) { return 'Please enter a valid Git URL'; }
            return undefined;
          },
        });
        if (!gitUrl) { return; }
        const dashboardUrl = `${cluster.devSpacesUrl}/dashboard/#/load-factory?url=${encodeURIComponent(gitUrl.trim())}`;
        await createViaDashboard(dashboardUrl, cluster.id);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to create workspace: ${err instanceof Error ? err.message : err}`);
      }
    })
  );

  // --- Create Empty ---
  context.subscriptions.push(
    vscode.commands.registerCommand('devspaces.createEmptyWorkspace', async (item?: any) => {
      try {
        const cluster = await pickCluster(clusterManager, item);
        if (!cluster) { return; }
        const emptyDevfileUrl = `${cluster.devSpacesUrl}/dashboard/devfile-registry/devfiles/empty.yaml`;
        const dashboardUrl = `${cluster.devSpacesUrl}/dashboard/#/load-factory?url=${encodeURIComponent(emptyDevfileUrl)}&policies.create=perclick`;
        await createViaDashboard(dashboardUrl, cluster.id);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to create workspace: ${err instanceof Error ? err.message : err}`);
      }
    })
  );

  // --- Connect ---
  context.subscriptions.push(
    vscode.commands.registerCommand('devspaces.connectWorkspace', async (item?: WorkspaceTreeItem) => {
      try {
        const workspace = item?.workspace ?? (await pickWorkspaceFromAll(clusterWorkspaceManagers));
        if (!workspace) { return; }
        const wm = getManagerForWorkspace(clusterWorkspaceManagers, workspace) ?? await ensureWorkspaceManager();

        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Connecting to ${workspace.displayName}`, cancellable: true },
          async (progress, cancellationToken) => {

            let currentWs = workspace;
            if (currentWs.phase !== WorkspacePhase.Running) {
              progress.report({ message: '(1/4) Starting workspace...' });
              currentWs = await wm.startWorkspace(workspace.name, progress);
            }

            progress.report({ message: '(2/4) Preparing connection...' });
            const token = await authProvider.getAccessToken();

            const wsCluster = clusterManager.getClusters().find((c) => c.id === workspace.clusterId);
            const workspaceClusterUrl = wsCluster?.devSpacesUrl ?? '';
            if (!wsCluster || !workspaceClusterUrl) {
              throw new Error('Could not determine cluster for this workspace');
            }

            const hostAlias = `${workspace.name}@${wsCluster.id}`;
            const connInfo: ActiveConnectionInfo = {
              workspaceName: workspace.name,
              namespace: workspace.namespace,
              devworkspaceId: workspace.devworkspaceId,
              hostAlias,
              clusterUrl: workspaceClusterUrl,
            };
            await context.globalState.update(STATE_ACTIVE_CONNECTION, connInfo);
            // Also store in connections map for multi-workspace recent lookup
            const connectionsMap = context.globalState.get<Record<string, ActiveConnectionInfo>>(STATE_CONNECTIONS_MAP, {});
            connectionsMap[hostAlias] = connInfo;
            await context.globalState.update(STATE_CONNECTIONS_MAP, connectionsMap);

            if (cancellationToken.isCancellationRequested) {
              await context.globalState.update(STATE_ACTIVE_CONNECTION, undefined);
              return;
            }

            progress.report({ message: '(3/5) Syncing authentication...' });
            try {
              const isKiro = vscode.env.appName?.toLowerCase().includes('kiro');
              const copyCredentials = vscode.workspace.getConfiguration('devspaces').get<boolean>('kiroCopyCredentials', true);
              if (isKiro && copyCredentials && wsCluster.apiUrl) {
                const kubeConfig = kubeClientFactory.createConfig(wsCluster.apiUrl, token);
                await copyKiroAuthToPod(kubeConfig, workspace);
              }
            } catch { /* best effort */ }

            if (cancellationToken.isCancellationRequested) {
              await context.globalState.update(STATE_ACTIVE_CONNECTION, undefined);
              return;
            }

            progress.report({ message: '(4/5) Discovering project folder...' });
            let projectFolder = PROJECTS_ROOT;
            try {
              if (wsCluster.apiUrl) {
                const kubeConfig = kubeClientFactory.createConfig(wsCluster.apiUrl, token);
                projectFolder = await discoverProjectFolder(kubeConfig, workspace);
              }
            } catch {
              logger.debug(`Project folder discovery: using ${projectFolder}`);
            }

            progress.report({ message: '(5/5) Opening remote session...' });
            const openBehavior = vscode.workspace.getConfiguration('devspaces').get<string>('openBehavior', 'newWindow');
            let forceNewWindow: boolean;
            if (process.env.DEVSPACES_DEBUG) {
              forceNewWindow = false;
            } else if (openBehavior === 'prompt') {
              const windowChoice = await vscode.window.showQuickPick(
                [{ label: '$(empty-window) New Window', value: true }, { label: '$(window) Current Window', value: false }],
                { placeHolder: `Open ${workspace.displayName} workspace`, ignoreFocusOut: true }
              );
              if (!windowChoice) {
                await context.globalState.update(STATE_ACTIVE_CONNECTION, undefined);
                return;
              }
              forceNewWindow = windowChoice.value;
            } else {
              forceNewWindow = openBehavior !== 'currentWindow';
            }

            await vscode.workspace.getConfiguration().update('terminal.integrated.defaultProfile.linux', 'bash', vscode.ConfigurationTarget.Global);
            const remoteUri = vscode.Uri.parse(`vscode-remote://${DEVSPACES_AUTHORITY}+${hostAlias}${projectFolder}`);
            logger.info(`Opening remote workspace: ${remoteUri.toString()} (newWindow: ${forceNewWindow})`);
            await vscode.commands.executeCommand('vscode.openFolder', remoteUri, { forceNewWindow });
          }
        );
      } catch (err) {
        await context.globalState.update(STATE_ACTIVE_CONNECTION, undefined);
        vscode.window.showErrorMessage(`Connection failed: ${err instanceof Error ? err.message : err}`);
      }
    })
  );

  // --- Open in Browser ---
  context.subscriptions.push(
    vscode.commands.registerCommand('devspaces.openInBrowser', async (item?: WorkspaceTreeItem) => {
      const url = item?.workspace.mainUrl;
      if (url) { await vscode.env.openExternal(vscode.Uri.parse(url)); }
      else { vscode.window.showWarningMessage('No browser URL available for this workspace'); }
    })
  );

  // --- Open Dashboard ---
  context.subscriptions.push(
    vscode.commands.registerCommand('devspaces.openInDashboard', async () => {
      const clusters = clusterManager.getClusters();
      if (clusters.length === 0) { vscode.window.showWarningMessage('No cluster configured.'); return; }
      let cluster = clusters[0];
      if (clusters.length > 1) {
        const picked = await vscode.window.showQuickPick(
          clusters.map((c) => ({ label: c.displayName, description: c.devSpacesUrl, cluster: c })),
          { placeHolder: 'Select a cluster' }
        );
        if (!picked) { return; }
        cluster = picked.cluster;
      }
      await vscode.env.openExternal(vscode.Uri.parse(`${cluster.devSpacesUrl}/dashboard/#/workspaces`));
    })
  );

  // --- Open OpenShift Console ---
  context.subscriptions.push(
    vscode.commands.registerCommand('devspaces.openConsole', async () => {
      const clusters = clusterManager.getClusters();
      if (clusters.length === 0) { vscode.window.showWarningMessage('No cluster configured.'); return; }
      let cluster = clusters[0];
      if (clusters.length > 1) {
        const picked = await vscode.window.showQuickPick(
          clusters.map((c) => ({ label: c.displayName, description: c.devSpacesUrl, cluster: c })),
          { placeHolder: 'Select a cluster' }
        );
        if (!picked) { return; }
        cluster = picked.cluster;
      }
      const consoleUrl = cluster.appsDomain
        ? `https://console-openshift-console.${cluster.appsDomain}`
        : cluster.devSpacesUrl;
      await vscode.env.openExternal(vscode.Uri.parse(consoleUrl));
    })
  );

  // --- Connect Recent (placeholder) ---
  context.subscriptions.push(
    vscode.commands.registerCommand('devspaces.connectRecent', async () => {
      vscode.window.showInformationMessage('Connection history coming in a future release.');
    })
  );

  // ── Helper: create via dashboard ──────────────────────────────────
  async function createViaDashboard(factoryUrl: string, clusterId?: string): Promise<void> {
    let wm: WorkspaceManager;
    if (clusterId) {
      const existing = clusterWorkspaceManagers.get(clusterId);
      if (existing) { wm = existing; }
      else { wm = await ensureWorkspaceManager(); }
    } else {
      wm = await ensureWorkspaceManager();
    }
    const before = new Set(wm.getWorkspaces().map((w) => w.name));
    await vscode.env.openExternal(vscode.Uri.parse(factoryUrl));

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Waiting for workspace', cancellable: true },
      async (progress, token) => {
        progress.report({ message: 'Creating workspace in browser — waiting for it to start...' });
        const POLL = 5_000;
        const deadline = Date.now() + 300_000;

        while (Date.now() < deadline) {
          if (token.isCancellationRequested) { return; }
          await new Promise((r) => setTimeout(r, POLL));
          try { await wm.refresh(); } catch { continue; }

          const newWs = wm.getWorkspaces().find(
            (w) => !before.has(w.name) && (w.phase === WorkspacePhase.Running || w.phase === WorkspacePhase.Starting)
          );
          if (newWs) {
            if (newWs.phase === WorkspacePhase.Starting) {
              progress.report({ message: `Workspace ${newWs.displayName} is starting...` });
              while (Date.now() < deadline) {
                if (token.isCancellationRequested) { return; }
                await new Promise((r) => setTimeout(r, POLL));
                try { await wm.refresh(); } catch { continue; }
                const updated = wm.getWorkspaces().find((w) => w.name === newWs.name);
                if (updated?.phase === WorkspacePhase.Running) { break; }
                if (updated?.phase === WorkspacePhase.Failed) {
                  vscode.window.showErrorMessage(`Workspace ${newWs.displayName} failed to start.`);
                  return;
                }
              }
            }
            const wsItem = { workspace: newWs } as WorkspaceTreeItem;
            vscode.commands.executeCommand('devspaces.connectWorkspace', wsItem);
            return;
          }
        }
        vscode.window.showWarningMessage('Timed out waiting for workspace. Check the dashboard.');
      }
    );
  }
}

// ── Shared helpers ────────────────────────────────────────────────────

function getManagerForWorkspace(
  managers: Map<string, WorkspaceManager>,
  workspace: { clusterId?: string; namespace: string; name: string }
): WorkspaceManager | undefined {
  if (workspace.clusterId) {
    return managers.get(workspace.clusterId);
  }
  for (const wm of managers.values()) {
    if (wm.getWorkspaces().some((ws) => ws.namespace === workspace.namespace && ws.name === workspace.name)) {
      return wm;
    }
  }
  return undefined;
}

async function pickWorkspace(wm: WorkspaceManager): Promise<string | undefined> {
  const workspaces = wm.getWorkspaces();
  if (workspaces.length === 0) { vscode.window.showInformationMessage('No workspaces found'); return undefined; }
  const picked = await vscode.window.showQuickPick(
    workspaces.map((ws) => ({ label: ws.name, description: ws.phase, detail: ws.gitRepoUrl })),
    { placeHolder: 'Select a workspace' }
  );
  return picked?.label;
}

async function pickWorkspaceFromAll(
  managers: Map<string, WorkspaceManager>
): Promise<WorkspaceModel | undefined> {
  if (managers.size === 0) { vscode.window.showInformationMessage('No workspaces found'); return undefined; }
  const all: { label: string; description: string; detail?: string; workspace: WorkspaceModel }[] = [];
  for (const wm of managers.values()) {
    for (const ws of wm.getWorkspaces()) {
      all.push({ label: ws.name, description: ws.phase, detail: ws.gitRepoUrl, workspace: ws });
    }
  }
  if (all.length === 0) { vscode.window.showInformationMessage('No workspaces found'); return undefined; }
  const picked = await vscode.window.showQuickPick(all, { placeHolder: 'Select a workspace' });
  return picked?.workspace;
}

async function pickCluster(clusterMgr: ClusterManager, item?: any): Promise<ClusterEntry | undefined> {
  // If invoked from a cluster tree item context menu
  if (item?.cluster?.devSpacesUrl) {
    return item.cluster;
  }
  // If the item itself is a cluster entry (passed directly)
  if (item?.devSpacesUrl && item?.id) {
    return item;
  }
  const clusters = clusterMgr.getClusters();
  if (clusters.length === 0) { throw new Error('No cluster configured. Use "Add Cluster" first.'); }
  if (clusters.length === 1) { return clusters[0]; }
  const picked = await vscode.window.showQuickPick(
    clusters.map((c) => ({ label: c.displayName, description: c.devSpacesUrl, cluster: c })),
    { placeHolder: 'Select a cluster to create the workspace on', ignoreFocusOut: true }
  );
  return picked?.cluster;
}
