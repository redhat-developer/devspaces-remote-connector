import { TokenManager, StoredToken } from './TokenManager';

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
