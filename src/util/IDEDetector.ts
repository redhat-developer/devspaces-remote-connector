import * as vscode from 'vscode';
import { Logger } from './Logger';

/**
 * Detects the IDE type and whether to sync Kiro credentials to remote workspaces.
 */

const logger = Logger.getInstance();

/**
 * IDE detection result
 */
export interface IDEInfo {
  isVSCode: boolean;
  isOSS: boolean;
  isVSCodium: boolean;
  isUnknownFork: boolean;
  isKiro: boolean;
}

/**
 * Detect the IDE type based on app name and URI scheme.
 *
 * Supports:
 * - VS Code (official)
 * - VS Code OSS
 * - VSCodium
 * - Kiro IDE
 * - Unknown forks
 */
export function detectIDE(): IDEInfo {
  const appName = vscode.env.appName.toLowerCase();
  const uriScheme = vscode.env.uriScheme;

  logger.info(`[detectIDE] appName: ${appName}, uriScheme: ${uriScheme}`);

  // Check for Kiro IDE first (highest priority)
  const isKiro = appName.includes('kiro') || process.env.KIRO_IDE === 'true' || hasKiroAgentExtension();

  const result: IDEInfo = {
    isVSCode: uriScheme.startsWith('vscode'),
    isOSS: appName.includes('oss') || uriScheme.includes('oss'),
    isVSCodium: appName.includes('codium'),
    isUnknownFork: !uriScheme.startsWith('vscode'),
    isKiro,
  };

  logger.info(`[detectIDE] Detection result: isVSCode=${result.isVSCode}, isOSS=${result.isOSS}, isVSCodium=${result.isVSCodium}, isUnknownFork=${result.isUnknownFork}, isKiro=${result.isKiro}`);

  return result;
}

/**
 * Check if Kiro agent extension is installed.
 */
function hasKiroAgentExtension(): boolean {
  try {
    const kiroAgentExt = vscode.extensions.getExtension('kiro.kiroAgent');
    if (kiroAgentExt) {
      logger.debug('[hasKiroAgentExtension] Kiro agent extension detected');
      return true;
    }
  } catch (err) {
    logger.debug(`[hasKiroAgentExtension] Error checking for Kiro agent extension: ${err}`);
  }
  return false;
}

/**
 * Check if running in Kiro IDE.
 *
 * Kiro IDE can be detected by:
 * 1. App name contains "Kiro"
 * 2. KIRO_IDE environment variable is set
 * 3. Kiro agent extension is installed
 */
export function isKiroIDE(): boolean {
  const ide = detectIDE();
  logger.debug(`[isKiroIDE] isKiro: ${ide.isKiro}`);
  return ide.isKiro;
}

/**
 * Check if Kiro IDE credentials should be synced to remote workspace.
 *
 * Returns true if:
 * 1. Running in Kiro IDE
 * 2. devspaces.syncKiroIDECredentials setting is enabled (default: true in Kiro IDE, false in other IDEs)
 *
 * This allows:
 * - Automatic syncing in Kiro IDE (default enabled)
 * - No syncing in VS Code, VSCodium, etc. (default disabled)
 * - Manual override via setting
 */
export function shouldSyncKiroIDECredentials(): boolean {
  const ide = detectIDE();
  logger.info(`[shouldSyncKiroIDECredentials] IDE detection: isKiro=${ide.isKiro}, isVSCode=${ide.isVSCode}, isOSS=${ide.isOSS}, isVSCodium=${ide.isVSCodium}`);

  // Determine default based on IDE
  const defaultSync = ide.isKiro;
  logger.info(`[shouldSyncKiroIDECredentials] Default sync for this IDE: ${defaultSync}`);

  const config = vscode.workspace.getConfiguration('devspaces');
  const syncEnabled = config.get<boolean>('syncKiroIDECredentials', defaultSync);

  logger.info(`[shouldSyncKiroIDECredentials] syncEnabled setting: ${syncEnabled} (default: ${defaultSync})`);

  if (!syncEnabled) {
    logger.info('[shouldSyncKiroIDECredentials] Kiro IDE credential sync disabled via setting');
    return false;
  }

  if (!ide.isKiro) {
    logger.info('[shouldSyncKiroIDECredentials] Not running in Kiro IDE, credential sync disabled');
    return false;
  }

  logger.info('[shouldSyncKiroIDECredentials] Kiro IDE credential sync enabled (Kiro IDE + setting enabled)');
  return true;
}
