import * as k8s from '@kubernetes/client-node';
import * as stream from 'stream';
import { Logger } from '../util/Logger';
import {
  LABEL_DEVWORKSPACE_ID,
  SIDECAR_PREFIXES,
} from '../constants';

export interface WorkspacePod {
  name: string;
  namespace: string;
  mainContainerName: string;
  nodeName?: string;
  phase?: string;
}

/**
 * Pod operations: list, exec, and port-forward for workspace pods.
 * Uses the v1.x request-object API style.
 */
export class PodApi {
  private logger = Logger.getInstance();

  constructor(
    private coreApi: k8s.CoreV1Api,
    private kubeConfig: k8s.KubeConfig
  ) {}

  /**
   * Find the workspace pod for a given DevWorkspace ID.
   * DevWorkspace pods are labeled with controller.devfile.io/devworkspace_id.
   */
  async findWorkspacePod(
    namespace: string,
    devworkspaceId: string
  ): Promise<WorkspacePod> {
    this.logger.debug(
      `Finding pod for devworkspace ${devworkspaceId} in ${namespace}`
    );

    // v1.x API: pass a request object, returns V1PodList directly
    const podList = await this.coreApi.listNamespacedPod({
      namespace,
      labelSelector: `${LABEL_DEVWORKSPACE_ID}=${devworkspaceId}`,
    });

    const pods = podList.items;
    if (pods.length === 0) {
      throw new Error(
        `No pod found for workspace ${devworkspaceId} in ${namespace}`
      );
    }

    const pod = pods[0];
    const containers = pod.spec?.containers ?? [];

    // Find the user's dev container — exclude known sidecars
    const mainContainer =
      containers.find(
        (c: k8s.V1Container) =>
          !SIDECAR_PREFIXES.some((prefix) => c.name.startsWith(prefix))
      ) ?? containers[0];

    const result: WorkspacePod = {
      name: pod.metadata?.name ?? '',
      namespace,
      mainContainerName: mainContainer?.name ?? 'tools',
      nodeName: pod.spec?.nodeName,
      phase: pod.status?.phase,
    };

    this.logger.debug(
      `Found pod: ${result.name}, container: ${result.mainContainerName}`
    );
    return result;
  }

  /**
   * Execute a command in a pod container and return stdout as a string.
   */
  async exec(
    namespace: string,
    podName: string,
    containerName: string,
    command: string[]
  ): Promise<string> {
    this.logger.debug(
      `Exec in ${podName}/${containerName}: ${command.join(' ')}`
    );

    return new Promise((resolve, reject) => {
      const exec = new k8s.Exec(this.kubeConfig);
      let stdout = '';
      let stderr = '';

      const stdoutStream = new stream.Writable({
        write(chunk: Buffer, _encoding, callback) {
          stdout += chunk.toString();
          callback();
        },
      });

      const stderrStream = new stream.Writable({
        write(chunk: Buffer, _encoding, callback) {
          stderr += chunk.toString();
          callback();
        },
      });

      exec
        .exec(
          namespace,
          podName,
          containerName,
          command,
          stdoutStream,
          stderrStream,
          null, // stdin
          false, // tty
          (status: k8s.V1Status) => {
            if (status.status === 'Success') {
              resolve(stdout.trim());
            } else {
              reject(
                new Error(
                  `Exec failed: ${status.message ?? stderr.trim()}`
                )
              );
            }
          }
        )
        .catch(reject);
    });
  }
}
