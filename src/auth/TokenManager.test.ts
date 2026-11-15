import { TokenManager, StoredToken } from './TokenManager';
import { CLUSTERS_STATE_KEY } from '../kubernetes/knownApiUrl';

describe('TokenManager', () => {
  let tokenManager: TokenManager;
  let mockGlobalState: { get: jest.Mock; update: jest.Mock };
  const clusterUrl = 'https://devspaces.apps.cluster.example.com';

  beforeEach(() => {
    mockGlobalState = {
      get: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
    };
    tokenManager = new TokenManager(mockGlobalState as any);
  });

  afterEach(() => {
    tokenManager.dispose();
  });

  describe('storeToken', () => {
    it('stores token with correct key prefix', async () => {
      const token: StoredToken = {
        accessToken: 'sha256~abc123',
        clusterUrl,
        expiresAt: Date.now() + 3600000,
      };
      await tokenManager.storeToken(clusterUrl, token);
      expect(mockGlobalState.update).toHaveBeenCalledWith(
        `devspaces.token.${clusterUrl}`,
        expect.any(String)
      );
    });

    it('sets default expiry if not provided', async () => {
      const token: StoredToken = {
        accessToken: 'sha256~abc123',
        clusterUrl,
      };
      await tokenManager.storeToken(clusterUrl, token);
      const storedJson = mockGlobalState.update.mock.calls[0][1];
      const stored = JSON.parse(storedJson);
      expect(stored.expiresAt).toBeGreaterThan(Date.now());
      expect(stored.expiresAt).toBeLessThanOrEqual(Date.now() + 3600001);
    });

    it('preserves existing expiry', async () => {
      const expiresAt = Date.now() + 7200000;
      const token: StoredToken = {
        accessToken: 'sha256~abc123',
        clusterUrl,
        expiresAt,
      };
      await tokenManager.storeToken(clusterUrl, token);
      const storedJson = mockGlobalState.update.mock.calls[0][1];
      const stored = JSON.parse(storedJson);
      expect(stored.expiresAt).toBe(expiresAt);
    });
  });

  describe('getToken', () => {
    it('returns parsed token when valid JSON exists', async () => {
      const token: StoredToken = {
        accessToken: 'sha256~abc123',
        clusterUrl,
        expiresAt: Date.now() + 3600000,
      };
      mockGlobalState.get.mockReturnValue(JSON.stringify(token));
      const result = await tokenManager.getToken(clusterUrl);
      expect(result).toEqual(token);
    });

    it('returns undefined when no token stored', async () => {
      mockGlobalState.get.mockReturnValue(undefined);
      const result = await tokenManager.getToken(clusterUrl);
      expect(result).toBeUndefined();
    });

    it('returns undefined and clears corrupt data', async () => {
      mockGlobalState.get.mockReturnValue('not-valid-json{{{');
      const result = await tokenManager.getToken(clusterUrl);
      expect(result).toBeUndefined();
      expect(mockGlobalState.update).toHaveBeenCalledWith(
        `devspaces.token.${clusterUrl}`,
        undefined
      );
    });
  });

  describe('deleteToken', () => {
    it('removes token from globalState', async () => {
      await tokenManager.deleteToken(clusterUrl);
      expect(mockGlobalState.update).toHaveBeenCalledWith(
        `devspaces.token.${clusterUrl}`,
        undefined
      );
    });
  });

  describe('isTokenValid', () => {
    it('returns true for token with future expiry', () => {
      const token: StoredToken = {
        accessToken: 'sha256~abc',
        clusterUrl,
        expiresAt: Date.now() + 3600000,
      };
      expect(tokenManager.isTokenValid(token)).toBe(true);
    });

    it('returns false for expired token', () => {
      const token: StoredToken = {
        accessToken: 'sha256~abc',
        clusterUrl,
        expiresAt: Date.now() - 1000,
      };
      expect(tokenManager.isTokenValid(token)).toBe(false);
    });

    it('returns true for token without expiry', () => {
      const token: StoredToken = {
        accessToken: 'sha256~abc',
        clusterUrl,
      };
      expect(tokenManager.isTokenValid(token)).toBe(true);
    });
  });

  describe('needsRefresh', () => {
    it('returns false for token far from expiry', () => {
      const token: StoredToken = {
        accessToken: 'sha256~abc',
        clusterUrl,
        expiresAt: Date.now() + 3600000,
      };
      expect(tokenManager.needsRefresh(token)).toBe(false);
    });

    it('returns true for token within refresh buffer', () => {
      const token: StoredToken = {
        accessToken: 'sha256~abc',
        clusterUrl,
        expiresAt: Date.now() + 30000, // 30s left, within 5min buffer
      };
      expect(tokenManager.needsRefresh(token)).toBe(true);
    });

    it('returns true for already expired token', () => {
      const token: StoredToken = {
        accessToken: 'sha256~abc',
        clusterUrl,
        expiresAt: Date.now() - 1000,
      };
      expect(tokenManager.needsRefresh(token)).toBe(true);
    });

    it('returns false for token without expiry', () => {
      const token: StoredToken = {
        accessToken: 'sha256~abc',
        clusterUrl,
      };
      expect(tokenManager.needsRefresh(token)).toBe(false);
    });
  });
});

class MemoryState {
  private data = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.data.get(key) as T | undefined;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.data.delete(key);
    } else {
      this.data.set(key, value);
    }
  }
}

describe('TokenManager shared-ingress aliases', () => {
  const apiUrl = 'https://api.cluster.example.com:6443';
  const dashboardUrl = 'https://devspaces.apps.shared.example.com';
  const appsDomain = 'apps.cluster.example.com';

  async function seedCluster(state: MemoryState): Promise<void> {
    await state.update(CLUSTERS_STATE_KEY, [{
      id: 'cluster',
      apiUrl,
      devSpacesUrl: dashboardUrl,
      appsDomain,
    }]);
  }

  it('finds a token stored under the API server when looking up the CheCluster host, appsDomain, or cluster id', async () => {
    const state = new MemoryState();
    const manager = new TokenManager(state as any);
    await manager.storeToken(apiUrl, {
      accessToken: 'sha256~from-api', // notsecret — test fixture only
      clusterUrl: apiUrl,
      expiresAt: Date.now() + 3600000,
    });
    await seedCluster(state);

    expect((await manager.getValidToken(dashboardUrl))?.accessToken).toBe('sha256~from-api'); // notsecret
    expect((await manager.getValidToken(appsDomain))?.accessToken).toBe('sha256~from-api'); // notsecret
    expect((await manager.getValidToken('cluster'))?.accessToken).toBe('sha256~from-api'); // notsecret
    manager.dispose();
  });

  it('deletes all alias keys for a cluster from a single deleteToken call', async () => {
    const state = new MemoryState();
    await seedCluster(state);
    const manager = new TokenManager(state as any);
    await manager.storeToken(apiUrl, {
      accessToken: 'sha256~from-api', // notsecret — test fixture only
      clusterUrl: apiUrl,
      expiresAt: Date.now() + 3600000,
    });

    await manager.deleteToken(dashboardUrl);

    expect(await manager.getValidToken(apiUrl)).toBeUndefined();
    expect(await manager.getValidToken(dashboardUrl)).toBeUndefined();
    expect(await manager.getValidToken('cluster')).toBeUndefined();
    manager.dispose();
  });
});
