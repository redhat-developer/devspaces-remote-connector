import { DEVSPACES_AUTHORITY } from '../constants';
import { parseHostAlias, extractWorkspaceName } from './workspaceNameExtractor';

describe('parseHostAlias', () => {
  it('parses new format with authority prefix', () => {
    const result = parseHostAlias(`${DEVSPACES_AUTHORITY}+mcp-workshop@devspc-1d`);
    expect(result).toEqual({ clusterId: 'devspc-1d', workspaceName: 'mcp-workshop' });
  });

  it('parses new format without authority prefix', () => {
    const result = parseHostAlias('mcp-workshop@devspc-1d');
    expect(result).toEqual({ clusterId: 'devspc-1d', workspaceName: 'mcp-workshop' });
  });

  it('handles CNAME cluster ID', () => {
    const result = parseHostAlias(`${DEVSPACES_AUTHORITY}+flights-mgmt@devspaces.example.com`);
    expect(result).toEqual({ clusterId: 'devspaces.example.com', workspaceName: 'flights-mgmt' });
  });

  it('handles workspace name with hyphens', () => {
    const result = parseHostAlias('my-dev-workspace-123@devspc-1d');
    expect(result).toEqual({ clusterId: 'devspc-1d', workspaceName: 'my-dev-workspace-123' });
  });

  it('returns undefined for empty string', () => {
    expect(parseHostAlias('')).toBeUndefined();
  });

  it('returns undefined when no @ separator exists', () => {
    expect(parseHostAlias('devspaces-mcp-workshop')).toBeUndefined();
  });

  it('returns undefined when workspace name is empty', () => {
    expect(parseHostAlias('@devspc-1d')).toBeUndefined();
  });

  it('returns undefined when cluster ID is empty', () => {
    expect(parseHostAlias('mcp-workshop@')).toBeUndefined();
  });
});

describe('extractWorkspaceName', () => {
  it('extracts workspace name from new format', () => {
    const result = extractWorkspaceName(`${DEVSPACES_AUTHORITY}+mcp-workshop@devspc-1d`);
    expect(result).toBe('mcp-workshop');
  });

  it('falls back to stripping prefix only', () => {
    const result = extractWorkspaceName(`${DEVSPACES_AUTHORITY}+some-host`);
    expect(result).toBe('some-host');
  });

  it('returns workspace for empty input', () => {
    expect(extractWorkspaceName('')).toBe('workspace');
  });

  it('uses DEVSPACES_AUTHORITY constant for prefix', () => {
    expect(DEVSPACES_AUTHORITY).toBe('devspaces');
  });
});
