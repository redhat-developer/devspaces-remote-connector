import * as vscode from 'vscode';
import { WorkspaceModel } from '../workspace/WorkspaceModel';
import { WorkspacePhase } from '../constants';
import { ClusterEntry } from '../cluster/ClusterManager';

/**
 * TreeView item representing a DevSpaces workspace.
 */
export class WorkspaceTreeItem extends vscode.TreeItem {
  constructor(public readonly workspace: WorkspaceModel) {
    super(workspace.displayName, vscode.TreeItemCollapsibleState.None);

    this.description = workspace.phase;
    this.tooltip = this.buildTooltip();
    this.iconPath = this.getIcon();
    this.contextValue = `workspace-${workspace.phase.toLowerCase()}`;
  }

  private buildTooltip(): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${this.workspace.name}**\n\n`);
    md.appendMarkdown(`- **Status:** ${this.workspace.phase}\n`);
    md.appendMarkdown(`- **Namespace:** ${this.workspace.namespace}\n`);
    if (this.workspace.gitRepoUrl) {
      md.appendMarkdown(`- **Repository:** ${this.workspace.gitRepoUrl}\n`);
    }
    if (this.workspace.creationTimestamp) {
      md.appendMarkdown(`- **Created:** ${this.workspace.creationTimestamp}\n`);
    }
    md.appendMarkdown(`- **ID:** ${this.workspace.devworkspaceId}\n`);
    return md;
  }

  private getIcon(): vscode.ThemeIcon {
    switch (this.workspace.phase) {
      case WorkspacePhase.Running:
        return new vscode.ThemeIcon(
          'circle-filled',
          new vscode.ThemeColor('testing.iconPassed')
        );
      case WorkspacePhase.Starting:
      case WorkspacePhase.Stopping:
        return new vscode.ThemeIcon(
          'loading~spin',
          new vscode.ThemeColor('charts.yellow')
        );
      case WorkspacePhase.Stopped:
        return new vscode.ThemeIcon(
          'circle-outline',
          new vscode.ThemeColor('disabledForeground')
        );
      case WorkspacePhase.Failed:
      case WorkspacePhase.Failing:
        return new vscode.ThemeIcon(
          'error',
          new vscode.ThemeColor('testing.iconFailed')
        );
      default:
        return new vscode.ThemeIcon('question');
    }
  }
}

/**
 * TreeView item representing a cluster node.
 */
export class ClusterTreeItem extends vscode.TreeItem {
  constructor(
    public readonly cluster: ClusterEntry,
    childCount: number,
    isLoading = false,
    isSignedOut = false
  ) {
    super(cluster.displayName, isSignedOut ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Expanded);
    if (isSignedOut) {
      this.description = 'signed out';
      this.iconPath = new vscode.ThemeIcon('cloud', new vscode.ThemeColor('disabledForeground'));
      this.contextValue = 'cluster-signed-out';
      this.command = { command: 'devspaces.signInCluster', title: 'Sign In', arguments: [this] };
    } else if (isLoading) {
      this.description = 'loading...';
      this.iconPath = new vscode.ThemeIcon('loading~spin');
      this.contextValue = 'cluster';
    } else {
      this.description = `${childCount} workspace${childCount !== 1 ? 's' : ''}`;
      this.iconPath = new vscode.ThemeIcon('cloud');
      this.contextValue = 'cluster';
    }
    this.tooltip = new vscode.MarkdownString(
      `**${cluster.displayName}**\n\n` +
      `- **URL:** ${cluster.devSpacesUrl}\n`
    );
  }
}
