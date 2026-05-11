import * as vscode from 'vscode';
import * as k8s from '@kubernetes/client-node';
import { Logger } from '../util/Logger';

export type ReadinessStatus = 'pending' | 'checking' | 'ready' | 'timeout';

export interface ReadinessResult {
  status: ReadinessStatus;
  message: string;
  durationMs: number;
}

/**
 * Polls for the required RoleBinding in the user's namespace.
 * This defends against the race condition where the DevSpaces operator
 * hasn't finished provisioning RBAC permissions before the user tries
 * to create a workspace.
 */
export class NamespaceReadinessChecker {
  private logger = Logger.getInstance();
  private status: ReadinessStatus = 'pending';
  private cancelRequested = false;

  private readonly onDidChangeStatusEmitter = new vscode.EventEmitter<ReadinessStatus>();
  readonly onDidChangeStatus = this.onDidChangeStatusEmitter.event;

  constructor(private rbacApi: k8s.RbacAuthorizationV1Api) {}

  getStatus(): ReadinessStatus {
    return this.status;
  }

  isReady(): boolean {
    return this.status === 'ready';
  }

  cancel(): void {
    this.cancelRequested = true;
  }

  /**
   * Check if the namespace needs initialization (created recently).
   */
  private async isNewNamespace(
    coreApi: k8s.CoreV1Api,
    namespace: string,
    thresholdSeconds: number
  ): Promise<boolean> {
    // Threshold of 0 means "always run the check" (useful for testing)
    if (thresholdSeconds === 0) {
      this.logger.info(`Namespace ${namespace}: threshold=0, forcing readiness check`);
      return true;
    }

    try {
      const ns = await coreApi.readNamespace({ name: namespace });
      const createdAt = new Date(ns.metadata?.creationTimestamp ?? 0);
      const ageSeconds = (Date.now() - createdAt.getTime()) / 1000;
      const isNew = ageSeconds < thresholdSeconds;
      this.logger.info(
        `Namespace ${namespace} age: ${Math.round(ageSeconds)}s (threshold: ${thresholdSeconds}s, new: ${isNew})`
      );
      return isNew;
    } catch (err: any) {
      this.logger.warn(`Failed to check namespace age: ${err?.message}`);
      return false;
    }
  }

  /**
   * Check if the required RoleBinding exists.
   */
  private async roleBindingExists(namespace: string, name: string): Promise<boolean> {
    try {
      await this.rbacApi.readNamespacedRoleBinding({ name, namespace });
      return true;
    } catch (err: any) {
      if (err?.response?.statusCode === 404 || err?.statusCode === 404) {
        return false;
      }
      // For other errors (network, etc.), log and return false
      this.logger.debug(`RoleBinding check error: ${err?.message}`);
      return false;
    }
  }

  /**
   * Main readiness check. Polls for the RoleBinding until it appears or timeout.
   *
   * @param coreApi - CoreV1Api for namespace age check
   * @param namespace - User's DevSpaces namespace
   * @returns ReadinessResult
   */
  async waitForReadiness(
    coreApi: k8s.CoreV1Api,
    namespace: string
  ): Promise<ReadinessResult> {
    const startTime = Date.now();
    const config = vscode.workspace.getConfiguration('devspaces');
    const roleBindingName = config.get<string>(
      'initialization.roleBindingName',
      'devspaces-user-container-build'
    );
    const timeoutSeconds = config.get<number>('initialization.timeout', 120);
    const pollIntervalSeconds = config.get<number>('initialization.pollInterval', 2);
    const namespaceAgeThreshold = config.get<number>('initialization.namespaceAgeThreshold', 300);

    this.logger.info(
      `Readiness check: namespace=${namespace}, roleBinding=${roleBindingName}, timeout=${timeoutSeconds}s`
    );

    // Check if namespace is new
    const isNew = await this.isNewNamespace(coreApi, namespace, namespaceAgeThreshold);
    if (!isNew) {
      this.status = 'ready';
      this.onDidChangeStatusEmitter.fire(this.status);
      return {
        status: 'ready',
        message: 'Namespace already initialized',
        durationMs: Date.now() - startTime,
      };
    }

    // Check if RoleBinding already exists (operator was fast)
    const alreadyExists = await this.roleBindingExists(namespace, roleBindingName);
    if (alreadyExists) {
      this.status = 'ready';
      this.onDidChangeStatusEmitter.fire(this.status);
      this.logger.info('RoleBinding already exists, namespace is ready');
      return {
        status: 'ready',
        message: 'RoleBinding found',
        durationMs: Date.now() - startTime,
      };
    }

    // Start polling
    this.status = 'checking';
    this.onDidChangeStatusEmitter.fire(this.status);
    this.logger.info(`Polling for RoleBinding "${roleBindingName}" every ${pollIntervalSeconds}s...`);

    const deadline = Date.now() + timeoutSeconds * 1000;
    let pollCount = 0;

    while (Date.now() < deadline && !this.cancelRequested) {
      await new Promise((r) => setTimeout(r, pollIntervalSeconds * 1000));

      if (this.cancelRequested) {
        break;
      }

      pollCount++;
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      this.logger.info(`Poll #${pollCount}: checking for RoleBinding "${roleBindingName}" (${elapsed}s elapsed)`);

      const exists = await this.roleBindingExists(namespace, roleBindingName);
      if (exists) {
        this.status = 'ready';
        this.onDidChangeStatusEmitter.fire(this.status);
        const duration = Date.now() - startTime;
        this.logger.info(`RoleBinding "${roleBindingName}" found after ${Math.round(duration / 1000)}s (poll #${pollCount})`);
        return {
          status: 'ready',
          message: `Namespace ready (took ${Math.round(duration / 1000)}s)`,
          durationMs: duration,
        };
      } else {
        this.logger.debug(`Poll #${pollCount}: RoleBinding "${roleBindingName}" not found yet`);
      }
    }

    // Timeout or cancelled
    this.status = 'timeout';
    this.onDidChangeStatusEmitter.fire(this.status);
    const duration = Date.now() - startTime;
    this.logger.warn(`Readiness check timed out after ${Math.round(duration / 1000)}s`);
    return {
      status: 'timeout',
      message: `Timed out waiting for namespace initialization (${timeoutSeconds}s)`,
      durationMs: duration,
    };
  }

  dispose(): void {
    this.cancelRequested = true;
    this.onDidChangeStatusEmitter.dispose();
  }
}
