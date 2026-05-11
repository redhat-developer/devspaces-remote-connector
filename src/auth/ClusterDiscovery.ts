import * as https from 'https';
import { Logger } from '../util/Logger';
import { getHttpsAgent } from '../util/tls';

export interface ClusterEndpoints {
  /** The DevSpaces dashboard base URL, e.g. https://devspaces.apps.devspc02-1d.zs5b.p1.openshiftapps.com */
  devSpacesUrl: string;
  /** The OpenShift API server URL, e.g. https://api.devspc02-1d.zs5b.p1.openshiftapps.com:6443 */
  apiUrl: string;
  /** The OAuth authorization endpoint */
  oauthAuthorizeUrl: string;
  /** The OAuth token endpoint */
  oauthTokenUrl: string;
  /** The cluster apps domain, e.g. apps.devspc02-1d.zs5b.p1.openshiftapps.com */
  appsDomain: string;
}

/**
 * Discovers OpenShift cluster endpoints from any URL the user provides.
 *
 * Handles all these URL patterns:
 * - https://devspaces.apps.devspc02-1d.zs5b.p1.openshiftapps.com/
 * - https://devspaces.apps.devspc02-1d.zs5b.p1.openshiftapps.com/dashboard/#/workspaces
 * - https://devspaces.apps.devspc02-1d.zs5b.p1.openshiftapps.com/284992/flights-mgmt/3100/
 * - https://console-openshift-console.apps.devspc02-1d.zs5b.p1.openshiftapps.com/
 * - https://devspaces.example.com (CNAME alias)
 * - https://api.devspc02-1d.zs5b.p1.openshiftapps.com:6443
 */
export class ClusterDiscovery {
  private logger = Logger.getInstance();

  /**
   * Extract the apps domain from any URL the user pastes.
   *
   * The apps domain is the part after the first subdomain:
   *   devspaces.apps.devspc02-1d.xxx → apps.devspc02-1d.xxx
   *   console-openshift-console.apps.devspc02-1d.xxx → apps.devspc02-1d.xxx
   *
   * For API URLs: api.devspc02-1d.xxx → apps.devspc02-1d.xxx
   * For CNAMEs (e.g. devspaces.example.com): we need to follow the /oauth/start redirect.
   */
  extractAppsDomain(inputUrl: string): string | undefined {
    try {
      const url = new URL(inputUrl);
      const host = url.hostname;

      // Pattern 1: api.<cluster-domain> → apps.<cluster-domain>
      if (host.startsWith('api.')) {
        return 'apps.' + host.slice(4);
      }

      // Pattern 2: <something>.apps.<cluster-domain> → apps.<cluster-domain>
      const appsIdx = host.indexOf('.apps.');
      if (appsIdx !== -1) {
        return host.slice(appsIdx + 1); // strip the leading subdomain
      }

      // Pattern 3: apps.<cluster-domain> directly
      if (host.startsWith('apps.')) {
        return host;
      }

      // Can't determine from hostname alone (e.g. CNAME alias)
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Normalize any user-provided URL into a clean DevSpaces base URL.
   * Strips paths, fragments, query params.
   */
  normalizeInputUrl(inputUrl: string): string {
    let url = inputUrl.trim();

    // Add https:// if missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    try {
      const parsed = new URL(url);
      // Return just the origin (scheme + host + port)
      return parsed.origin;
    } catch {
      return url.replace(/\/+$/, '');
    }
  }

  /**
   * Build the DevSpaces dashboard URL from the apps domain.
   */
  buildDevSpacesUrl(appsDomain: string): string {
    return `https://devspaces.${appsDomain}`;
  }

  /**
   * Discover cluster endpoints from any URL the user provides.
   */
  async discover(inputUrl: string): Promise<ClusterEndpoints> {
    this.logger.info(`Discovering cluster endpoints from: ${inputUrl}`);

    let appsDomain = this.extractAppsDomain(inputUrl);

    // If we couldn't extract from the hostname, try following /oauth/start
    if (!appsDomain) {
      const baseUrl = this.normalizeInputUrl(inputUrl);
      this.logger.debug(`Could not extract apps domain from hostname, trying /oauth/start redirect from ${baseUrl}`);
      appsDomain = await this.discoverAppsDomainViaRedirect(baseUrl);
    }

    const clusterBase = appsDomain.replace(/^apps\./, '');
    const apiUrl = `https://api.${clusterBase}:6443`;
    const devSpacesUrl = this.buildDevSpacesUrl(appsDomain);

    this.logger.debug(`Apps domain: ${appsDomain}`);
    this.logger.debug(`API URL: ${apiUrl}`);
    this.logger.debug(`DevSpaces URL: ${devSpacesUrl}`);

    // Fetch OAuth metadata from the API server
    const oauthMeta = await this.fetchOAuthMetadata(apiUrl);

    const endpoints: ClusterEndpoints = {
      devSpacesUrl,
      apiUrl,
      oauthAuthorizeUrl: oauthMeta.authorization_endpoint,
      oauthTokenUrl: oauthMeta.token_endpoint,
      appsDomain,
    };

    this.logger.info(`Cluster discovery complete: API=${apiUrl}, DevSpaces=${devSpacesUrl}`);
    return endpoints;
  }

  /**
   * Discover the apps domain by following the DevSpaces /oauth/start redirect.
   * Used as a fallback when the URL is a CNAME (e.g. devspaces.example.com).
   */
  private async discoverAppsDomainViaRedirect(baseUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = `${baseUrl}/oauth/start`;
      this.logger.debug(`Following redirect from ${url}`);

      const req = https.get(
        url,
        { timeout: 15_000, headers: { Accept: 'text/html' }, agent: getHttpsAgent() },
        (res) => {
          const location = res.headers.location;
          if (location) {
            try {
              const redirectUrl = new URL(location);
              const host = redirectUrl.hostname;
              // oauth-openshift.apps.<cluster-domain> → apps.<cluster-domain>
              const appsDomain = host.replace(/^oauth-openshift\./, '');
              if (appsDomain.startsWith('apps.')) {
                resolve(appsDomain);
                return;
              }
            } catch {
              // Fall through
            }
          }

          // Consume the response body to avoid socket hang
          res.resume();

          reject(
            new Error(
              `Could not discover cluster from ${baseUrl}. ` +
              `No valid redirect from /oauth/start (status: ${res.statusCode}). ` +
              `Try pasting a URL that contains the cluster domain (e.g. devspaces.example.com).`
            )
          );
        }
      );

      req.on('error', (err) => {
        reject(new Error(`Failed to connect to ${baseUrl}: ${err.message}`));
      });
      req.on('timeout', () => { req.destroy(); reject(new Error(`Connection to ${baseUrl} timed out`)); });
      req.end();
    });
  }

  /**
   * Fetch the OAuth metadata from the OpenShift API server.
   */
  private async fetchOAuthMetadata(
    apiUrl: string
  ): Promise<{ authorization_endpoint: string; token_endpoint: string }> {
    return new Promise((resolve, reject) => {
      const url = `${apiUrl}/.well-known/oauth-authorization-server`;
      this.logger.debug(`Fetching OAuth metadata from ${url}`);

      const req = https.get(url, { timeout: 15_000 }, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
          if (data.length > 1_048_576) { req.destroy(); reject(new Error('Response too large')); }
        });
        res.on('end', () => {
          try {
            const meta = JSON.parse(data);
            if (!meta.authorization_endpoint || !meta.token_endpoint) {
              reject(
                new Error(
                  'OAuth metadata missing authorization_endpoint or token_endpoint'
                )
              );
              return;
            }
            resolve(meta);
          } catch {
            reject(new Error(`Failed to parse OAuth metadata from ${apiUrl}: ${data.slice(0, 200)}`));
          }
        });
      });

      req.on('error', (err) => {
        reject(new Error(`Failed to fetch OAuth metadata from ${apiUrl}: ${err.message}`));
      });
      req.on('timeout', () => { req.destroy(); reject(new Error(`OAuth metadata request to ${apiUrl} timed out`)); });
      req.end();
    });
  }
}
