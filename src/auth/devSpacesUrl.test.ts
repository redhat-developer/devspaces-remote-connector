import { resolveDevSpacesUrl, CustomObjectReader } from './devSpacesUrl';

const SHARED = 'https://devspaces.apps.shared.example.com';
const DEFAULT_INGRESS = 'https://devspaces.apps.cluster.example.com';

describe('resolveDevSpacesUrl', () => {
  it('keeps the CheCluster host and returns immediately without querying routes or consolelinks', async () => {
    const reader = fakeReader({
      checlusters: {
        items: [{
          metadata: { name: 'devspaces', namespace: 'openshift-devspaces' },
          status: { cheURL: `${SHARED}/dashboard/` },
        }],
      },
      routes: {
        items: [{ metadata: { name: 'devspaces' }, spec: { host: 'devspaces.apps.shared.example.com' } }],
      },
      consolelinks: {
        items: [{ metadata: { name: 'che' }, spec: { href: DEFAULT_INGRESS } }],
      },
    });

    const chosen = await resolveDevSpacesUrl(reader, DEFAULT_INGRESS);

    expect(chosen).toEqual({ url: SHARED, source: 'che-cluster' });
    expect(reader.listNamespacedCustomObject).not.toHaveBeenCalled();
    expect(reader.listClusterCustomObject).toHaveBeenCalledTimes(1);
  });

  it('accepts a custom CheCluster hostname that does not start with devspaces.', async () => {
    const reader = fakeReader({
      checlusters: {
        items: [{ status: { cheURL: 'https://workspaces.shared.example.com' } }],
      },
    });

    await expect(resolveDevSpacesUrl(reader, DEFAULT_INGRESS)).resolves.toEqual({
      url: 'https://workspaces.shared.example.com',
      source: 'che-cluster',
    });
  });

  it('uses spec.networking.hostname when status.cheURL is not set yet', async () => {
    const reader = fakeReader({
      checlusters: {
        items: [{
          metadata: { name: 'devspaces', namespace: 'eclipse-che' },
          spec: { networking: { hostname: 'devspaces.shared.example.com' } },
        }],
      },
    });

    await expect(resolveDevSpacesUrl(reader, DEFAULT_INGRESS)).resolves.toEqual({
      url: 'https://devspaces.shared.example.com',
      source: 'che-cluster',
    });
  });

  it('rejects non-https origins when selecting a dashboard URL', async () => {
    const reader = fakeReader({
      checlusters: {
        items: [{ status: { cheURL: 'http://devspaces.apps.shared.example.com' } }],
      },
      routes: { items: [] },
      consolelinks: {
        items: [{ metadata: { name: 'che' }, spec: { href: SHARED } }],
      },
    });

    await expect(resolveDevSpacesUrl(reader, DEFAULT_INGRESS)).resolves.toEqual({
      url: SHARED,
      source: 'console-link',
    });
  });

  it('uses the Dev Spaces route when CheCluster cannot be read and skips consolelinks', async () => {
    const reader = fakeReader({
      checlusters: { items: [] },
      routes: {
        items: [
          { metadata: { name: 'plugin-registry' }, spec: { host: 'plugin-registry.apps.cluster.example.com' } },
          { metadata: { name: 'devspaces' }, spec: { host: 'devspaces.apps.shared.example.com' } },
        ],
      },
      consolelinks: {
        items: [{ metadata: { name: 'che' }, spec: { href: DEFAULT_INGRESS } }],
      },
    });

    const chosen = await resolveDevSpacesUrl(reader, DEFAULT_INGRESS);

    expect(chosen).toEqual({ url: SHARED, source: 'route' });
    expect(reader.listClusterCustomObject).toHaveBeenCalledTimes(1);
  });

  it('falls through to the console link when CheCluster and routes are forbidden', async () => {
    const reader: CustomObjectReader = {
      listClusterCustomObject: jest.fn(async (request) => {
        if (request.plural === 'checlusters') {
          throw new Error('checlusters is forbidden');
        }
        return {
          items: [{
            metadata: { name: 'che' },
            spec: { href: `${SHARED}/` },
          }],
        };
      }),
      listNamespacedCustomObject: jest.fn(async () => {
        throw new Error('routes is forbidden');
      }),
    };
    const notes: string[] = [];

    const chosen = await resolveDevSpacesUrl(reader, DEFAULT_INGRESS, (message) => notes.push(message));

    expect(chosen).toEqual({ url: SHARED, source: 'console-link' });
    expect(notes.some((note) => note.includes('CheCluster lookup failed'))).toBe(true);
    expect(notes.some((note) => note.includes('Route lookup in openshift-devspaces failed'))).toBe(true);
  });

  it('ignores unrelated console links whose name or href merely contains "che" as a substring', async () => {
    const reader = fakeReader({
      checlusters: { items: [] },
      routes: { items: [] },
      consolelinks: {
        items: [
          { metadata: { name: 'rancher-dashboard' }, spec: { href: 'https://rancher.apps.shared.example.com' } },
          { metadata: { name: 'apache-docs' }, spec: { href: 'https://apache.apps.shared.example.com' } },
          { metadata: { name: 'che' }, spec: { href: SHARED } },
        ],
      },
    });

    await expect(resolveDevSpacesUrl(reader, DEFAULT_INGRESS)).resolves.toEqual({
      url: SHARED,
      source: 'console-link',
    });
  });

  it('keeps a dashboard URL the user typed when the cluster lookup is empty', async () => {
    const reader = fakeReader({});

    await expect(resolveDevSpacesUrl(reader, `${SHARED}/dashboard/#/workspaces`)).resolves.toEqual({
      url: SHARED,
      source: 'fallback',
    });
  });

  it('does not treat an API server URL as a dashboard host', async () => {
    const reader = fakeReader({
      checlusters: {
        items: [{ status: { cheURL: 'https://api.cluster.example.com:6443' } }],
      },
    });

    await expect(resolveDevSpacesUrl(reader, DEFAULT_INGRESS)).resolves.toEqual({
      url: DEFAULT_INGRESS,
      source: 'fallback',
    });
  });
});

function fakeReader(lists: {
  checlusters?: any;
  routes?: any;
  consolelinks?: any;
}): CustomObjectReader {
  return {
    listClusterCustomObject: jest.fn(async (request) => {
      if (request.plural === 'checlusters') {
        return lists.checlusters ?? { items: [] };
      }
      if (request.plural === 'consolelinks') {
        return lists.consolelinks ?? { items: [] };
      }
      throw new Error(`unexpected list ${request.plural}`);
    }),
    listNamespacedCustomObject: jest.fn(async () => lists.routes ?? { items: [] }),
  };
}
