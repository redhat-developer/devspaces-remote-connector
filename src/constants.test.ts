import { DEVSPACES_AUTHORITY } from './constants';

describe('Constants', () => {
  describe('DEVSPACES_AUTHORITY', () => {
    it('should be defined', () => {
      expect(DEVSPACES_AUTHORITY).toBeDefined();
    });

    it('should be a string', () => {
      expect(typeof DEVSPACES_AUTHORITY).toBe('string');
    });

    it('should be devspaces', () => {
      expect(DEVSPACES_AUTHORITY).toBe('devspaces');
    });

    it('should not contain special characters that would conflict with remote authority syntax', () => {
      // Remote authority format is: scheme://authority+name/path
      // So the authority should not contain + or / or ://
      expect(DEVSPACES_AUTHORITY).not.toContain('+');
      expect(DEVSPACES_AUTHORITY).not.toContain('/');
      expect(DEVSPACES_AUTHORITY).not.toContain('://');
    });

    it('should be lowercase for consistency with VS Code conventions', () => {
      expect(DEVSPACES_AUTHORITY).toBe(DEVSPACES_AUTHORITY.toLowerCase());
    });

    it('should use a clean identifier format', () => {
      expect(DEVSPACES_AUTHORITY).not.toContain('_');
    });

    it('should clearly indicate it is for DevSpaces', () => {
      expect(DEVSPACES_AUTHORITY.toLowerCase()).toContain('devspaces');
    });

    it('should avoid conflicts with other remote extensions', () => {
      // Should not be 'ssh-remote' which is used by Open Remote SSH
      expect(DEVSPACES_AUTHORITY).not.toBe('ssh-remote');
      expect(DEVSPACES_AUTHORITY).not.toContain('ssh');
    });
  });
});
