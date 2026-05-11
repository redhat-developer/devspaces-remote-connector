import * as k8s from '@kubernetes/client-node';
import { Logger } from '../util/Logger';
import { TokenManager } from '../auth/TokenManager';
import { ClusterDiscovery } from '../auth/ClusterDiscovery';
import { KubeClientFactory } from '../kubernetes/KubeClientFactory';
import { STATE_CACHED_TOKEN } from '../constants';

const logger = Logger.getInstance();

/**
 * Creates the getKubeConfig callback for the DevSpacesResolver.
 */
export function createGetKubeConfig(
  globalState: { get<T>(key: string): T | undefined },
  tokenManager: TokenManager,
  kubeFactory: KubeClientFactory,
  clusterDiscovery: ClusterDiscovery
) {
  return async (clusterUrl: string): Promise<k8s.KubeConfig | undefined> => {
    try {
      logger.info(`Resolver getKubeConfig: clusterUrl=${clusterUrl}`);

      let accessToken: string | undefined;
      const storedToken = await tokenManager.getToken(clusterUrl);
      if (storedToken && tokenManager.isTokenValid(storedToken)) {
        accessToken = storedToken.accessToken;
        logger.info('Resolver getKubeConfig: token from SecretStorage');
      }

      if (!accessToken) {
        const fallbackToken = globalState.get<string>(STATE_CACHED_TOKEN);
        if (fallbackToken) {
          accessToken = fallbackToken;
          logger.info('Resolver getKubeConfig: token from globalState fallback');
        }
      }

      if (!accessToken) {
        logger.info('Resolver getKubeConfig: token NOT FOUND');
        return undefined;
      }

      const endpoints = await clusterDiscovery.discover(clusterUrl);
      logger.info(`Resolver getKubeConfig: apiUrl=${endpoints.apiUrl}`);
      return kubeFactory.createConfig(endpoints.apiUrl, accessToken);
    } catch (err) {
      logger.error(`Resolver getKubeConfig failed: ${err}`);
      return undefined;
    }
  };
}

/**
 * Creates the findPodAndContainer callback for the DevSpacesResolver.
 */
export function createFindPodAndContainer() {
  return async (
    kubeConfig: k8s.KubeConfig,
    namespace: string,
    devworkspaceId: string
  ): Promise<{ podName: string; containerName: string }> => {
    const coreApi = kubeConfig.makeApiClient(k8s.CoreV1Api);
    const podList = await coreApi.listNamespacedPod({
      namespace,
      labelSelector: `controller.devfile.io/devworkspace_id=${devworkspaceId}`,
    });
    const pods = podList.items;
    if (pods.length === 0) {
      throw new Error(`No running pod found for workspace ${devworkspaceId}`);
    }
    const pod = pods[0];

    // Find the main container by reading the DevWorkspace CR
    const customApi = kubeConfig.makeApiClient(k8s.CustomObjectsApi);
    const workspaceName = pod.metadata?.labels?.['controller.devfile.io/devworkspace_name'] ?? '';
    let mainContainerName: string | undefined;

    if (workspaceName) {
      try {
        const dw = await customApi.getNamespacedCustomObject({
          group: 'workspace.devfile.io',
          version: 'v1alpha2',
          namespace,
          plural: 'devworkspaces',
          name: workspaceName,
        }) as any;

        const components = dw?.spec?.template?.components ?? [];
        for (const comp of components) {
          if (comp.container && comp.container.mountSources !== false) {
            mainContainerName = comp.name;
            break;
          }
        }
        logger.debug(`DevWorkspace ${workspaceName}: main container from mountSources = ${mainContainerName}`);
      } catch (err) {
        logger.debug(`Could not read DevWorkspace CR: ${err}`);
      }
    }

    // Match the component name to the pod's container
    const containers = pod.spec?.containers ?? [];
    let mainContainer: k8s.V1Container | undefined;

    if (mainContainerName) {
      mainContainer = containers.find((c) => c.name === mainContainerName);
    }

    // Fallback: first container that isn't a known sidecar
    if (!mainContainer) {
      mainContainer = containers.find(
        (c: k8s.V1Container) =>
          !c.name.startsWith('che-gateway') &&
          !c.name.startsWith('che-machine-exec') &&
          !c.name.startsWith('che-code') &&
          !c.name.startsWith('che-editor')
      ) ?? containers[0];
    }

    return {
      podName: pod.metadata?.name ?? '',
      containerName: mainContainer?.name ?? 'tools',
    };
  };
}

/**
 * Creates the checkAndStartWorkspace callback for the DevSpacesResolver.
 */
export function createCheckAndStartWorkspace(
  globalState: { get<T>(key: string): T | undefined },
  tokenManager: TokenManager,
  kubeFactory: KubeClientFactory,
  clusterDiscovery: ClusterDiscovery
) {
  return async (
    clusterUrl: string,
    namespace: string,
    workspaceName: string
  ): Promise<'running' | 'started' | 'failed'> => {
    try {
      let accessToken: string | undefined;
      const storedToken = await tokenManager.getToken(clusterUrl);
      if (storedToken && tokenManager.isTokenValid(storedToken)) {
        accessToken = storedToken.accessToken;
      }
      if (!accessToken) {
        accessToken = globalState.get<string>(STATE_CACHED_TOKEN);
      }
      if (!accessToken) { return 'failed'; }

      const endpoints = await clusterDiscovery.discover(clusterUrl);
      const kubeConfig = kubeFactory.createConfig(endpoints.apiUrl, accessToken);
      const customApi = kubeConfig.makeApiClient(k8s.CustomObjectsApi);

      const dw = await customApi.getNamespacedCustomObject({
        group: 'workspace.devfile.io',
        version: 'v1alpha2',
        namespace,
        plural: 'devworkspaces',
        name: workspaceName,
      }) as any;

      const phase = dw?.status?.phase;
      logger.info(`Workspace ${workspaceName} phase: ${phase}`);

      if (phase === 'Running') {
        return 'running';
      }

      if (phase === 'Stopped' || phase === 'Failed') {
        logger.info(`Starting workspace ${workspaceName}...`);
        await customApi.patchNamespacedCustomObject({
          group: 'workspace.devfile.io',
          version: 'v1alpha2',
          namespace,
          plural: 'devworkspaces',
          name: workspaceName,
          body: [{ op: 'replace', path: '/spec/started', value: true }],
        });

        return await waitForPhase(customApi, namespace, workspaceName, 'Running', 300_000)
          ? 'started' : 'failed';
      }

      if (phase === 'Starting') {
        return await waitForPhase(customApi, namespace, workspaceName, 'Running', 300_000)
          ? 'running' : 'failed';
      }

      return 'failed';
    } catch (err) {
      logger.error(`checkAndStartWorkspace failed: ${err}`);
      return 'failed';
    }
  };
}

/**
 * Poll for a workspace to reach a target phase.
 */
async function waitForPhase(
  customApi: k8s.CustomObjectsApi,
  namespace: string,
  workspaceName: string,
  targetPhase: string,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const check = await customApi.getNamespacedCustomObject({
      group: 'workspace.devfile.io',
      version: 'v1alpha2',
      namespace,
      plural: 'devworkspaces',
      name: workspaceName,
    }) as any;
    const p = check?.status?.phase;
    if (p === targetPhase) { return true; }
    if (p === 'Failed') { return false; }
  }
  return false;
}
