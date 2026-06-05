import { OAuthFlow } from './OAuthFlow';

describe('OAuthFlow', () => {
  let oauthFlow: OAuthFlow;

  beforeEach(() => {
    oauthFlow = new OAuthFlow();
  });

  describe('generateCodeVerifier', () => {
    it('returns a base64url-encoded string', () => {
      const verifier = oauthFlow.generateCodeVerifier();
      expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('returns 43 characters (32 bytes base64url)', () => {
      const verifier = oauthFlow.generateCodeVerifier();
      expect(verifier.length).toBe(43);
    });

    it('generates unique values', () => {
      const v1 = oauthFlow.generateCodeVerifier();
      const v2 = oauthFlow.generateCodeVerifier();
      expect(v1).not.toBe(v2);
    });
  });

  describe('computeCodeChallenge', () => {
    it('returns a base64url-encoded SHA256 hash', () => {
      const verifier = oauthFlow.generateCodeVerifier();
      const challenge = oauthFlow.computeCodeChallenge(verifier);
      expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('produces consistent output for same input', () => {
      const verifier = 'test-verifier-value';
      const c1 = oauthFlow.computeCodeChallenge(verifier);
      const c2 = oauthFlow.computeCodeChallenge(verifier);
      expect(c1).toBe(c2);
    });

    it('produces different output for different input', () => {
      const c1 = oauthFlow.computeCodeChallenge('verifier-a');
      const c2 = oauthFlow.computeCodeChallenge('verifier-b');
      expect(c1).not.toBe(c2);
    });

    it('returns 43 characters (SHA256 = 32 bytes base64url)', () => {
      const challenge = oauthFlow.computeCodeChallenge('any-verifier');
      expect(challenge.length).toBe(43);
    });
  });

  describe('generateState', () => {
    it('returns a hex string', () => {
      const state = oauthFlow.generateState();
      expect(state).toMatch(/^[0-9a-f]+$/);
    });

    it('returns 32 characters (16 bytes hex)', () => {
      const state = oauthFlow.generateState();
      expect(state.length).toBe(32);
    });

    it('generates unique values', () => {
      const s1 = oauthFlow.generateState();
      const s2 = oauthFlow.generateState();
      expect(s1).not.toBe(s2);
    });
  });
});
