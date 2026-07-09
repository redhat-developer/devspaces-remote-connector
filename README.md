# Dev Spaces Connector

Connect to [Red Hat OpenShift Dev Spaces](https://developers.redhat.com/products/openshift-dev-spaces/overview) or [Eclipse Che](https://eclipse.dev/che/) workspaces from Kiro IDE or VS Code. No SSH, no CLI tools, no configuration files.

## Features

- **One-click connect** — Browser-based OAuth2 authentication. Click Connect and you're in.
- **Workspace management** — Start, stop, restart, create, and delete workspaces from the sidebar.
- **K8s exec transport** — Connects via Kubernetes exec + port-forward. No SSH server needed in the pod.
- **Multi-cluster** — Register and manage multiple DevSpaces clusters simultaneously.
- **Auto-reconnect** — Automatically reconnects when pods are rescheduled or restarted.
- **Port forwarding** — Access ports running in the workspace from localhost.
- **IDE detection** — Automatically adapts to Kiro IDE or VS Code with appropriate defaults.
- **Air-gapped support** — Handles connecting to cluster with restricted network traffic.

## Getting Started

1. Install the extension (VSIX or marketplace)
2. Relaunch the IDE with `--enable-proposed-api redhat.devspaces-remote-connector` (See "Proposed API Access)
3. Click the **Dev Spaces** icon in the Activity Bar
4. Click **Sign In to Dev Spaces**
5. Enter your cluster URL (e.g. `https://devspaces.apps.your-cluster.example.com`)
6. Authenticate in your browser
7. Your workspaces appear — click **Connect** on any workspace


## Prerequisites

- **Kiro IDE** or **VS Code 1.107+**
- Network access to your OpenShift Dev Spaces cluster
- OpenShift credentials (SSO)

### Proposed API Access

This extension uses the VS Code `resolvers` proposed API for the remote authority resolver. To run it:

**Option 1: Command-line flag**
```bash
kiro --enable-proposed-api redhat.devspaces-remote-connector
# or for VS Code:
code --enable-proposed-api redhat.devspaces-remote-connector
```

**Option 2: Runtime configuration arguments (argv.json)**

Add the extension ID to the `enable-proposed-api` array in your IDE's extension installation folder, (eg. `$HOME/.vscode/argv.json`):
```json
{
  "enable-proposed-api": [
    "redhat.devspaces-remote-connector"
  ]
}
```

## Extension Settings

| Setting | Default | Description |
|---|---|---|
| `devspaces.clusters` | `[]` | List of Dev Spaces cluster URLs. First entry is the default. |
| `devspaces.syncKiroIDECredentials` | `true` | Sync Kiro IDE AWS SSO credentials to remote workspace (Kiro only). |
| `devspaces.autoConnect` | `false` | Auto-connect to last workspace on startup. |
| `devspaces.autoOpenFolder` | `true` | Auto-open project folder after connecting. |
| `devspaces.rehDownloadUrl` | `""` | URL template for REH server download. Supports `${commit}`, `${os}`, `${arch}`. If empty, uses IDE built-in. |
| `devspaces.connectionTimeout` | `300` | Max seconds to wait for workspace start. |
| `devspaces.reconnect.enabled` | `true` | Auto-reconnect on connection loss. |
| `devspaces.reconnect.maxRetries` | `5` | Max reconnection attempts. |
| `devspaces.logLevel` | `"info"` | Logging verbosity: `debug`, `info`, `warn`, `error`. |
| `devspaces.openBehavior` | `"newWindow"` | How to open remote sessions: `newWindow`, `currentWindow`, `prompt`. |
| `devspaces.hideRemoteExplorer` | `true` | Hide the Remote-SSH explorer sidebar. |
| `devspaces.initialization.roleBindingName` | `"devspaces-user-container-build"` | RoleBinding to wait for during namespace init. |
| `devspaces.initialization.timeout` | `120` | Max seconds to wait for namespace initialization. |
| `devspaces.initialization.pollInterval` | `2` | Poll interval (seconds) for readiness check. |
| `devspaces.initialization.namespaceAgeThreshold` | `300` | Namespace age threshold (seconds). Set to 0 to always check. |
| `devspaces.certificateValidation.enabled` | `true` | Whether to reject cluster SSL/TLS certificates that are invalid, expired or self-signed. |

## Commands

All commands are in the Command Palette under **Dev Spaces**:

- **Sign In / Sign Out** — Authenticate or sign out from a cluster
- **Add / Remove Cluster** — Manage registered clusters
- **Connect / Disconnect** — Open or close remote sessions
- **Start / Stop / Restart** — Workspace lifecycle
- **New Workspace** — Create from Git URL or empty
- **Delete Workspace** — Remove with confirmation
- **Open in Browser** — Open in DevSpaces dashboard

## Custom CA Certificates

For environments with custom/enterprise CAs, set before launching:

```bash
export NODE_EXTRA_CA_CERTS=/path/to/ca-bundle.pem
```

The extension also loads system-trusted CAs automatically.

## Troubleshooting

| Problem | Solution |
|---|---|
| Sign-in never completes | Check network access to cluster; ensure no proxy blocks localhost callback |
| TLS/certificate errors | Set `NODE_EXTRA_CA_CERTS` to your CA bundle |
| Connection drops | Enable `devspaces.reconnect.enabled`, increase `maxRetries` |

For detailed troubleshooting, see the Setup Guide in the repository's `docs/` folder.

## Documentation

Additional documentation is available in the `docs/` folder of the source repository:

- **Setup Guide** — Full installation, configuration, and usage guide
- **Architecture** — Technical internals, diagrams, and design decisions
- **Development** — Build, test, and contribute

## Security

- OAuth tokens stored locally (never as plain text files)
- All communication over TLS
- Bearer tokens redacted from logs
- Unique connection token per session
- No telemetry collected

## License

MIT
