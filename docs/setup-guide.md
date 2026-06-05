# Setup Guide

A comprehensive guide to installing, configuring, and using the Dev Spaces Connector extension.

## Prerequisites

| Requirement | Details |
|---|---|
| **IDE** | Kiro IDE or VS Code 1.85+ |
| **Network access** | Direct HTTPS connectivity to your OpenShift Dev Spaces cluster |
| **Credentials** | OpenShift SSO credentials (the extension authenticates via browser-based OAuth2) |

No additional CLI tools (e.g., `oc`, `kubectl`, `ssh`) are required.

## Installation

### From VSIX file

1. Obtain the `.vsix` package from your team's artifact repository or a local build.
2. Install via the command line:
   ```bash
   # Kiro IDE
   kiro --install-extension devspaces-connector-*.vsix

   # VS Code
   code --install-extension devspaces-connector-*.vsix
   ```
3. Or install from the IDE: **Extensions** → **⋯** menu → **Install from VSIX…** → select the file.

### From Marketplace

Search for **Dev Spaces Connector** in the Extensions view and click **Install**.

## First-Time Setup

1. Open your IDE and look for the **Dev Spaces** icon in the Activity Bar.
2. Click **Sign In to Dev Spaces**.
3. Enter your cluster URL (e.g. `https://devspaces.apps.your-cluster.example.com`).
4. Authenticate in your browser via SSO.
5. Your workspaces appear in the sidebar.

The cluster URL is saved automatically. Subsequent sign-ins are instant if your SSO session is valid.

### Namespace Provisioning (First-Time Users)

If you've never used Dev Spaces before, your workspace namespace won't exist yet:

1. After sign-in, the extension detects that no namespace is provisioned
2. You'll see a notification: *"Your Dev Spaces environment needs to be initialized"*
3. Click **Open Dashboard** — a browser tab opens briefly to trigger provisioning
4. The extension polls until your namespace is ready
5. Once provisioned, your workspaces load automatically

This is a one-time step.

## Connecting to a Workspace

1. In the **Dev Spaces** sidebar, find the workspace you want.
2. Click **Connect** (plug icon).
3. If the workspace is stopped, it starts automatically.
4. A new window opens with a full remote development session.

The extension handles everything: locating the pod, installing the remote server, establishing the tunnel, and opening your project folder.

## Features

### No SSH Required

Connections use native Kubernetes exec and port-forward APIs. No SSH server runs in the workspace pod, no SSH keys needed, and no special editor template required.

### Multi-Cluster Support

Register and manage multiple DevSpaces clusters simultaneously:
- **Add Cluster** — paste any URL (dashboard, console, API, CNAME), the extension discovers endpoints automatically
- **Remove Cluster** — right-click in sidebar
- **Simultaneous loading** — workspaces from all clusters load in parallel

### Workspace Management

Full lifecycle management from the sidebar:
- Start, stop, restart workspaces
- Create from Git URL or empty
- Delete with confirmation
- Open in DevSpaces dashboard
- Live status icons (🟢 Running, ⚪ Stopped, 🔄 Starting, 🔴 Failed)
- Auto-refresh every 30 seconds

### Auto-Reconnect

If the workspace pod is rescheduled or restarted, the extension automatically:
1. Detects the disruption
2. Waits for the new pod
3. Re-installs the remote server
4. Reloads the window seamlessly

### Port Forwarding

Ports running inside the workspace pod are forwarded to localhost automatically. Your browser and local tools can access them directly.

### IDE Credentials Sync (Kiro IDE)

When connecting from Kiro IDE, AWS SSO credentials are automatically synced to the workspace pod, enabling AWS tools to work in remote sessions. Controlled via `devspaces.syncKiroIDECredentials`.

### Smart Cluster URL

Paste any URL from your cluster — dashboard, console, workspace URL, API URL, or a CNAME — and the extension resolves the correct endpoints.

## Creating Workspaces

### From a Git URL

1. Click **New Workspace** in the sidebar.
2. Select **From Git Repository**.
3. Paste the Git URL.
4. The workspace is provisioned according to the repository's `devfile.yaml`.

### Empty Workspace

1. Click **New Workspace**.
2. Select **Empty Workspace**.
3. A minimal workspace is created with a default container image.

## Settings Reference

All settings are under the `devspaces` namespace.

| Setting | Type | Default | Description |
|---|---|---|---|
| `devspaces.clusters` | `string[]` | `[]` | List of Dev Spaces cluster URLs. First entry is the default. |
| `devspaces.syncKiroIDECredentials` | `boolean` | `true` | Sync Kiro IDE AWS SSO credentials to remote workspace (Kiro only). |
| `devspaces.autoConnect` | `boolean` | `false` | Auto-connect to last workspace on startup. |
| `devspaces.autoOpenFolder` | `boolean` | `true` | Auto-open project folder after connecting. |
| `devspaces.rehDownloadUrl` | `string` | `""` | URL template for REH server download. Supports `${commit}`, `${os}`, `${arch}`. If empty, uses IDE built-in. |
| `devspaces.connectionTimeout` | `number` | `300` | Max seconds to wait for workspace start. |
| `devspaces.reconnect.enabled` | `boolean` | `true` | Auto-reconnect on connection loss. |
| `devspaces.reconnect.maxRetries` | `number` | `5` | Max reconnection attempts. |
| `devspaces.logLevel` | `string` | `"info"` | Logging verbosity: `debug`, `info`, `warn`, `error`. |
| `devspaces.openBehavior` | `string` | `"newWindow"` | How to open remote sessions: `newWindow`, `currentWindow`, `prompt`. |
| `devspaces.hideRemoteExplorer` | `boolean` | `true` | Hide the Remote-SSH explorer sidebar. |
| `devspaces.initialization.roleBindingName` | `string` | `"devspaces-user-container-build"` | RoleBinding to wait for during namespace init. |
| `devspaces.initialization.timeout` | `number` | `120` | Max seconds to wait for namespace initialization. |
| `devspaces.initialization.pollInterval` | `number` | `2` | Poll interval (seconds) for readiness check. |
| `devspaces.initialization.namespaceAgeThreshold` | `number` | `300` | Namespace age threshold (seconds). Set to 0 to always check. |

## Commands

All commands are in the Command Palette under **Dev Spaces**:

| Command | Description |
|---|---|
| Sign In to Dev Spaces | Authenticate to your cluster |
| Sign Out | Clear stored credentials |
| Add Cluster | Register a new DevSpaces cluster |
| Remove Cluster | Remove a registered cluster |
| Clear All Authentication | Reset all auth state |
| Refresh Workspaces | Reload workspace list |
| New Workspace | Create workspace (Git or empty) |
| Start / Stop / Restart Workspace | Lifecycle management |
| Delete Workspace | Remove with confirmation |
| Connect to Workspace | Open remote session |
| Disconnect | Close active connection |
| Open in Browser | Open in DevSpaces dashboard |

## Custom CA Certificates

For environments with custom/enterprise CAs:

**At runtime:**
```bash
export NODE_EXTRA_CA_CERTS=/path/to/ca-bundle.pem
kiro
```

The extension also loads system-trusted CAs automatically on macOS and Linux.

**At build time** (for pre-bundled distributions):
```bash
CA_BUNDLE_URL=https://your-pki-server/ca-bundle.pem npm run compile
# or
CA_BUNDLE_HOST=devspaces.your-cluster.example.com npm run compile
```

## Troubleshooting

### Sign-in opens browser but never completes

- Verify your machine can reach the cluster URL over HTTPS.
- Check that no firewall/proxy blocks the localhost callback (temporary HTTP server on a random port).
- If using a custom CA, ensure it is trusted (see Custom CA Certificates above).

### Workspace stuck in "Starting"

- Default timeout is 300 seconds (`devspaces.connectionTimeout`). Increase for slow clusters.
- Check the DevWorkspace status in the OpenShift console for error events.

### Connection drops frequently

- Ensure `devspaces.reconnect.enabled` is `true`.
- Increase `devspaces.reconnect.maxRetries` if your cluster has frequent pod rescheduling.
- Set `devspaces.logLevel` to `"debug"` and check the **Dev Spaces** output channel.

### TLS / certificate errors

- Use `NODE_EXTRA_CA_CERTS` or the build-time CA bundle options.
- Confirm the CA bundle includes the full chain (root + intermediates).

### Port forwarding not working

- Ensure the port is actually listening inside the workspace container.
- Check that no local process is already bound to the same port.

## Important Notes

- **Workspaces are remote** — they run as pods on the cluster. Stopping preserves persistent storage (`/projects`). Deleting removes the pod and its persistent volume (irreversible).
- **Extensions in remote sessions** — install workspace-specific extensions (linters, debuggers) in the remote extension host. UI-only extensions (themes, keymaps) work locally.
- **Security** — OAuth tokens stored in IDE globalState (local SQLite), never as plain text files. Tokens auto-refresh via background SSO. Bearer tokens redacted from logs. Each session uses a unique connection token.

## Known Limitations

- Token refresh opens a browser tab briefly (SSO makes it instant but visible)
- REH server download (~170MB) takes time on first connect; subsequent connects reuse the installed server
- macOS may show "OS keyring couldn't be identified" warning on first sign-in — dismiss once, doesn't affect functionality
