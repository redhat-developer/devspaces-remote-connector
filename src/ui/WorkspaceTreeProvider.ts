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
  /** Clusters that are signed out */
  private signedOutClusters = new Set<string>();

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
    this.signedOutClusters.delete(clusterId);
    this.onDidChangeTreeDataEmitter.fire();
  }

  /**
   * Mark a cluster as signed out.
   */
  setClusterSignedOut(clusterId: string): void {
    this.signedOutClusters.add(clusterId);
    this.workspacesByCluster.delete(clusterId);
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
        if (this.signedOutClusters.has(cluster.id)) {
          return new ClusterTreeItem(cluster, 0, false, true);
        }
        const workspaces = this.workspacesByCluster.get(cluster.id);
        const isLoading = workspaces === undefined; // not yet loaded
        return new ClusterTreeItem(cluster, workspaces?.length ?? 0, isLoading);
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
