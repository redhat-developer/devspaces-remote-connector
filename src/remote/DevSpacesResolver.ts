import * as vscode from 'vscode';
import * as net from 'net';
import * as crypto from 'crypto';
import * as stream from 'stream';
import * as k8s from '@kubernetes/client-node';
import { Logger } from '../util/Logger';
import { getServerConfig } from './ServerConfig';
import { installServerViaExec } from './ServerSetup';
import { DEVSPACES_AUTHORITY } from '../constants';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WorkspaceConnectionInfo {
  workspaceName: string;
  namespace: string;
  devworkspaceId: string;
  hostAlias: string;
  clusterUrl: string;
}

type WorkspacePhase = 'Running' | 'Starting' | 'Stopping' | 'Stopped' | 'Failed' | 'Unknown';

// ─── Resolver ────────────────────────────────────────────────────────────────

/**
 * RemoteAuthorityResolver for DevSpaces workspaces.
 *
 * Uses ResolvedAuthority (TCP host:port) with an aggressive status monitor
 * that detects pod death and auto-reloads the window before Kiro's internal
 * reconnection logic shows the "Cannot reconnect" dialog.
 *
 * Reconnection strategy:
 * - Status monitor polls pod health every 5 seconds
 * - On pod death: waits for new pod → auto-reloads window
 * - On workspace stopped: shows restart/close dialog
 * - Result: user sees one clean reload, no ugly dialogs
 */
export class DevSpacesResolver implements vscode.RemoteAuthorityResolver, vscode.Disposable {
  private logger = Logger.getInstance();
  private labelFormatter: vscode.Disposable | undefined;
  private kubeConfig: k8s.KubeConfig | undefined;
  private activeConnectionInfo: WorkspaceConnectionInfo | undefined;
  private portForwardServer: net.Server | undefined;
  private statusPoller: ReturnType<typeof setInterval> | undefined;
  private lastResolvedPodName: string | undefined;
  private isHandlingPodDeath = false;
  private stableConnectionToken: string | undefined;

  constructor(
    private context: vscode.ExtensionContext,
    private getConnectionInfo: (hostAlias: string) => Promise<WorkspaceConnectionInfo | undefined>,
    private getKubeConfig: (clusterUrl: string) => Promise<k8s.KubeConfig | undefined>,
    private findWorkspacePod: (kubeConfig: k8s.KubeConfig, namespace: string, devworkspaceId: string) => Promise<{ podName: string; containerName: string }>,
    private checkAndStartWorkspace: (clusterUrl: string, namespace: string, workspaceName: string) => Promise<'running' | 'started' | 'failed'>
  ) {}

  // ─── Public API ──────────────────────────────────────────────────────────

  tunnelFactory = (
    tunnelOptions: vscode.TunnelOptions,
    _tunnelCreationOptions: vscode.TunnelCreationOptions
  ): Thenable<vscode.Tunnel> | undefined => {
    if (!this.kubeConfig || !this.activeConnectionInfo) { return undefined; }
    const connInfo = this.activeConnectionInfo;
    const remotePort = tunnelOptions.remoteAddress.port;
    const localPort = tunnelOptions.localAddressPort || 0;

    return this.findWorkspacePod(this.kubeConfig, connInfo.namespace, connInfo.devworkspaceId)
      .then(({ podName }) => this.createAppTunnel(connInfo.namespace, podName, remotePort, localPort));
  };

  async resolve(
    authority: string,
    resolverContext: vscode.RemoteAuthorityResolverContext
  ): Promise<vscode.ResolverResult> {
    const [prefix, hostAlias] = authority.split('+');
    if (prefix !== DEVSPACES_AUTHORITY) {
      throw new Error(`Unexpected authority prefix: ${prefix}`);
    }

    this.logger.info(`Resolving '${authority}' (attempt #${resolverContext.resolveAttempt})`);

    return vscode.window.withProgress(
      { title: 'Connecting to DevSpaces workspace', location: vscode.ProgressLocation.Notification, cancellable: false },
      async () => {
        try {
          return await this.doResolve(hostAlias);
        } catch (e: unknown) {
          return await this.handleResolveError(e);
        }
      }
    );
  }

  dispose(): void {
    this.stopStatusMonitor();
    this.portForwardServer?.close();
    this.portForwardServer = undefined;
    this.labelFormatter?.dispose();
    this.labelFormatter = undefined;
  }

  // ─── Core Resolve Flow ───────────────────────────────────────────────────

  private async doResolve(hostAlias: string): Promise<vscode.ResolverResult> {
    const connInfo = await this.resolveConnectionInfo(hostAlias);
    await this.resolveKubeConfig(connInfo);
    const { podName, containerName } = await this.discoverPod(connInfo);
    const { listeningOn, connectionToken } = await this.installREH(connInfo, podName, containerName);
    const localPort = await this.establishPortForward(connInfo.namespace, podName, listeningOn);
    this.registerLabelFormatter(hostAlias);
    this.lastResolvedPodName = podName;
    this.startStatusMonitor(connInfo);

    return new vscode.ResolvedAuthority('127.0.0.1', localPort, connectionToken);
  }

  // ─── Resolve Steps ───────────────────────────────────────────────────────

  private async resolveConnectionInfo(hostAlias: string): Promise<WorkspaceConnectionInfo> {
    const connInfo = await this.getConnectionInfo(hostAlias);
    if (!connInfo) {
      throw new Error(`No connection info for ${hostAlias}. Use "Dev Spaces: Connect to Workspace" first.`);
    }
    this.activeConnectionInfo = connInfo;
    return connInfo;
  }

  private async resolveKubeConfig(connInfo: WorkspaceConnectionInfo): Promise<void> {
    const kc = await this.getKubeConfig(connInfo.clusterUrl);
    if (!kc) {
      throw new Error('Not authenticated. Please sign in first.');
    }
    this.kubeConfig = kc;
  }

  private async discoverPod(connInfo: WorkspaceConnectionInfo): Promise<{ podName: string; containerName: string }> {
    this.logger.info(`Finding pod for ${connInfo.workspaceName}`);
    const timeout = 120_000;
    const deadline = Date.now() + timeout;

    while (true) {
      try {
        return await this.findWorkspacePod(this.kubeConfig!, connInfo.namespace, connInfo.devworkspaceId);
      } catch {
        if (Date.now() >= deadline) {
          throw new Error(`Workspace pod not found after ${timeout / 1000}s.`);
        }
        this.logger.info(`Pod not ready, waiting... (${Math.round((deadline - Date.now()) / 1000)}s remaining)`);
        await this.sleep(3000);
      }
    }
  }

  private async installREH(
    connInfo: WorkspaceConnectionInfo,
    podName: string,
    containerName: string
  ): Promise<{ listeningOn: number; connectionToken: string }> {
    this.logger.info(`Installing REH on ${podName}/${containerName}`);
    const serverConfig = await getServerConfig();
    const connectionToken = crypto.randomUUID();
    this.stableConnectionToken = connectionToken; // Store for pod restarts
    const result = await installServerViaExec(
      this.kubeConfig!, connInfo.namespace, podName, containerName, serverConfig, connectionToken
    );
    this.logger.info(`REH listening on port ${result.listeningOn}`);
    return { listeningOn: result.listeningOn, connectionToken };
  }

  private async establishPortForward(namespace: string, podName: string, remotePort: number): Promise<number> {
    this.portForwardServer?.close();
    this.portForwardServer = undefined;

    const forward = new k8s.PortForward(this.kubeConfig!);
    const server = net.createServer((socket) => {
      forward.portForward(namespace, podName, [remotePort], socket, null, socket);
    });

    const localPort = await new Promise<number>((resolve, reject) => {
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port));
    });

    this.portForwardServer = server;
    this.logger.info(`Port-forward: localhost:${localPort} → ${podName}:${remotePort}`);
    return localPort;
  }

  private registerLabelFormatter(hostAlias: string): void {
    this.labelFormatter?.dispose();
    this.labelFormatter = vscode.workspace.registerResourceLabelFormatter({
      scheme: 'vscode-remote',
      authority: `${DEVSPACES_AUTHORITY}+*`,
      formatting: {
        label: '${path}',
        separator: '/',
        tildify: true,
        workspaceSuffix: `DevSpaces: ${hostAlias.replace('devspaces-', '')}`,
      },
    });
    vscode.commands.executeCommand('setContext', 'forwardedPortsViewEnabled', true);
  }

  // ─── Error Handling ──────────────────────────────────────────────────────

  private async handleResolveError(e: unknown): Promise<never> {
    this.logger.error(`Resolve error: ${e}`);
    this.stopStatusMonitor();

    if (e instanceof vscode.RemoteAuthorityResolverError) { throw e; }

    const connInfo = this.activeConnectionInfo;
    const phase = await this.queryWorkspacePhase(connInfo);
    this.logger.info(`Phase: ${phase}`);

    switch (phase) {
      case 'Running':
      case 'Starting':
        // Workspace is alive — wait for pod to be fully ready before retrying
        this.logger.info(`Workspace is ${phase}, waiting for pod to be ready...`);
        if (connInfo) {
          await this.waitForPodReady(connInfo, 120_000);
        }
        return this.retryTemporarily('Reconnecting to workspace...');
      case 'Stopping':
        return this.retryTemporarily('Workspace is stopping...');
      default:
        return this.handleStoppedPhase(connInfo, e);
    }
  }

  private async handleStartingPhase(connInfo: WorkspaceConnectionInfo | undefined, originalError: unknown): Promise<never> {
    this.logger.info('Workspace Starting, waiting for Running...');
    const reached = await this.waitForPhase(connInfo, 'Running', 300_000);
    if (reached && connInfo) {
      await this.waitForPodReady(connInfo, 120_000);
      return this.retryTemporarily('Reconnecting to workspace...');
    }
    return this.handleStoppedPhase(connInfo, originalError);
  }

  private async handleStoppedPhase(connInfo: WorkspaceConnectionInfo | undefined, originalError: unknown): Promise<never> {
    await this.showWorkspaceStoppedDialog(connInfo, originalError);
    throw vscode.RemoteAuthorityResolverError.NotAvailable(
      originalError instanceof Error ? originalError.message : String(originalError)
    );
  }

  private retryTemporarily(message: string): never {
    throw vscode.RemoteAuthorityResolverError.TemporarilyNotAvailable(message);
  }

  // ─── Status Monitor (Pod Health + Auto-Reload) ───────────────────────────

  /**
   * Polls pod health every 5 seconds. When the pod dies:
   * 1. Waits for DevWorkspace phase to reach "Running"
   * 2. Waits for NEW pod (different name from lastResolvedPodName)
   * 3. Pre-installs server on new pod with stable connection token
   * 4. Auto-reloads the window
   *
   * This beats Kiro's internal reconnection timeout (~15-20s) so the user
   * sees a clean reload instead of the "Cannot reconnect" dialog.
   * The pre-install ensures resolve() finds the server already running.
   */
  private startStatusMonitor(connInfo: WorkspaceConnectionInfo): void {
    this.stopStatusMonitor();

    this.statusPoller = setInterval(async () => {
      if (this.isHandlingPodDeath) { return; }

      try {
        // Check workspace phase first
        const phase = await this.queryWorkspacePhase(connInfo);

        if (phase === 'Stopped' || phase === 'Failed') {
          this.stopStatusMonitor();
          this.portForwardServer?.close();
          this.portForwardServer = undefined;
          await this.showWorkspaceStoppedDialog(connInfo, new Error(`Workspace was ${phase.toLowerCase()}`));
          return;
        }

        // Check if the pod is still alive (fast check)
        try {
          const { podName } = await this.findWorkspacePod(this.kubeConfig!, connInfo.namespace, connInfo.devworkspaceId);
          if (this.lastResolvedPodName && podName !== this.lastResolvedPodName) {
            // Pod changed! Pre-install server before reload
            this.isHandlingPodDeath = true;
            this.logger.info(`Pod changed: ${this.lastResolvedPodName} → ${podName}. Pre-installing server...`);
            await this.handlePodDeath(connInfo, podName);
          }
        } catch {
          // Pod not found — it's being rescheduled
          this.isHandlingPodDeath = true;
          this.logger.info('Pod not found, waiting for new pod before reloading...');
          await this.handlePodNotFound(connInfo);
        }
      } catch (err) {
        this.logger.debug(`Status poll error: ${err}`);
      }
    }, 5_000);
  }

  /**
   * Handle pod death when a new pod is detected.
   * Pre-installs server on new pod before reloading.
   */
  private async handlePodDeath(
    connInfo: WorkspaceConnectionInfo,
    _newPodName: string
  ): Promise<void> {
    try {
      // Wait for DevWorkspace phase to reach "Running"
      this.logger.info('Waiting for DevWorkspace phase to reach Running...');
      const phaseReached = await this.waitForPhase(connInfo, 'Running', 300_000);
      if (!phaseReached) {
        this.logger.warn('DevWorkspace did not reach Running phase');
        this.stopStatusMonitor();
        await this.showWorkspaceStoppedDialog(connInfo, new Error('Workspace failed to reach Running phase'));
        return;
      }

      // Wait for new pod to be fully ready (containers initialized)
      this.logger.info('Waiting for new pod to be ready...');
      const { podName: actualNewPodName, containerName } = await this.waitForNewPod(connInfo, 120_000);

      // Pre-install server on new pod with stable token
      this.logger.info(`Pre-installing server on ${actualNewPodName}/${containerName}...`);
      const serverConfig = await getServerConfig();
      // Use stable token from initial resolve
      const token = this.stableConnectionToken || crypto.randomUUID();
      await installServerViaExec(
        this.kubeConfig!, connInfo.namespace, actualNewPodName, containerName, serverConfig, token
      );

      this.logger.info('Server pre-installed, reloading window...');
      this.stopStatusMonitor();
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    } catch (err) {
      this.logger.error(`handlePodDeath failed: ${err}`);
      this.isHandlingPodDeath = false;
    }
  }

  /**
   * Handle pod not found (pod is being rescheduled).
   * Waits for new pod and pre-installs server before reloading.
   */
  private async handlePodNotFound(
    connInfo: WorkspaceConnectionInfo
  ): Promise<void> {
    try {
      // Wait for DevWorkspace phase to reach "Running"
      this.logger.info('Waiting for DevWorkspace phase to reach Running...');
      const phaseReached = await this.waitForPhase(connInfo, 'Running', 300_000);
      if (!phaseReached) {
        this.logger.warn('DevWorkspace did not reach Running phase');
        this.stopStatusMonitor();
        await this.showWorkspaceStoppedDialog(connInfo, new Error('Workspace failed to reach Running phase'));
        return;
      }

      // Wait for new pod to be fully ready
      this.logger.info('Waiting for new pod to be ready...');
      const { podName, containerName } = await this.waitForNewPod(connInfo, 120_000);

      // Pre-install server on new pod with stable token
      this.logger.info(`Pre-installing server on ${podName}/${containerName}...`);
      const serverConfig = await getServerConfig();
      const token = this.stableConnectionToken || crypto.randomUUID();
      await installServerViaExec(
        this.kubeConfig!, connInfo.namespace, podName, containerName, serverConfig, token
      );

      this.logger.info('Server pre-installed, reloading window...');
      this.stopStatusMonitor();
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    } catch (err) {
      this.logger.error(`handlePodNotFound failed: ${err}`);
      this.isHandlingPodDeath = false;
    }
  }

  private stopStatusMonitor(): void {
    if (this.statusPoller) {
      clearInterval(this.statusPoller);
      this.statusPoller = undefined;
    }
  }

  // ─── Workspace Phase Queries ─────────────────────────────────────────────

  private async queryWorkspacePhase(connInfo: WorkspaceConnectionInfo | undefined): Promise<WorkspacePhase> {
    if (!connInfo) { return 'Unknown'; }
    try {
      const kc = await this.getKubeConfig(connInfo.clusterUrl);
      if (!kc) { return 'Unknown'; }

      const customApi = kc.makeApiClient(k8s.CustomObjectsApi);
      const dw = await customApi.getNamespacedCustomObject({
        group: 'workspace.devfile.io',
        version: 'v1alpha2',
        namespace: connInfo.namespace,
        plural: 'devworkspaces',
        name: connInfo.workspaceName,
      }) as any;

      const phase = dw?.status?.phase;
      if (phase === 'Failing') { return 'Failed'; }
      const valid: WorkspacePhase[] = ['Running', 'Starting', 'Stopping', 'Stopped', 'Failed'];
      return valid.includes(phase) ? phase : 'Unknown';
    } catch (err) {
      this.logger.error(`queryWorkspacePhase failed: ${err}`);
      return 'Unknown';
    }
  }

  private async waitForPhase(
    connInfo: WorkspaceConnectionInfo | undefined,
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

  private async waitForPodReady(connInfo: WorkspaceConnectionInfo, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const kc = this.kubeConfig ?? await this.getKubeConfig(connInfo.clusterUrl);
        if (kc) {
          this.kubeConfig = kc;
          const { podName, containerName } = await this.findWorkspacePod(kc, connInfo.namespace, connInfo.devworkspaceId);

          // Verify the pod can actually accept exec commands (containers ready)
          const exec = new k8s.Exec(kc);
          await new Promise<void>((resolve, reject) => {
            const stdout = new stream.Writable({ write(_c: any, _e: any, cb: any) { cb(); } });
            exec.exec(connInfo.namespace, podName, containerName, ['echo', 'ready'], stdout, stdout, null, false,
              (status: any) => {
                if (status?.status === 'Success') { resolve(); }
                else { reject(new Error('exec failed')); }
              }
            ).catch(reject);
          });

          return; // Pod is truly ready
        }
      } catch { /* not ready yet */ }
      await this.sleep(3000);
    }
    this.logger.warn(`Pod not ready after ${timeoutMs / 1000}s`);
  }

  /**
   * Wait for a NEW pod (different from lastResolvedPodName) to be ready.
   * Returns the pod name and container name when found and ready.
   */
  private async waitForNewPod(
    connInfo: WorkspaceConnectionInfo,
    timeoutMs: number
  ): Promise<{ podName: string; containerName: string }> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const kc = this.kubeConfig ?? await this.getKubeConfig(connInfo.clusterUrl);
        if (kc) {
          this.kubeConfig = kc;
          const result = await this.findWorkspacePod(kc, connInfo.namespace, connInfo.devworkspaceId);

          // Must be a DIFFERENT pod than the one that died
          if (result.podName === this.lastResolvedPodName) {
            this.logger.debug(`Still on old pod ${result.podName}, waiting for new one...`);
            await this.sleep(3000);
            continue;
          }

          // Verify the pod can actually accept exec commands (containers ready)
          const exec = new k8s.Exec(kc);
          await new Promise<void>((resolve, reject) => {
            const stdout = new stream.Writable({ write(_c: any, _e: any, cb: any) { cb(); } });
            exec.exec(connInfo.namespace, result.podName, result.containerName, ['echo', 'ready'], stdout, stdout, null, false,
              (status: any) => {
                if (status?.status === 'Success') { resolve(); }
                else { reject(new Error('exec failed')); }
              }
            ).catch(reject);
          });

          return result; // New pod is truly ready
        }
      } catch { /* not ready yet */ }
      await this.sleep(3000);
    }
    throw new Error(`New pod not ready after ${timeoutMs / 1000}s`);
  }

  // ─── Workspace Stopped Dialog ────────────────────────────────────────────

  private async showWorkspaceStoppedDialog(
    connInfo: WorkspaceConnectionInfo | undefined,
    _originalError: unknown
  ): Promise<void> {
    this.logger.show();
    const choice = await vscode.window.showErrorMessage(
      'Your workspace is not running.',
      { modal: true },
      'Restart Workspace',
      'Close Remote'
    );

    if (choice === 'Restart Workspace' && connInfo) {
      await this.restartAndReload(connInfo);
    } else {
      await vscode.commands.executeCommand('workbench.action.remote.close');
    }
  }

  private async restartAndReload(connInfo: WorkspaceConnectionInfo): Promise<void> {
    try {
      await vscode.window.withProgress(
        { title: `Restarting ${connInfo.workspaceName}`, location: vscode.ProgressLocation.Notification, cancellable: false },
        async (progress) => {
          progress.report({ message: 'Starting workspace...' });
          const status = await this.checkAndStartWorkspace(connInfo.clusterUrl, connInfo.namespace, connInfo.workspaceName);
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

  // ─── App Port Tunneling ──────────────────────────────────────────────────

  private async createAppTunnel(
    namespace: string,
    podName: string,
    remotePort: number,
    localPort: number
  ): Promise<vscode.Tunnel> {
    const forward = new k8s.PortForward(this.kubeConfig!);
    const onDidDisposeEmitter = new vscode.EventEmitter<void>();

    const server = net.createServer((socket) => {
      forward.portForward(namespace, podName, [remotePort], socket, null, socket);
    });

    await new Promise<void>((resolve, reject) => {
      server.on('error', reject);
      server.listen(localPort, '127.0.0.1', () => resolve());
    });

    const actualPort = (server.address() as net.AddressInfo).port;
    this.logger.info(`App tunnel: localhost:${actualPort} → ${podName}:${remotePort}`);

    return {
      remoteAddress: { host: '127.0.0.1', port: remotePort },
      localAddress: { host: '127.0.0.1', port: actualPort },
      onDidDispose: onDidDisposeEmitter.event,
      dispose: () => { server.close(); onDidDisposeEmitter.fire(); onDidDisposeEmitter.dispose(); },
    };
  }

  // ─── Utilities ───────────────────────────────────────────────────────────

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
