import { DEVSPACES_AUTHORITY } from '../constants';

/**
 * Parse both clusterId and workspaceName from a remote authority or host alias.
 *
 * Host alias format: <workspaceName>@<clusterId>
 * Remote authority format: devspaces+<workspaceName>@<clusterId>
 *
 * Uses '@' as separator to match the display format (workspace@cluster).
 */
export function parseHostAlias(remoteAuthority: string): { clusterId: string; workspaceName: string } | undefined {
  if (!remoteAuthority) { return undefined; }

  let hostAlias = remoteAuthority;
  const prefix = `${DEVSPACES_AUTHORITY}+`;
  if (remoteAuthority.startsWith(prefix)) {
    hostAlias = remoteAuthority.substring(prefix.length);
  }

  if (!hostAlias) { return undefined; }

  const sepIdx = hostAlias.lastIndexOf('@');
  if (sepIdx <= 0) { return undefined; }

  const workspaceName = hostAlias.substring(0, sepIdx);
  const clusterId = hostAlias.substring(sepIdx + 1);
  if (!clusterId || !workspaceName) { return undefined; }

  return { clusterId, workspaceName };
}

/**
 * Extract workspace name from VS Code remote authority.
 * Format: devspaces+<workspaceName>@<clusterId>
 *
 * @param remoteAuthority The VSCODE_REMOTE_AUTHORITY environment variable value
 * @returns The workspace name, or 'workspace' if extraction fails
 */
export function extractWorkspaceName(remoteAuthority: string): string {
  if (!remoteAuthority) { return 'workspace'; }

  const parsed = parseHostAlias(remoteAuthority);
  if (parsed) { return parsed.workspaceName; }

  // Fallback: strip authority prefix
  let hostAlias = remoteAuthority;
  const prefix = `${DEVSPACES_AUTHORITY}+`;
  if (remoteAuthority.startsWith(prefix)) {
    hostAlias = remoteAuthority.substring(prefix.length);
  }
  return hostAlias || 'workspace';
}
