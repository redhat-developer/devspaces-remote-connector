import * as k8s from '@kubernetes/client-node';
import { Logger } from '../util/Logger';

/**
 * Stateless factory for creating authenticated Kubernetes API clients.
 * Each call creates a fresh KubeConfig — no shared state between clusters.
 */
export class KubeClientFactory {
  private logger = Logger.getInstance();

  /**
   * Create a KubeConfig authenticated with the given bearer token.
   */
  createConfig(apiUrl: string, token: string): k8s.KubeConfig {
    const kc = new k8s.KubeConfig();

    kc.loadFromOptions({
      clusters: [
        {
          name: 'devspaces-cluster',
          server: apiUrl,
        },
      ],
      users: [
        {
          name: 'devspaces-user',
          token,
        },
      ],
      contexts: [
        {
          name: 'devspaces-context',
          cluster: 'devspaces-cluster',
          user: 'devspaces-user',
        },
      ],
      currentContext: 'devspaces-context',
    });

    this.logger.debug(`KubeConfig created for ${apiUrl}`);
    return kc;
  }
}
