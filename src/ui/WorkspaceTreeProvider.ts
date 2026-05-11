import * as vscode from 'vscode';
import { WorkspaceModel } from '../workspace/WorkspaceModel';
import { WorkspaceTreeItem, ClusterTreeItem } from './WorkspaceTreeItem';
import { ClusterEntry } from '../cluster/ClusterManager';

type TreeElement = ClusterTreeItem | WorkspaceTreeItem;

/**
 * TreeDataProvider for the Dev Spaces workspace sidebar.
 * Shows one or more cluster nodes, each with workspace items underneath.
 */
export class WorkspaceTreeProvider
  implements vscode.TreeDataProvider<TreeElement>
{
  private onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    TreeElement | undefined | void
  >();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private clusters: ClusterEntry[] = [];
  /** Workspaces keyed by cluster ID */
  private workspacesByCluster = new Map<string, WorkspaceModel[]>();

  /**
   * Set the clusters to display.
   */
  setClusters(clusters: ClusterEntry[]): void {
    this.clusters = clusters;
    this.onDidChangeTreeDataEmitter.fire();
  }

  /**
   * Update workspaces for a specific cluster.
   */
  setWorkspaces(clusterId: string, workspaces: WorkspaceModel[]): void {
    this.workspacesByCluster.set(clusterId, workspaces);
    this.onDidChangeTreeDataEmitter.fire();
  }

  /**
   * Trigger a tree refresh.
   */
  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeElement): TreeElement[] {
    if (!element) {
      // Root level: show cluster nodes
      return this.clusters.map((cluster) => {
        const workspaces = this.workspacesByCluster.get(cluster.id) ?? [];
        return new ClusterTreeItem(cluster, workspaces.length);
      });
    }

    if (element instanceof ClusterTreeItem) {
      // Cluster level: show workspace items
      const workspaces = this.workspacesByCluster.get(element.cluster.id) ?? [];
      return workspaces.map((ws) => new WorkspaceTreeItem(ws));
    }

    return [];
  }

  dispose(): void {
    this.onDidChangeTreeDataEmitter.dispose();
  }
}
