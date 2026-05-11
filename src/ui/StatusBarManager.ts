import * as vscode from 'vscode';

/**
 * Manages the status bar item showing the current connection state.
 */
export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBarItem.command = 'devspaces.disconnect';
    this.setDisconnected();
  }

  /**
   * Show connected state with workspace name.
   */
  setConnected(workspaceName: string): void {
    this.statusBarItem.text = `$(remote-explorer) ${workspaceName}`;
    this.statusBarItem.tooltip = `Connected to Dev Spaces workspace: ${workspaceName}\nClick to disconnect`;
    this.statusBarItem.backgroundColor = undefined;
    this.statusBarItem.show();
  }

  /**
   * Show connecting state.
   */
  setConnecting(workspaceName: string): void {
    this.statusBarItem.text = `$(loading~spin) Connecting to ${workspaceName}...`;
    this.statusBarItem.tooltip = 'Establishing connection...';
    this.statusBarItem.show();
  }

  /**
   * Show disconnected state (hide the item).
   */
  setDisconnected(): void {
    this.statusBarItem.hide();
  }

  /**
   * Show error state.
   */
  setError(message: string): void {
    this.statusBarItem.text = `$(error) Dev Spaces`;
    this.statusBarItem.tooltip = message;
    this.statusBarItem.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.errorBackground'
    );
    this.statusBarItem.show();
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }
}
