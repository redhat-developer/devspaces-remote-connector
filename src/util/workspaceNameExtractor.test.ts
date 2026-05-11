import { extractWorkspaceName } from './workspaceNameExtractor';
import { DEVSPACES_AUTHORITY } from '../constants';

describe('extractWorkspaceName', () => {
  it('should extract workspace name from valid remote authority', () => {
    const remoteAuthority = `${DEVSPACES_AUTHORITY}+my-workspace`;
    const result = extractWorkspaceName(remoteAuthority);
    expect(result).toBe('my-workspace');
  });

  it('should extract workspace name with hyphens', () => {
    const remoteAuthority = `${DEVSPACES_AUTHORITY}+my-dev-workspace`;
    const result = extractWorkspaceName(remoteAuthority);
    expect(result).toBe('my-dev-workspace');
  });

  it('should extract workspace name with numbers', () => {
    const remoteAuthority = `${DEVSPACES_AUTHORITY}+workspace-123`;
    const result = extractWorkspaceName(remoteAuthority);
    expect(result).toBe('workspace-123');
  });

  it('should return default workspace name for empty string', () => {
    const result = extractWorkspaceName('');
    expect(result).toBe('workspace');
  });

  it('should return default workspace name for undefined', () => {
    const result = extractWorkspaceName(undefined as any);
    expect(result).toBe('workspace');
  });

  it('should return default workspace name for null', () => {
    const result = extractWorkspaceName(null as any);
    expect(result).toBe('workspace');
  });

  it('should return default workspace name when authority does not match prefix', () => {
    const remoteAuthority = 'ssh-remote+my-workspace';
    const result = extractWorkspaceName(remoteAuthority);
    expect(result).toBe('workspace');
  });

  it('should return default workspace name when authority has no workspace name', () => {
    const remoteAuthority = `${DEVSPACES_AUTHORITY}+`;
    const result = extractWorkspaceName(remoteAuthority);
    expect(result).toBe('workspace');
  });

  it('should handle workspace names with special characters', () => {
    const remoteAuthority = `${DEVSPACES_AUTHORITY}+my-workspace-abc123_test`;
    const result = extractWorkspaceName(remoteAuthority);
    expect(result).toBe('my-workspace-abc123_test');
  });

  it('should use DEVSPACES_AUTHORITY constant for prefix', () => {
    // This test ensures we're using the constant, not a hardcoded string
    expect(DEVSPACES_AUTHORITY).toBe('devspaces');
    const remoteAuthority = `${DEVSPACES_AUTHORITY}+test-workspace`;
    const result = extractWorkspaceName(remoteAuthority);
    expect(result).toBe('test-workspace');
  });

  it('should not extract from old ssh-remote authority format', () => {
    const remoteAuthority = 'ssh-remote+devspaces-my-workspace';
    const result = extractWorkspaceName(remoteAuthority);
    expect(result).toBe('workspace');
  });
});
