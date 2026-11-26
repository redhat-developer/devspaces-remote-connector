/**
 * Resolve the Dev Spaces dashboard URL published by the cluster.
 *
 * Signing in with the API server used to invent `https://devspaces.` plus the
 * apps domain guessed from that API host. A shared ingress publishes the
 * dashboard on a different host. Calls to the guessed host then fail as
 * unauthenticated. The CheCluster route (`status.cheURL`) is the host the
 * gateway actually serves.
 */

export interface CustomObjectListRequest {
  group: string;
  version: string;
  plural: string;
  namespace?: string;
}

export interface CustomObjectReader {
  listClusterCustomObject(request: CustomObjectListRequest): Promise<any>;
  listNamespacedCustomObject(request: CustomObjectListRequest & { namespace: string }): Promise<any>;
}

export type DevSpacesUrlSource = 'che-cluster' | 'route' | 'console-link' | 'fallback';

export interface ChosenDevSpacesUrl {
  url: string;
  source: DevSpacesUrlSource;
}

/**
 * Resolve the public Dev Spaces dashboard origin from cluster resources,
 * returning as soon as the highest-priority source yields a valid HTTPS URL:
 *
 * 1. `CheCluster` (`status.cheURL`, then `spec.networking.hostname`)
 * 2. OpenShift `Route` in the Dev Spaces namespace
 * 3. OpenShift `ConsoleLink`
 * 4. `fallbackUrl` derived from user input
 */
export async function resolveDevSpacesUrl(
  reader: CustomObjectReader,
  fallbackUrl: string,
  onDebug: (message: string) => void = () => undefined,
): Promise<ChosenDevSpacesUrl> {
  const cheItems = await tryList(
    () => reader.listClusterCustomObject({
      group: 'org.eclipse.che',
      version: 'v2',
      plural: 'checlusters',
    }),
    (err) => onDebug(`CheCluster lookup failed: ${errorText(err)}`),
  );

  const che = firstPublicOrigin(cheCandidates(cheItems));
  if (che) {
    return { url: che, source: 'che-cluster' };
  }

  const namespaces = new Set<string>();
  for (const item of cheItems) {
    const namespace = item?.metadata?.namespace;
    if (typeof namespace === 'string' && namespace) {
      namespaces.add(namespace);
    }
  }
  if (namespaces.size === 0) {
    namespaces.add('openshift-devspaces');
  }

  for (const namespace of namespaces) {
    const routes = await tryList(
      () => reader.listNamespacedCustomObject({
        group: 'route.openshift.io',
        version: 'v1',
        namespace,
        plural: 'routes',
      }),
      (err) => onDebug(`Route lookup in ${namespace} failed: ${errorText(err)}`),
    );
    const route = firstPublicOrigin(routeCandidates(routes));
    if (route) {
      return { url: route, source: 'route' };
    }
  }

  const links = await tryList(
    () => reader.listClusterCustomObject({
      group: 'console.openshift.io',
      version: 'v1',
      plural: 'consolelinks',
    }),
    (err) => onDebug(`ConsoleLink lookup failed: ${errorText(err)}`),
  );
  const link = firstPublicOrigin(consoleLinkCandidates(links));
  if (link) {
    return { url: link, source: 'console-link' };
  }

  return { url: originKeepingApiHost(fallbackUrl), source: 'fallback' };
}

async function tryList(
  load: () => Promise<any>,
  onError: (err: unknown) => void,
): Promise<any[]> {
  try {
    return itemsOf(await load());
  } catch (err) {
    onError(err);
    return [];
  }
}

function itemsOf(response: any): any[] {
  if (Array.isArray(response?.items)) {
    return response.items;
  }
  if (Array.isArray(response?.body?.items)) {
    return response.body.items;
  }
  return [];
}

function cheCandidates(items: any[]): string[] {
  const found: { url: string; rank: number }[] = [];
  for (const item of items) {
    const url = cheUrl(item);
    if (!url) {
      continue;
    }
    found.push({
      url,
      rank: item?.metadata?.namespace === 'openshift-devspaces' ? 0 : 1,
    });
  }
  found.sort((left, right) => left.rank - right.rank);
  return found.map((entry) => entry.url);
}

function cheUrl(cluster: any): string | undefined {
  const statusUrl = cluster?.status?.cheURL;
  if (typeof statusUrl === 'string' && statusUrl.trim()) {
    return statusUrl.trim();
  }
  const hostname = cluster?.spec?.networking?.hostname;
  if (typeof hostname === 'string' && hostname.includes('.')) {
    const trimmed = hostname.trim();
    return trimmed.includes('://') ? trimmed : `https://${trimmed}`;
  }
  return undefined;
}

function routeCandidates(items: any[]): string[] {
  const found: { host: string; rank: number }[] = [];
  for (const item of items) {
    const host = item?.spec?.host;
    if (typeof host !== 'string' || !host.includes('.')) {
      continue;
    }
    const routeName = typeof item?.metadata?.name === 'string' ? item.metadata.name : '';
    let rank = 2;
    if (routeName === 'devspaces' || routeName === 'che') {
      rank = 0;
    } else if (host.startsWith('devspaces.') || host.startsWith('che.')) {
      rank = 1;
    } else {
      continue;
    }
    found.push({ host, rank });
  }
  found.sort((left, right) => left.rank - right.rank);
  return found.map((entry) => `https://${entry.host}`);
}

function consoleLinkCandidates(items: any[]): string[] {
  const hrefs: string[] = [];
  for (const item of items) {
    const href = item?.spec?.href;
    if (typeof href !== 'string' || !href.trim()) {
      continue;
    }
    const linkName = typeof item?.metadata?.name === 'string' ? item.metadata.name.toLowerCase() : '';
    const trimmedHref = href.trim();
    if (isDevSpacesConsoleLink(linkName, trimmedHref.toLowerCase())) {
      hrefs.push(trimmedHref);
    }
  }
  return hrefs;
}

function isDevSpacesConsoleLink(linkName: string, lowerHref: string): boolean {
  if (
    linkName.includes('devspaces') ||
    linkName.includes('codeready') ||
    lowerHref.includes('devspaces') ||
    lowerHref.includes('codeready') ||
    /(?:^|[-_.])che(?:$|[-_.])/.test(linkName)
  ) {
    return true;
  }
  try {
    const host = new URL(lowerHref.includes('://') ? lowerHref : `https://${lowerHref}`).hostname;
    return host.startsWith('che.');
  } catch {
    return false;
  }
}

function firstPublicOrigin(urls: string[]): string | undefined {
  for (const url of urls) {
    const origin = publicOrigin(url, false);
    if (origin) {
      return origin;
    }
  }
  return undefined;
}

function originKeepingApiHost(url: string): string {
  return publicOrigin(url, true) ?? url.trim().replace(/\/+$/, '');
}

function publicOrigin(url: string, allowApiHost: boolean): string | undefined {
  const trimmed = url.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    if (parsed.protocol !== 'https:') {
      return undefined;
    }
    if (!allowApiHost && parsed.hostname.startsWith('api.')) {
      return undefined;
    }
    return parsed.origin;
  } catch {
    return undefined;
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
