import * as vscode from 'vscode';
import * as k8s from '@kubernetes/client-node';
import { Logger } from '../util/Logger';
import { TokenManager } from '../auth/TokenManager';
import { ClusterDiscovery } from '../auth/ClusterDiscovery';
import { OpenShiftAuthProvider } from '../auth/OpenShiftAuthProvider';
import { KubeClientFactory } from '../kubernetes/KubeClientFactory';
import { DevWorkspaceApi } from '../kubernetes/DevWorkspaceApi';
import { NamespaceApi } from '../kubernetes/NamespaceApi';
import { PodApi } from '../kubernetes/PodApi';
import { WorkspaceManager } from '../workspace/WorkspaceManager';
import { WorkspaceTreeProvider } from '../ui/WorkspaceTreeProvider';
import { ClusterManager } from './ClusterManager';
import { CTX_INITIALIZING, STATE_CACHED_TOKEN } from '../constants';

const AUTO_REFRESH_INTERVAL = 15_000; // 15 seconds

/**
 * Manages per-cluster workspace sessions: initialization, refresh, and lookup.
 */
export class ClusterSessionManager {
  private logger = Logger.getInstance();
  private workspaceManagers = new Map<string, WorkspaceManager>();
  private refreshIntervals = new Map<string, NodeJS.Timeout>();
  private isInitializing = false;

  constructor(
    private context: vscode.ExtensionContext,
    private tokenManager: TokenManager,
    private clusterDiscovery: ClusterDiscovery,
    private kubeClientFactory: KubeClientFactory,
    private clusterManager: ClusterManager,
    private authProvider: OpenShiftAuthProvider,
    private treeProvider: () => WorkspaceTreeProvider
  ) {}

  getManagers(): Map<string, WorkspaceManager> {
    return this.workspaceManagers;
  }

  getRefreshIntervals(): Map<string, NodeJS.Timeout> {
    return this.refreshIntervals;
  }

  /**
   * Initialize a workspace manager for a specific cluster.
   */
  async initCluster(clusterId: string, clusterUrl: string): Promise<WorkspaceManager | undefined> {
    const existing = this.workspaceManagers.get(clusterId);
    if (existing && existing.getWorkspaces().length > 0) {
      return existing;
    }

    this.cleanupStaleManager(clusterId);

    try {
      const { apiUrl, devSpacesUrl, appsDomain } = await this.resolveClusterEndpoints(clusterId, clusterUrl);
      const accessToken = await this.getClusterToken(clusterId, devSpacesUrl, clusterUrl);
      if (!accessToken) { return undefined; }

      const kubeConfig = this.kubeClientFactory.createConfig(apiUrl, accessToken);
      const resolvedDevSpacesUrl = await this.discoverDevSpacesUrl(kubeConfig, devSpacesUrl);

      await this.clusterManager.updateCluster(clusterId, { apiUrl, devSpacesUrl: resolvedDevSpacesUrl, appsDomain });

      const wm = this.createWorkspaceManager(kubeConfig, clusterId, resolvedDevSpacesUrl, accessToken);
      await this.initializeWorkspaces(wm, clusterId, resolvedDevSpacesUrl, clusterUrl);

      this.workspaceManagers.set(clusterId, wm);
      this.startAutoRefresh(clusterId, wm);

      this.logger.info(`Cluster ${clusterId} initialized with ${wm.getWorkspaces().length} workspaces`);
      return wm;
    } catch (err) {
      this.logger.warn(`Failed to initialize cluster ${clusterId}: ${err}`);
      return undefined;
    }
  }

  private cleanupStaleManager(clusterId: string): void {
    const existing = this.workspaceManagers.get(clusterId);
    if (existing) {
      existing.dispose();
      this.workspaceManagers.delete(clusterId);
      const oldInterval = this.refreshIntervals.get(clusterId);
      if (oldInterval) {
        clearInterval(oldInterval);
        this.refreshIntervals.delete(clusterId);
      }
    }
  }

  private async resolveClusterEndpoints(clusterId: string, clusterUrl: string): Promise<{ apiUrl: string; devSpacesUrl: string; appsDomain: string }> {
    const entry = this.clusterManager.getClusters().find((c) => c.id === clusterId);
    if (entry?.apiUrl) {
      return { apiUrl: entry.apiUrl, devSpacesUrl: entry.devSpacesUrl, appsDomain: entry.appsDomain };
    }
    const endpoints = await this.clusterDiscovery.discover(clusterUrl);
    return { apiUrl: endpoints.apiUrl, devSpacesUrl: endpoints.devSpacesUrl, appsDomain: endpoints.appsDomain };
  }

  private async getClusterToken(clusterId: string, devSpacesUrl: string, clusterUrl: string): Promise<string | undefined> {
    for (const key of [clusterId, devSpacesUrl, clusterUrl]) {
      const t = await this.tokenManager.getToken(key);
      if (t && this.tokenManager.isTokenValid(t)) {
        return t.accessToken;
      }
    }
    const cached = this.context.globalState.get<string>(STATE_CACHED_TOKEN);
    if (cached) { return cached; }
    this.logger.debug(`No token for cluster ${clusterId}, skipping`);
    return undefined;
  }

  private async discoverDevSpacesUrl(kubeConfig: k8s.KubeConfig, fallbackUrl: string): Promise<string> {
    try {
      const customApi = kubeConfig.makeApiClient(k8s.CustomObjectsApi);
      const consoleLinks = await customApi.listClusterCustomObject({
        group: 'console.openshift.io', version: 'v1', plural: 'consolelinks',
      }) as any;
      const devSpacesLink = consoleLinks?.items?.find((link: any) =>
        link.metadata?.name?.includes('che') || link.metadata?.name?.includes('devspaces') ||
        link.spec?.href?.includes('devspaces') || link.spec?.href?.includes('codeready')
      );
      if (devSpacesLink?.spec?.href) {
        const discovered = devSpacesLink.spec.href.replace(/\/+$/, '');
        this.logger.info(`Discovered DevSpaces URL from ConsoleLink: ${discovered}`);
        return discovered;
      }
    } catch {
      // ConsoleLink query failed — use fallback
    }
    return fallbackUrl;
  }

  private createWorkspaceManager(kubeConfig: k8s.KubeConfig, clusterId: string, devSpacesUrl: string, accessToken: string): WorkspaceManager {
    const coreApi = kubeConfig.makeApiClient(k8s.CoreV1Api);
    const customApi = kubeConfig.makeApiClient(k8s.CustomObjectsApi);
    const devWorkspaceApi = new DevWorkspaceApi(customApi, clusterId);
    const namespaceApi = new NamespaceApi(coreApi, customApi, devSpacesUrl, accessToken);
    const podApi = new PodApi(coreApi, kubeConfig);
    const wm = new WorkspaceManager(devWorkspaceApi, namespaceApi, podApi);
    this.context.subscriptions.push(wm);
    return wm;
  }

  private async initializeWorkspaces(wm: WorkspaceManager, clusterId: string, devSpacesUrl: string, clusterUrl: string): Promise<void> {
    const tp = this.treeProvider();
    wm.onDidChangeWorkspaces(() => {
      if (!this.isInitializing) {
        tp.setWorkspaces(clusterId, wm.getWorkspaces());
      }
    });

    const tokenData = await this.tokenManager.getToken(clusterId)
      ?? await this.tokenManager.getToken(devSpacesUrl)
      ?? await this.tokenManager.getToken(clusterUrl);
    const username = tokenData?.username;
    if (username) {
      await wm.initialize(username);
      if (!wm.getNamespace()) {
        this.triggerNamespaceProvisioning(username, devSpacesUrl, wm, clusterId, tp);
      }
      tp.setWorkspaces(clusterId, wm.getWorkspaces());
    }
  }

  /**
   * Prompt user to open dashboard to trigger namespace provisioning.
   * Runs in background — does not block cluster initialization.
   */
  private async triggerNamespaceProvisioning(
    username: string,
    devSpacesUrl: string,
    wm: WorkspaceManager,
    clusterId: string,
    tp: WorkspaceTreeProvider
  ): Promise<void> {
    this.logger.info(`No namespace for ${username} — prompting to open dashboard`);

    const action = await vscode.window.showInformationMessage(
      'Your Dev Spaces environment needs to be initialized. This requires a one-time visit to the dashboard.',
      'Open Dashboard'
    );

    if (action !== 'Open Dashboard') {
      return;
    }

    await vscode.env.openExternal(vscode.Uri.parse(`${devSpacesUrl}/api/kubernetes/namespace`));

    // Poll for namespace to appear
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      await wm.initialize(username);
      if (wm.getNamespace()) {
        vscode.window.showInformationMessage('Dev Spaces environment ready! You can close the dashboard tab.');
        tp.setWorkspaces(clusterId, wm.getWorkspaces());
        return;
      }
    }
  }

  /**
   * Perform namespace readiness check for first-time users.
   */
  /**
   * Start auto-refresh for a cluster's workspace list.
   */
  private startAutoRefresh(clusterId: string, wm: WorkspaceManager): void {
    if (this.refreshIntervals.has(clusterId)) { return; }

    const interval = setInterval(async () => {
      try {
        await wm.refresh();
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        if (msg.includes('401') || msg.includes('403') || msg.includes('Unauthorized') || msg.includes('Forbidden')) {
          this.logger.warn(`Token expired for cluster ${clusterId}, prompting re-auth`);
          clearInterval(interval);
          this.refreshIntervals.delete(clusterId);
          const action = await vscode.window.showWarningMessage(
            'Your Dev Spaces session has expired. Sign in again to continue.',
            'Sign In'
          );
          if (action === 'Sign In') {
            vscode.commands.executeCommand('devspaces.signIn');
          }
        }
      }
    }, AUTO_REFRESH_INTERVAL);
    this.refreshIntervals.set(clusterId, interval);
  }

  /**
   * Load workspaces for all registered clusters.
   */
  async loadAllClusters(): Promise<void> {
    // Set initializing state before anything loads
    this.isInitializing = true;
    await vscode.commands.executeCommand('setContext', CTX_INITIALIZING, true);

    const tp = this.treeProvider();
    const clusters = this.clusterManager.getClusters();
    tp.setClusters(clusters);

    // Migrate existing cluster URL if needed
    const existingUrl = this.authProvider.getStoredClusterUrl();
    if (existingUrl && clusters.length === 0) {
      await this.clusterManager.addCluster(existingUrl);
      tp.setClusters(this.clusterManager.getClusters());
    }

    const allClusters = this.clusterManager.getClusters();
    await Promise.allSettled(
      allClusters.map((c) => this.initCluster(c.id, c.devSpacesUrl))
    );

    // Clear initializing state so the UI is usable immediately
    this.isInitializing = false;
    await vscode.commands.executeCommand('setContext', CTX_INITIALIZING, false);

    // Run readiness check in the background (non-blocking)
    // Note: first-time user provisioning is handled per-cluster in initCluster
  }

  /**
   * Find the workspace manager that owns a specific workspace.
   */
  getManagerForWorkspace(workspace: { clusterId?: string; namespace: string; name: string }): WorkspaceManager | undefined {
    // Direct lookup by clusterId (preferred)
    if (workspace.clusterId) {
      return this.workspaceManagers.get(workspace.clusterId);
    }
    // Fallback: search by namespace/name
    for (const wm of this.workspaceManagers.values()) {
      if (wm.getWorkspaces().some((ws) => ws.namespace === workspace.namespace && ws.name === workspace.name)) {
        return wm;
      }
    }
    return undefined;
  }

  /**
   * Get a workspace manager, prompting user to pick a cluster if multiple.
   */
  async ensureWorkspaceManager(): Promise<WorkspaceManager> {
    const clusters = this.clusterManager.getClusters();
    if (clusters.length === 0) {
      throw new Error('No cluster configured. Use "Add Cluster" first.');
    }

    let targetCluster = clusters[0];
    if (clusters.length > 1) {
      const picked = await vscode.window.showQuickPick(
        clusters.map((c) => ({ label: c.displayName, detail: c.devSpacesUrl, cluster: c })),
        { placeHolder: 'Select a cluster' }
      );
      if (!picked) {
        throw new Error('No cluster selected');
      }
      targetCluster = picked.cluster;
    }

    let wm = this.workspaceManagers.get(targetCluster.id);
    if (!wm) {
      wm = await this.initCluster(targetCluster.id, targetCluster.devSpacesUrl);
      if (!wm) {
        throw new Error(`Failed to connect to ${targetCluster.displayName}. Please sign in.`);
      }
    }
    return wm;
  }

  /**
   * Clean up all intervals.
   */
  disposeIntervals(): void {
    for (const interval of this.refreshIntervals.values()) {
      clearInterval(interval);
    }
    this.refreshIntervals.clear();
  }
}
