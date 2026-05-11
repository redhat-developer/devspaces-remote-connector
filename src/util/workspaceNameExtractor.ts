import { DEVSPACES_AUTHORITY } from '../constants';

/**
 * Extract workspace name from VS Code remote authority.
 *
 * Remote authority format: devspaces+<workspace-name>
 * Example: devspaces+my-workspace
 *
 * @param remoteAuthority The VSCODE_REMOTE_AUTHORITY environment variable value
 * @returns The workspace name, or 'workspace' if extraction fails
 */
export function extractWorkspaceName(remoteAuthority: string): string {
  if (!remoteAuthority) {
    return 'workspace';
  }

  const prefix = `${DEVSPACES_AUTHORITY}+`;
  if (remoteAuthority.startsWith(prefix)) {
    const name = remoteAuthority.substring(prefix.length);
    return name || 'workspace';
  }

  return 'workspace';
}
