import * as vscode from 'vscode';
import { Logger } from '../util/Logger';
import { OpenShiftAuthProvider } from '../auth/OpenShiftAuthProvider';
import { TokenManager } from '../auth/TokenManager';
import { ClusterManager } from '../cluster/ClusterManager';
import { WorkspaceManager } from '../workspace/WorkspaceManager';
import { WorkspaceTreeProvider } from '../ui/WorkspaceTreeProvider';
import { StatusBarManager } from '../ui/StatusBarManager';
import {
  AUTH_PROVIDER_ID,
  CTX_AUTHENTICATED,
  CTX_CONNECTED,
  STATE_CLUSTER_URL,
  STATE_CLUSTER_DISPLAY_URL,
  STATE_CACHED_TOKEN,
  STATE_ACTIVE_CONNECTION,
} from '../constants';

const logger = Logger.getInstance();

export interface AuthCommandsDeps {
  context: vscode.ExtensionContext;
  authProvider: OpenShiftAuthProvider;
  tokenManager: TokenManager;
  clusterManager: ClusterManager;
  statusBar: StatusBarManager;
  treeProvider: () => WorkspaceTreeProvider | undefined;
  clusterWorkspaceManagers: Map<string, WorkspaceManager>;
  refreshIntervals: Map<string, NodeJS.Timeout>;
  loadAllClusters: () => Promise<void>;
}

export function registerAuthCommands(deps: AuthCommandsDeps): void {
  const {
    context, authProvider, tokenManager, clusterManager,
    statusBar, treeProvider, clusterWorkspaceManagers,
    refreshIntervals, loadAllClusters,
  } = deps;

  // --- Sign In ---
  context.subscriptions.push(
    vscode.commands.registerCommand('devspaces.signIn', async () => {
      try {
        await vscode.authentication.getSession(AUTH_PROVIDER_ID, [], {
          createIfNone: true,
        });
        await loadAllClusters();
        vscode.window.showInformationMessage('Signed in to Dev Spaces');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Sign-in failed: ${msg}`);
        logger.error(`Sign-in failed: ${msg}`);
      }
    })
  );

  // --- Sign Out ---
  context.subscriptions.push(
    vscode.commands.registerCommand('devspaces.signOut', async () => {
      try {
        const sessions = await authProvider.getSessions();
        for (const session of sessions) {
          await authProvider.removeSession(session.id);
        }
        for (const wm of clusterWorkspaceManagers.values()) {
          wm.dispose();
        }
        clusterWorkspaceManagers.clear();
        for (const interval of refreshIntervals.values()) {
          clearInterval(interval);
        }
        refreshIntervals.clear();
        const tp = treeProvider();
        if (tp) {
          tp.setClusters(clusterManager.getClusters());
          for (const c of clusterManager.getClusters()) {
            tp.setWorkspaces(c.id, []);
          }
        }
        statusBar.setDisconnected();
        vscode.window.showInformationMessage('Signed out of Dev Spaces');
      } catch (err) {
        logger.error(`Sign-out failed: ${err}`);
      }
    })
  );

  // --- Clear All Authentication ---
  context.subscriptions.push(
    vscode.commands.registerCommand('devspaces.clearAuth', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Clear all Dev Spaces authentication? This removes all stored tokens, cluster registrations, and cached state. You will need to sign in again.',
        { modal: true },
        'Clear All'
      );
      if (confirm !== 'Clear All') {
        return;
      }

      try {
        // Remove tokens (stored under multiple keys)
        const clusters = clusterManager.getClusters();
        for (const cluster of clusters) {
          await tokenManager.deleteToken(cluster.devSpacesUrl);
          await tokenManager.deleteToken(cluster.id);
          await tokenManager.deleteToken(cluster.appsDomain);
        }
        const legacyUrl = context.globalState.get<string>(STATE_CLUSTER_URL);
        if (legacyUrl) {
          await tokenManager.deleteToken(legacyUrl);
        }

        // Fire session-removed events
        const sessions = await authProvider.getSessions();
        for (const session of sessions) {
          await authProvider.removeSession(session.id);
        }

        // Clear globalState
        await context.globalState.update(STATE_CLUSTER_URL, undefined);
        await context.globalState.update(STATE_CLUSTER_DISPLAY_URL, undefined);
        await context.globalState.update(STATE_CACHED_TOKEN, undefined);
        await context.globalState.update(STATE_ACTIVE_CONNECTION, undefined);

        // Remove clusters
        for (const cluster of clusters) {
          await clusterManager.removeCluster(cluster.id);
        }

        // Tear down in-memory state
        for (const wm of clusterWorkspaceManagers.values()) {
          wm.dispose();
        }
        clusterWorkspaceManagers.clear();
        for (const interval of refreshIntervals.values()) {
          clearInterval(interval);
        }
        refreshIntervals.clear();

        // Reset UI
        const tp = treeProvider();
        if (tp) {
          tp.setClusters([]);
        }
        await vscode.commands.executeCommand('setContext', CTX_AUTHENTICATED, false);
        await vscode.commands.executeCommand('setContext', CTX_CONNECTED, false);
        statusBar.setDisconnected();

        // Clear the clusters setting
        await vscode.workspace.getConfiguration('devspaces').update('clusters', [], vscode.ConfigurationTarget.Global);

        // Re-add defaults (will be empty since we just cleared the setting)
        await clusterManager.ensureDefaults();
        if (tp) {
          tp.setClusters(clusterManager.getClusters());
        }

        vscode.window.showInformationMessage(
          'All Dev Spaces authentication cleared. Use "Sign In" to start fresh.'
        );
        logger.info('All authentication state cleared by user');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to clear authentication: ${msg}`);
        logger.error(`Clear auth failed: ${msg}`);
      }
    })
  );
}
