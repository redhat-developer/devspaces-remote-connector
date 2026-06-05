import * as vscode from 'vscode';
import { detectIDE, isKiroIDE, shouldSyncKiroIDECredentials } from './IDEDetector';

// Add uriScheme to the vscode mock
(vscode.env as any).uriScheme = 'vscode';

describe('IDEDetector', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.KIRO_IDE;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('detectIDE', () => {
    it('detects VS Code from default mock (appName=Visual Studio Code)', () => {
      const ide = detectIDE();
      expect(ide.isVSCode).toBe(true);
    });

    it('detects Kiro when KIRO_IDE env var is set', () => {
      process.env.KIRO_IDE = 'true';
      const ide = detectIDE();
      expect(ide.isKiro).toBe(true);
    });

    it('detects Kiro from app name', () => {
      (vscode.env as any).appName = 'Kiro';
      const ide = detectIDE();
      expect(ide.isKiro).toBe(true);
      (vscode.env as any).appName = 'Visual Studio Code';
    });

    it('does not detect Kiro for plain VS Code', () => {
      (vscode.env as any).appName = 'Visual Studio Code';
      delete process.env.KIRO_IDE;
      const ide = detectIDE();
      expect(ide.isKiro).toBe(false);
    });
  });

  describe('isKiroIDE', () => {
    it('returns true when KIRO_IDE env is set', () => {
      process.env.KIRO_IDE = 'true';
      expect(isKiroIDE()).toBe(true);
    });

    it('returns false for VS Code', () => {
      (vscode.env as any).appName = 'Visual Studio Code';
      delete process.env.KIRO_IDE;
      expect(isKiroIDE()).toBe(false);
    });
  });

  describe('shouldSyncKiroIDECredentials', () => {
    it('returns false when not Kiro IDE', () => {
      (vscode.env as any).appName = 'Visual Studio Code';
      delete process.env.KIRO_IDE;
      expect(shouldSyncKiroIDECredentials()).toBe(false);
    });

    it('returns true when Kiro IDE with default settings', () => {
      process.env.KIRO_IDE = 'true';
      (vscode.env as any).appName = 'Kiro';
      expect(shouldSyncKiroIDECredentials()).toBe(true);
    });
  });
});
