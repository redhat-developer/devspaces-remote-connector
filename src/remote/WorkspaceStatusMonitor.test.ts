import { WorkspaceStatusMonitor, StatusMonitorDeps } from './WorkspaceStatusMonitor';
import { WorkspaceConnectionInfo } from './DevSpacesResolver';
import * as vscode from 'vscode';
import * as k8s from '@kubernetes/client-node';

// Mock Logger
jest.mock('../util/Logger', () => ({
  Logger: {
    getInstance: () => ({
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      show: jest.fn(),
    }),
  },
}));

// Mock ServerConfig
jest.mock('./ServerConfig', () => ({
  getServerConfig: jest.fn().mockResolvedValue({ commit: 'abc123', quality: 'stable' }),
}));

// Mock ServerSetup
jest.mock('./ServerSetup', () => ({
  installServerViaExec: jest.fn().mockResolvedValue({ listeningOn: 9000 }),
}));

describe('WorkspaceStatusMonitor', () => {
  let mockDeps: jest.Mocked<StatusMonitorDeps>;
  let mockKubeConfig: any;
  let mockCustomApi: { getNamespacedCustomObject: jest.Mock };
  let connInfo: WorkspaceConnectionInfo;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();

    mockCustomApi = {
      getNamespacedCustomObject: jest.fn(),
    };

    mockKubeConfig = {
      makeApiClient: jest.fn().mockReturnValue(mockCustomApi),
    };

    mockDeps = {
      getKubeConfig: jest.fn().mockResolvedValue(mockKubeConfig),
      findWorkspacePod: jest.fn().mockResolvedValue({ podName: 'ws-pod-abc', containerName: 'tools' }),
      checkAndStartWorkspace: jest.fn().mockResolvedValue('running'),
    };

    connInfo = {
      workspaceName: 'my-workspace',
      namespace: 'user-ns',
      devworkspaceId: 'workspace-id-123',
      hostAlias: 'my-workspace@cluster1',
      clusterUrl: 'https://devspaces.apps.cluster1.example.com',
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('queryWorkspacePhase', () => {
    it('returns Running when workspace is Running', async () => {
      mockCustomApi.getNamespacedCustomObject.mockResolvedValue({ status: { phase: 'Running' } });

      const monitor = new WorkspaceStatusMonitor(mockDeps, mockKubeConfig, 'ws-pod-abc', undefined);
      const phase = await monitor.queryWorkspacePhase(connInfo);

      expect(phase).toBe('Running');
    });

    it('returns Stopped when workspace is Stopped', async () => {
      mockCustomApi.getNamespacedCustomObject.mockResolvedValue({ status: { phase: 'Stopped' } });

      const monitor = new WorkspaceStatusMonitor(mockDeps, mockKubeConfig, 'ws-pod-abc', undefined);
      const phase = await monitor.queryWorkspacePhase(connInfo);

      expect(phase).toBe('Stopped');
    });

    it('returns Starting when workspace is Starting', async () => {
      mockCustomApi.getNamespacedCustomObject.mockResolvedValue({ status: { phase: 'Starting' } });

      const monitor = new WorkspaceStatusMonitor(mockDeps, mockKubeConfig, 'ws-pod-abc', undefined);
      const phase = await monitor.queryWorkspacePhase(connInfo);

      expect(phase).toBe('Starting');
    });

    it('returns Stopping when workspace is Stopping', async () => {
      mockCustomApi.getNamespacedCustomObject.mockResolvedValue({ status: { phase: 'Stopping' } });

      const monitor = new WorkspaceStatusMonitor(mockDeps, mockKubeConfig, 'ws-pod-abc', undefined);
      const phase = await monitor.queryWorkspacePhase(connInfo);

      expect(phase).toBe('Stopping');
    });

    it('returns Failed when workspace is Failing', async () => {
      mockCustomApi.getNamespacedCustomObject.mockResolvedValue({ status: { phase: 'Failing' } });

      const monitor = new WorkspaceStatusMonitor(mockDeps, mockKubeConfig, 'ws-pod-abc', undefined);
      const phase = await monitor.queryWorkspacePhase(connInfo);

      expect(phase).toBe('Failed');
    });

    it('returns Failed when workspace is Failed', async () => {
      mockCustomApi.getNamespacedCustomObject.mockResolvedValue({ status: { phase: 'Failed' } });

      const monitor = new WorkspaceStatusMonitor(mockDeps, mockKubeConfig, 'ws-pod-abc', undefined);
      const phase = await monitor.queryWorkspacePhase(connInfo);

      expect(phase).toBe('Failed');
    });

    it('returns Unknown for unrecognized phases', async () => {
      mockCustomApi.getNamespacedCustomObject.mockResolvedValue({ status: { phase: 'Terminating' } });

      const monitor = new WorkspaceStatusMonitor(mockDeps, mockKubeConfig, 'ws-pod-abc', undefined);
      const phase = await monitor.queryWorkspacePhase(connInfo);

      expect(phase).toBe('Unknown');
    });

    it('returns Unknown when no kubeConfig available', async () => {
      const monitorNoKube = new WorkspaceStatusMonitor(
        { ...mockDeps, getKubeConfig: jest.fn().mockResolvedValue(undefined) },
        undefined as any,
        'ws-pod-abc',
        undefined
      );
      const phase = await monitorNoKube.queryWorkspacePhase(connInfo);

      expect(phase).toBe('Unknown');
    });

    it('returns NotFound when workspace returns 404 via statusCode', async () => {
      const notFoundErr: any = new Error('devworkspaces.workspace.devfile.io "my-workspace" not found');
      notFoundErr.statusCode = 404;
      mockCustomApi.getNamespacedCustomObject.mockRejectedValue(notFoundErr);

      const monitor = new WorkspaceStatusMonitor(mockDeps, mockKubeConfig, 'ws-pod-abc', undefined);
      const phase = await monitor.queryWorkspacePhase(connInfo);

      expect(phase).toBe('NotFound');
    });

    it('returns NotFound when workspace returns 404 via response.statusCode', async () => {
      const notFoundErr: any = new Error('not found');
      notFoundErr.response = { statusCode: 404 };
      mockCustomApi.getNamespacedCustomObject.mockRejectedValue(notFoundErr);

      const monitor = new WorkspaceStatusMonitor(mockDeps, mockKubeConfig, 'ws-pod-abc', undefined);
      const phase = await monitor.queryWorkspacePhase(connInfo);

      expect(phase).toBe('NotFound');
    });

    it('returns NotFound when workspace returns 404 via body.code', async () => {
      const notFoundErr: any = new Error('not found');
      notFoundErr.body = { code: 404, message: 'not found' };
      mockCustomApi.getNamespacedCustomObject.mockRejectedValue(notFoundErr);

      const monitor = new WorkspaceStatusMonitor(mockDeps, mockKubeConfig, 'ws-pod-abc', undefined);
      const phase = await monitor.queryWorkspacePhase(connInfo);

      expect(phase).toBe('NotFound');
    });

    it('returns NotFound when error message contains HTTP-Code: 404', async () => {
      const notFoundErr = new Error('HTTP-Code: 404\nMessage: Unknown API Status Code!\nBody: "..."');
      mockCustomApi.getNamespacedCustomObject.mockRejectedValue(notFoundErr);

      const monitor = new WorkspaceStatusMonitor(mockDeps, mockKubeConfig, 'ws-pod-abc', undefined);
      const phase = await monitor.queryWorkspacePhase(connInfo);

      expect(phase).toBe('NotFound');
    });

    it('returns NotFound when error message contains "code":404 JSON', async () => {
      const notFoundErr = new Error('{"kind":"Status","status":"Failure","code":404}');
      mockCustomApi.getNamespacedCustomObject.mockRejectedValue(notFoundErr);

      const monitor = new WorkspaceStatusMonitor(mockDeps, mockKubeConfig, 'ws-pod-abc', undefined);
      const phase = await monitor.queryWorkspacePhase(connInfo);

      expect(phase).toBe('NotFound');
    });

    it('returns Unknown for non-404 errors', async () => {
      mockCustomApi.getNamespacedCustomObject.mockRejectedValue(new Error('network timeout'));

      const monitor = new WorkspaceStatusMonitor(mockDeps, mockKubeConfig, 'ws-pod-abc', undefined);
      const phase = await monitor.queryWorkspacePhase(connInfo);

      expect(phase).toBe('Unknown');
    });
  });

  describe('start and polling', () => {
    it('shows deleted dialog when workspace is NotFound during polling', async () => {
      const notFoundErr: any = new Error('not found');
      notFoundErr.statusCode = 404;
      mockCustomApi.getNamespacedCustomObject.mockRejectedValue(notFoundErr);

      // Mock the dialog
      (vscode.window.showErrorMessage as jest.Mock).mockResolvedValue('Close Remote');
      (vscode.commands.executeCommand as jest.Mock).mockResolvedValue(undefined);

      const monitor = new WorkspaceStatusMonitor(mockDeps, mockKubeConfig, 'ws-pod-abc', undefined);
      monitor.start(connInfo);

      // Advance past the 5s polling interval
      await jest.advanceTimersByTimeAsync(5100);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        `Workspace "my-workspace" no longer exists. It may have been deleted from the cluster.`,
        { modal: true },
        'Close Remote'
      );
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.remote.close');

      monitor.dispose();
    });

    it('shows stopped dialog when workspace is Stopped during polling', async () => {
      mockCustomApi.getNamespacedCustomObject.mockResolvedValue({ status: { phase: 'Stopped' } });

      (vscode.window.showErrorMessage as jest.Mock).mockResolvedValue('Close Remote');
      (vscode.commands.executeCommand as jest.Mock).mockResolvedValue(undefined);

      const monitor = new WorkspaceStatusMonitor(mockDeps, mockKubeConfig, 'ws-pod-abc', undefined);
      monitor.start(connInfo);

      await jest.advanceTimersByTimeAsync(5100);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'Your workspace is not running.',
        { modal: true },
        'Restart Workspace',
        'Close Remote'
      );

      monitor.dispose();
    });

    it('shows stopped dialog when workspace is Failed during polling', async () => {
      mockCustomApi.getNamespacedCustomObject.mockResolvedValue({ status: { phase: 'Failed' } });

      (vscode.window.showErrorMessage as jest.Mock).mockResolvedValue('Close Remote');
      (vscode.commands.executeCommand as jest.Mock).mockResolvedValue(undefined);

      const monitor = new WorkspaceStatusMonitor(mockDeps, mockKubeConfig, 'ws-pod-abc', undefined);
      monitor.start(connInfo);

      await jest.advanceTimersByTimeAsync(5100);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'Your workspace is not running.',
        { modal: true },
        'Restart Workspace',
        'Close Remote'
      );

      monitor.dispose();
    });

    it('does not show dialog when workspace is Running', async () => {
      mockCustomApi.getNamespacedCustomObject.mockResolvedValue({ status: { phase: 'Running' } });
      mockDeps.findWorkspacePod.mockResolvedValue({ podName: 'ws-pod-abc', containerName: 'tools' });

      const monitor = new WorkspaceStatusMonitor(mockDeps, mockKubeConfig, 'ws-pod-abc', undefined);
      monitor.start(connInfo);

      await jest.advanceTimersByTimeAsync(5100);

      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();

      monitor.dispose();
    });
  });

  describe('waitForPhase', () => {
    it('returns true when target phase is reached', async () => {
      mockCustomApi.getNamespacedCustomObject
        .mockResolvedValueOnce({ status: { phase: 'Starting' } })
        .mockResolvedValueOnce({ status: { phase: 'Running' } });

      const monitor = new WorkspaceStatusMonitor(mockDeps, mockKubeConfig, 'ws-pod-abc', undefined);

      const promise = monitor.waitForPhase(connInfo, 'Running', 30_000);
      // Advance through the sleep intervals
      await jest.advanceTimersByTimeAsync(3100);
      await jest.advanceTimersByTimeAsync(3100);

      const result = await promise;
      expect(result).toBe(true);
    });

    it('returns false when workspace enters Failed phase', async () => {
      mockCustomApi.getNamespacedCustomObject
        .mockResolvedValueOnce({ status: { phase: 'Starting' } })
        .mockResolvedValueOnce({ status: { phase: 'Failed' } });

      const monitor = new WorkspaceStatusMonitor(mockDeps, mockKubeConfig, 'ws-pod-abc', undefined);

      const promise = monitor.waitForPhase(connInfo, 'Running', 30_000);
      await jest.advanceTimersByTimeAsync(3100);
      await jest.advanceTimersByTimeAsync(3100);

      const result = await promise;
      expect(result).toBe(false);
    });

    it('returns false when workspace enters Stopped phase', async () => {
      mockCustomApi.getNamespacedCustomObject
        .mockResolvedValueOnce({ status: { phase: 'Starting' } })
        .mockResolvedValueOnce({ status: { phase: 'Stopped' } });

      const monitor = new WorkspaceStatusMonitor(mockDeps, mockKubeConfig, 'ws-pod-abc', undefined);

      const promise = monitor.waitForPhase(connInfo, 'Running', 30_000);
      await jest.advanceTimersByTimeAsync(3100);
      await jest.advanceTimersByTimeAsync(3100);

      const result = await promise;
      expect(result).toBe(false);
    });
  });

  describe('dispose', () => {
    it('stops polling on dispose', () => {
      mockCustomApi.getNamespacedCustomObject.mockResolvedValue({ status: { phase: 'Running' } });
      mockDeps.findWorkspacePod.mockResolvedValue({ podName: 'ws-pod-abc', containerName: 'tools' });

      const monitor = new WorkspaceStatusMonitor(mockDeps, mockKubeConfig, 'ws-pod-abc', undefined);
      monitor.start(connInfo);
      monitor.dispose();

      // Advance time — should not trigger any API calls since we disposed
      jest.advanceTimersByTime(10_000);

      // getNamespacedCustomObject should not have been called because timer was cleared
      expect(mockCustomApi.getNamespacedCustomObject).not.toHaveBeenCalled();
    });

    it('stop is idempotent', () => {
      const monitor = new WorkspaceStatusMonitor(mockDeps, mockKubeConfig, 'ws-pod-abc', undefined);
      monitor.start(connInfo);
      monitor.stop();
      monitor.stop(); // should not throw
      monitor.dispose(); // also should not throw
    });
  });
});
