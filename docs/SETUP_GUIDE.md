# Dev Spaces Connector — Setup Guide

A comprehensive guide to installing, configuring, and using the Dev Spaces Connector extension for Kiro IDE and VS Code.

---

## 1. Prerequisites

| Requirement | Details |
|---|---|
| **IDE** | Kiro IDE or VS Code 1.85+ |
| **Network access** | Direct HTTPS connectivity to your OpenShift Dev Spaces cluster |
| **Credentials** | OpenShift SSO credentials (the extension authenticates via browser-based OAuth2) |

No additional CLI tools (e.g., `oc`, `kubectl`, `ssh`) are required. The extension communicates directly with the Kubernetes API.

---

## 2. Installation

### From VSIX file

1. Obtain the `.vsix` package (from your team's artifact repository or a local build).
2. Install via the command line:
   ```bash
   # Kiro IDE
   kiro --install-extension devspaces-connector-*.vsix

   # VS Code
   code --install-extension devspaces-connector-*.vsix
   ```
3. Or install from the IDE: **Extensions** → **⋯** menu → **Install from VSIX…** → select the file.

### From Marketplace

If published to your organization's marketplace, search for **Dev Spaces Connector** in the Extensions view and click **Install**.

---

## 3. Enabling Proposed API Access

This extension uses the VS Code `resolvers` proposed API for its remote authority resolver. You must explicitly allow it.

### Option 1: Command-line flag (recommended for development)

```bash
# Kiro IDE
kiro --enable-proposed-api devspaces.devspaces-connector

# VS Code
code --enable-proposed-api devspaces.devspaces-connector
```

### Option 2: product.json allowlist (recommended for distribution)

Add the extension ID to the `extensionAllowedProposedApi` array in your IDE's `product.json`:

```json
{
  "extensionAllowedProposedApi": [
    "devspaces.devspaces-connector"
  ]
}
```

> **Note:** Without this step the remote connection resolver will not activate and you will be unable to connect to workspaces.

---

## 4. First-Time Setup

1. Open your IDE and look for the **Dev Spaces** icon in the Activity Bar (left sidebar).
2. Click **Sign In to Dev Spaces** (or run the command from the Command Palette).
3. When prompted, enter your cluster URL — for example:
   ```
   https://devspaces.apps.your-cluster.example.com
   ```
4. Your default browser opens to the OpenShift login page. Authenticate with your SSO credentials.
5. After successful authentication the browser redirects back to a localhost callback and you can close the tab.
6. Your workspaces appear in the sidebar.

The cluster URL is automatically saved to the `devspaces.clusters` setting so you won't need to enter it again. Subsequent sign-ins are instant if your SSO session is still valid.

---

## 5. Connecting to a Workspace

1. In the **Dev Spaces** sidebar, find the workspace you want to connect to.
2. If the workspace is stopped, click **Start** and wait for it to reach the Running state.
3. Click **Connect** on the workspace.

Behind the scenes the extension:
- Locates the workspace pod via the `devworkspaceId` label.
- Installs the Remote Extension Host (REH) server in the pod using `kubectl exec`.
- Establishes a port-forward tunnel from your local machine to the pod.
- Opens a full remote development session.

The session opens in a new window by default (configurable via `devspaces.openBehavior`). If `devspaces.autoOpenFolder` is enabled, the `/projects` folder opens automatically.

---

## 6. Creating Workspaces

### From a Git URL

1. Click **New Workspace** in the sidebar (or run the command from the palette).
2. Select **From Git Repository**.
3. Paste the Git URL (HTTPS or SSH).
4. The DevWorkspace Operator clones the repo and provisions the workspace according to the repository's `devfile.yaml` (if present).

### Empty workspace

1. Click **New Workspace**.
2. Select **Empty Workspace**.
3. A minimal workspace is created with a default container image.

---

## 7. Multi-Cluster Setup

You can register multiple Dev Spaces clusters and switch between them:

1. Run **Dev Spaces: Add Cluster** from the Command Palette.
2. Enter the new cluster URL.
3. Authenticate when prompted.

All registered clusters appear in the `devspaces.clusters` setting:

```json
{
  "devspaces.clusters": [
    "https://devspaces.apps.cluster-a.example.com",
    "https://devspaces.apps.cluster-b.example.com"
  ]
}
```

The first entry is the default cluster. Use **Dev Spaces: Remove Cluster** to unregister a cluster.

---

## 8. Key Features

### No SSH required

Connections use native Kubernetes exec and port-forward APIs. No SSH server runs in the workspace pod, and no SSH keys need to be configured.

### Localhost port access

Ports forwarded from the workspace pod are available on `localhost` just like a local dev server. Your browser and other local tools can access them directly.

### Auto-reconnect

If the workspace pod is rescheduled or restarted, the extension automatically detects the disruption, waits for the new pod, re-installs the REH server, and reloads the window — preserving your session token so the reconnection is seamless.

### Same permissions as the dashboard

The extension uses your OpenShift OAuth token. You have the same RBAC permissions as when using the Dev Spaces dashboard in a browser.

---

## 9. Settings Reference

All settings are under the `devspaces` namespace.

| Setting | Type | Default | Description |
|---|---|---|---|
| `devspaces.clusters` | `string[]` | `[]` | List of Dev Spaces cluster URLs. First entry is the default. |
| `devspaces.copyCredentials` | `boolean` | `false` | Copy IDE auth credentials to pod on connect (Kiro only). |
| `devspaces.autoConnect` | `boolean` | `false` | Auto-connect to last workspace on startup. |
| `devspaces.autoOpenFolder` | `boolean` | `true` | Auto-open project folder after connecting. |
| `devspaces.rehDownloadUrl` | `string` | `""` | URL template for REH server download. Supports `${commit}`, `${os}`, `${arch}`. If empty, uses IDE built-in. |
| `devspaces.connectionTimeout` | `number` | `300` | Max seconds to wait for workspace start. |
| `devspaces.reconnect.enabled` | `boolean` | `true` | Auto-reconnect on connection loss. |
| `devspaces.reconnect.maxRetries` | `number` | `5` | Max reconnection attempts. |
| `devspaces.logLevel` | `string` | `"info"` | Logging verbosity: `debug`, `info`, `warn`, `error`. |
| `devspaces.openBehavior` | `string` | `"newWindow"` | How to open remote sessions: `newWindow`, `currentWindow`, `prompt`. |
| `devspaces.hideRemoteExplorer` | `boolean` | `true` | Hide the Remote-SSH explorer sidebar (reduces UI clutter). |
| `devspaces.initialization.roleBindingName` | `string` | `"devspaces-user-container-build"` | RoleBinding to wait for during namespace init. |
| `devspaces.initialization.timeout` | `number` | `120` | Max seconds to wait for namespace initialization. |
| `devspaces.initialization.pollInterval` | `number` | `2` | Poll interval (seconds) for readiness check. |
| `devspaces.initialization.namespaceAgeThreshold` | `number` | `300` | Namespace age threshold (seconds). Set to 0 to always check readiness. |

---

## 10. Custom CA Certificates

If your cluster uses certificates signed by a custom or enterprise CA, you have several options.

### At build time

Set environment variables before compiling the extension:

```bash
# Download a CA bundle from a URL
CA_BUNDLE_URL=https://your-pki-server/ca-bundle.pem npm run compile

# Or extract the CA chain from a server's TLS certificate
CA_BUNDLE_HOST=devspaces.your-cluster.example.com npm run compile
```

The CA bundle is embedded into the extension build.

### At runtime

Set the standard Node.js environment variable before launching your IDE:

```bash
export NODE_EXTRA_CA_CERTS=/path/to/ca-bundle.pem
kiro
```

The extension also loads system-trusted CAs automatically on macOS and Linux.

---

## 11. Troubleshooting

### "Proposed API not enabled" or resolver not activating

Ensure you launched the IDE with `--enable-proposed-api devspaces.devspaces-connector` or added the extension to `product.json`. See [Section 3](#3-enabling-proposed-api-access).

### Sign-in opens browser but never completes

- Verify your machine can reach the cluster URL over HTTPS.
- Check that no firewall or proxy blocks the localhost callback (the extension starts a temporary HTTP server on a random port).
- If using a custom CA, ensure it is trusted (see [Section 10](#10-custom-ca-certificates)).

### Workspace stuck in "Starting" state

- The default timeout is 300 seconds (`devspaces.connectionTimeout`). Large images or slow clusters may need a higher value.
- Check the DevWorkspace status in the OpenShift console for error events.

### Connection drops frequently

- Ensure `devspaces.reconnect.enabled` is `true`.
- Increase `devspaces.reconnect.maxRetries` if your cluster has frequent pod rescheduling.
- Set `devspaces.logLevel` to `"debug"` and check the **Dev Spaces** output channel for details.

### TLS / certificate errors

- Use `NODE_EXTRA_CA_CERTS` or the build-time CA bundle options.
- Confirm the CA bundle includes the full chain (root + intermediates).

### Namespace initialization timeout

For new users whose namespace is being provisioned for the first time, the extension waits for RBAC (specifically the RoleBinding named in `devspaces.initialization.roleBindingName`). If this times out:
- Increase `devspaces.initialization.timeout`.
- Verify with your cluster admin that the RoleBinding is being created.

### Port forwarding not working

- Ensure the port is actually listening inside the workspace container.
- Check that no local process is already bound to the same port.

---

## 12. Important Notes

### Workspace lifecycle

- Workspaces are **not** local — they run as pods on the OpenShift cluster. Stopping a workspace terminates the pod but preserves persistent storage (`/projects`).
- Deleting a workspace removes the pod **and** its persistent volume. This is irreversible.
- If a workspace is stopped externally (e.g., via the dashboard or an idle timeout policy), the extension prompts you to restart or disconnect.

### Extensions in remote sessions

- Extensions installed locally do **not** automatically run in the remote workspace. Install workspace-specific extensions (linters, debuggers, language servers) in the remote extension host.
- Some extensions (UI-only, themes, keymaps) run locally and work without remote installation.
- The `devspaces.copyCredentials` setting (Kiro only) can forward authentication credentials to the pod for extensions that need cloud access.

### Security

- OAuth tokens are stored in the IDE's `globalState` (local SQLite database) and are never written to disk as plain text files.
- Tokens are automatically refreshed via background SSO re-authentication.
- Bearer tokens are redacted from all log output.
- Each connection session uses a unique token (UUID). Tokens are not reused across sessions.
