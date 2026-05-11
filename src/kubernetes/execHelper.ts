import * as stream from 'stream';
import * as k8s from '@kubernetes/client-node';

/**
 * Execute a bash command on a pod via K8s exec and return stdout.
 */
export function execOnPod(
  kubeConfig: k8s.KubeConfig,
  namespace: string,
  podName: string,
  containerName: string,
  command: string | string[]
): Promise<string> {
  const exec = new k8s.Exec(kubeConfig);
  const cmd = typeof command === 'string' ? ['bash', '-c', command] : command;

  return new Promise<string>((resolve, reject) => {
    let stdout = '';
    const stdoutStream = new stream.Writable({
      write(chunk: Buffer, _encoding: string, cb: () => void) {
        stdout += chunk.toString();
        cb();
      },
    });
    const stderrStream = new stream.Writable({
      write(_chunk: Buffer, _encoding: string, cb: () => void) {
        cb();
      },
    });

    exec
      .exec(namespace, podName, containerName, cmd, stdoutStream, stderrStream, null, false,
        (status: k8s.V1Status) => {
          if (status.status === 'Success') {
            resolve(stdout.trim());
          } else {
            reject(new Error(status.message ?? 'Exec failed'));
          }
        }
      )
      .catch(reject);
  });
}
