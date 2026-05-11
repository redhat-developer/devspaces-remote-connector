# Changelog

## 0.6.0

- Per-cluster API clients — each cluster gets its own KubeConfig, no cross-cluster contamination
- Expanded ClusterEntry model with apiUrl, devSpacesUrl, appsDomain
- Stateless KubeClientFactory — no shared state between clusters
- ConsoleLink-based DevSpaces URL discovery (handles custom domains)
- Fixed multi-cluster workspace creation (no duplicate cluster prompts)
- Fixed operations targeting wrong cluster
- Fixed removing last cluster now resets to sign-in view
- New Workspace available from cluster right-click context menu
- Remove Cluster works from command palette with cluster picker
- First-time user namespace provisioning flow
- REH download URL auto-constructed from VS Code's updateUrl
- Changed extension ID to devspaces.devspaces-connector
- Changed remote authority to devspaces
- Added devspaces.clusters and devspaces.kiroCopyCredentials settings
- IDE detection for Kiro vs VS Code defaults
- License changed to MIT

- Made cluster URLs configurable via `devspaces.clusters` setting
- Added `devspaces.copyCredentials` setting (disabled by default, Kiro only)
- Added IDE detection for Kiro vs VS Code defaults
- Added namespace readiness checking (`devspaces.initialization.*` settings)
- Refactored extension into modular command/session architecture
- Changed extension ID to `devspaces.devspaces-connector`
- Changed remote authority to `devspaces`
- Removed all hardcoded URLs; all values now configurable
- Changed license to MIT

## 0.5.2

- Namespace discovery improvements
- Seamless reconnection on pod restart
- TLS CA bundle support

## 0.5.1

- Multi-cluster support
- Workspace creation from Git URL or empty template
- Real-time workspace status via K8s watch API

## 0.5.0

- Initial release
- Browser-based OpenShift OAuth2 authentication
- K8s exec + port-forward remote connectivity
- Workspace lifecycle management (start, stop, restart, delete)
- Self-healing reconnection on pod reschedule
