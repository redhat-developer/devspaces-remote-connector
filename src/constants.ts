/**
 * Shared constants for the Dev Spaces Connector extension.
 */

/** Authentication provider ID registered with VS Code */
export const AUTH_PROVIDER_ID = 'openshift-devspaces';
export const AUTH_PROVIDER_LABEL = 'OpenShift Dev Spaces';

/** Remote authority prefix for DevSpaces workspaces */
export const DEVSPACES_AUTHORITY = 'devspaces';

/** DevWorkspace API group and version */
export const DW_API_GROUP = 'workspace.devfile.io';
export const DW_API_VERSION = 'v1alpha2';
export const DW_PLURAL = 'devworkspaces';

/** Namespace labels used to discover user workspaces namespaces */
export const WORKSPACE_NAMESPACE_LABEL = 'app.kubernetes.io/component=workspaces-namespace';

/** Workspace phases */
export enum WorkspacePhase {
  Starting = 'Starting',
  Running = 'Running',
  Stopping = 'Stopping',
  Stopped = 'Stopped',
  Failed = 'Failed',
  Failing = 'Failing',
}

/** Extension configuration keys */
export const CONFIG_SECTION = 'devspaces';
export const CONFIG_LOG_LEVEL = 'logLevel';

/** Context keys set on the VS Code context for when-clause evaluation */
export const CTX_AUTHENTICATED = 'devspaces.authenticated';
export const CTX_CONNECTED = 'devspaces.connected';
export const CTX_INITIALIZING = 'devspaces.initializing';

/** GlobalState keys */
export const STATE_CLUSTER_URL = 'devspaces.clusterUrl';
export const STATE_CLUSTER_DISPLAY_URL = 'devspaces.clusterDisplayUrl';
export const STATE_CACHED_TOKEN = 'devspaces.cachedAccessToken';
export const STATE_ACTIVE_CONNECTION = 'devspaces.activeConnection';

/** K8s label keys */
export const LABEL_DEVWORKSPACE_ID = 'controller.devfile.io/devworkspace_id';
export const LABEL_METADATA_NAME = 'kubernetes.io/metadata.name';

/** Sidecar container name prefixes to exclude when finding the main dev container */
export const SIDECAR_PREFIXES = ['che-gateway', 'che-machine-exec', 'che-code', 'che-editor'];

/** Timeouts (milliseconds) */
export const OAUTH_CALLBACK_TIMEOUT = 120_000; // 2 minutes for user to complete browser login
export const TOKEN_REFRESH_BUFFER = 300_000; // Refresh 5 minutes before expiry

/** Projects root inside workspace pods */
export const PROJECTS_ROOT = '/projects';
