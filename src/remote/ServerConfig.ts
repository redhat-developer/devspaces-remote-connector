import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../util/Logger';

export interface ServerConfig {
  version: string;
  commit: string;
  quality: string;
  serverApplicationName: string;
  serverDataFolderName: string;
  downloadUrlTemplate: string;
}

let cachedConfig: ServerConfig | undefined;

/**
 * Read the IDE's product.json to determine the REH server version, commit,
 * and binary names. Falls back to sensible defaults.
 */
export async function getServerConfig(): Promise<ServerConfig> {
  if (cachedConfig) { return cachedConfig; }

  const logger = Logger.getInstance();
  const isKiro = vscode.env.appName?.toLowerCase().includes('kiro');

  try {
    const productJsonPath = path.join(vscode.env.appRoot, 'product.json');
    const raw = await fs.promises.readFile(productJsonPath, 'utf-8');
    const product = JSON.parse(raw);

    const userUrl = vscode.workspace.getConfiguration('devspaces').get<string>('rehDownloadUrl') ?? '';
    let rehUrl = userUrl;
    logger.info(`ServerConfig: rehDownloadUrl = '${rehUrl || '(using product.json)'}'`);
    const defaultAppName = isKiro ? 'kiro-server' : 'code-server';
    const defaultDataFolder = isKiro ? '.kiro-server' : '.vscode-server';

    cachedConfig = {
      version: vscode.version.replace('-insider', ''),
      commit: product.commit ?? 'unknown',
      quality: product.quality ?? 'stable',
      serverApplicationName: product.serverApplicationName ?? defaultAppName,
      serverDataFolderName: product.serverDataFolderName ?? defaultDataFolder,
      downloadUrlTemplate: rehUrl || product.serverDownloadUrlTemplate || constructFallbackUrl(product) || '',
    };

    logger.debug(`Server config: version=${cachedConfig.version} commit=${cachedConfig.commit.slice(0, 8)} app=${cachedConfig.serverApplicationName}`);
  } catch (err) {
    logger.warn(`Failed to read product.json, using defaults: ${err}`);
    const defaultAppName = isKiro ? 'kiro-server' : 'code-server';
    const defaultDataFolder = isKiro ? '.kiro-server' : '.vscode-server';
    cachedConfig = {
      version: vscode.version,
      commit: 'unknown',
      quality: 'stable',
      serverApplicationName: defaultAppName,
      serverDataFolderName: defaultDataFolder,
      downloadUrlTemplate: '',
    };
  }

  return cachedConfig;
}

/**
 * Construct a fallback REH download URL from product.json fields.
 * VS Code doesn't have serverDownloadUrlTemplate but has updateUrl.
 */
function constructFallbackUrl(product: any): string {
  if (product.updateUrl) {
    // VS Code pattern: https://update.code.visualstudio.com/commit:${commit}/server-${os}-${arch}/stable
    return `${product.updateUrl}/commit:\${commit}/server-\${os}-\${arch}/${product.quality ?? 'stable'}`;
  }
  return '';
}
