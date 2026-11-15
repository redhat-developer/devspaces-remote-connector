import * as vscode from 'vscode';
import { Logger } from '../util/Logger';
import { TOKEN_REFRESH_BUFFER } from '../constants';
import { getClusters } from '../cluster/ClusterManager';
import { clusterIdFromUrl } from '../cluster/clusterId';
import { tokenStorageKeys } from '../kubernetes/knownApiUrl';

export interface StoredToken {
  accessToken: string;
  expiresAt?: number; // epoch ms
  clusterUrl: string;
  username?: string;
}

const TOKEN_KEY_PREFIX = 'devspaces.token.';

/** Default token lifetime if the server doesn't tell us (1 hour). */
const DEFAULT_TOKEN_LIFETIME_MS = 60 * 60 * 1000;

/**
 * Manages OAuth token storage, retrieval, and refresh.
 *
 * Tokens are stored in globalState (local SQLite DB) instead of
 * SecretStorage (OS keychain) to avoid the "OS keyring couldn't be
 * identified" error on macOS which causes tokens to not persist
 * across restarts. This is acceptable because:
 * - OAuth tokens are short-lived (24h expiry)
 * - Tokens are refreshed automatically via SSO
 * - globalState is local to the machine and not synced
 */
export class TokenManager {
  private logger = Logger.getInstance();
  private refreshTimer: NodeJS.Timeout | undefined;
  private onTokenExpiringCallback: (() => Promise<void>) | undefined;

  constructor(private globalState: vscode.Memento) {}

  onTokenExpiring(callback: () => Promise<void>): void {
    this.onTokenExpiringCallback = callback;
  }

  /** Resume the expiry timer after VS Code restart. */
  armRefresh(token: StoredToken): void {
    this.scheduleRefresh(token);
  }

  async storeToken(clusterUrl: string, token: StoredToken): Promise<void> {
    if (!token.expiresAt) {
      token.expiresAt = Date.now() + DEFAULT_TOKEN_LIFETIME_MS;
    }

    const key = this.keyFor(clusterUrl);
    await this.globalState.update(key, JSON.stringify(token));

    const expiresIn = Math.round((token.expiresAt - Date.now()) / 1000);
    this.logger.info(`Token stored for ${clusterUrl} (expires in ${expiresIn}s)`);

    this.scheduleRefresh(token);
  }

  /**
   * Look up a non-expired token for `clusterUrl`, checking all stored aliases
   * (API server URL, CheCluster dashboard URL, apps domain, and cluster ID)
   * registered in `globalState`.
   */
  async getValidToken(clusterUrl: string): Promise<StoredToken | undefined> {
    if (!clusterUrl) {
      return undefined;
    }
    for (const key of this.keysFor(clusterUrl)) {
      const stored = await this.readExactToken(key);
      if (stored && this.isTokenValid(stored)) {
        return stored;
      }
    }
    return undefined;
  }

  async getToken(clusterUrl: string): Promise<StoredToken | undefined> {
    if (!clusterUrl) {
      return undefined;
    }
    for (const key of this.keysFor(clusterUrl)) {
      const stored = await this.readExactToken(key);
      if (stored) {
        return stored;
      }
    }
    return undefined;
  }

  async deleteToken(clusterUrl: string): Promise<void> {
    for (const key of this.keysFor(clusterUrl)) {
      await this.globalState.update(this.keyFor(key), undefined);
    }
    this.logger.debug(`Token deleted for ${clusterUrl}`);
    this.cancelRefreshTimer();
  }

  private async readExactToken(key: string): Promise<StoredToken | undefined> {
    const storageKey = this.keyFor(key);
    const raw = this.globalState.get<string>(storageKey);
    if (!raw) {
      return undefined;
    }
    try {
      return JSON.parse(raw) as StoredToken;
    } catch {
      this.logger.warn(`Corrupt token data for ${key}, clearing`);
      await this.globalState.update(storageKey, undefined);
      return undefined;
    }
  }

  private keysFor(clusterUrl: string): string[] {
    const clusters = getClusters(this.globalState);
    const baseKeys = tokenStorageKeys(clusterUrl, clusters, [
      clusterIdFromUrl(clusterUrl),
    ]);
    const allKeys = [...baseKeys];
    for (const key of baseKeys) {
      if (key.includes('://')) {
        const derivedId = clusterIdFromUrl(key);
        if (derivedId && !allKeys.includes(derivedId)) {
          allKeys.push(derivedId);
        }
      }
    }
    return allKeys;
  }

  isTokenValid(token: StoredToken): boolean {
    if (!token.expiresAt) {
      return true;
    }
    return Date.now() < token.expiresAt;
  }

  needsRefresh(token: StoredToken): boolean {
    if (!token.expiresAt) {
      return false;
    }
    return Date.now() >= token.expiresAt - TOKEN_REFRESH_BUFFER;
  }

  private keyFor(clusterUrl: string): string {
    return `${TOKEN_KEY_PREFIX}${clusterUrl}`;
  }

  private scheduleRefresh(token: StoredToken): void {
    this.cancelRefreshTimer();

    if (!token.expiresAt) {
      return;
    }

    const refreshIn = token.expiresAt - TOKEN_REFRESH_BUFFER - Date.now();

    if (refreshIn <= 0) {
      this.logger.warn('Token is already within refresh window, triggering refresh now');
      void this.triggerRefresh();
      return;
    }

    const refreshInSec = Math.round(refreshIn / 1000);
    const expiresInSec = Math.round((token.expiresAt - Date.now()) / 1000);
    this.logger.info(
      `Token expires in ${expiresInSec}s, scheduling refresh in ${refreshInSec}s`
    );

    this.refreshTimer = setTimeout(() => {
      void this.triggerRefresh();
    }, refreshIn);
  }

  private async triggerRefresh(): Promise<void> {
    this.logger.info('Background token refresh triggered');

    if (!this.onTokenExpiringCallback) {
      this.logger.warn('No refresh callback registered — token will expire');
      return;
    }

    try {
      await this.onTokenExpiringCallback();
      this.logger.info('Background token refresh completed');
    } catch (err) {
      this.logger.error(`Background token refresh failed: ${err}`);
      const action = await vscode.window.showWarningMessage(
        'Dev Spaces session is about to expire. Sign in again to continue.',
        'Sign In'
      );
      if (action === 'Sign In') {
        vscode.commands.executeCommand('devspaces.signIn');
      }
    }
  }

  private cancelRefreshTimer(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  dispose(): void {
    this.cancelRefreshTimer();
  }
}
