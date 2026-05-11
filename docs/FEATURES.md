# Delta Dev Spaces Connector — Feature Guide

## Current Features

### Authentication

- **Browser-based OAuth login** — Click "Sign In to Dev Spaces" and authenticate via Delta SSO in your browser. No `oc` CLI needed.
- **Uses `openshift-cli-client`** — Same OAuth client as `oc login --web`. Supports PKCE. Pre-registered on every OpenShift cluster.
- **Token stored securely** — OAuth token saved in VS Code SecretStorage (OS keychain backed) with globalState fallback for cross-window access.
- **Background token refresh** — Token is automatically refreshed 5 minutes before expiry by silently re-running the OAuth flow (SSO session makes this instant).
- **Smart cluster URL** — Paste any URL from your cluster (dashboard, console, workspace URL, API URL, CNAME like `devspaces.delta.com`) and the extension figures out the rest.
- **Kiro SSO sync** — Kiro auth tokens are automatically copied to the workspace pod during connect, preventing the Kiro login prompt in remote sessions.

### Multi-Cluster Support

- **Multiple clusters** — Register and manage multiple DevSpaces clusters simultaneously.
- **Default cluster** — `devspaces.delta.com` is pre-populated on first launch. Users just click Sign In.
- **Add Cluster** — Paste any URL, the extension discovers endpoints and adds it to the list.
- **Remove Cluster** — Right-click a cluster in the sidebar → Remove. Cleans up connections.
- **Simultaneous loading** — Workspaces from all registered clusters load in parallel on activation.
- **Smart display names** — Friendly hostnames shown directly (e.g. `devspaces.delta.com`). Long ROSA URLs shown as `devspaces@<cluster-name>`.
- **Auto-refresh** — Workspace list refreshes every 30 seconds per cluster. Changes appear automatically.

### Workspace Management

- **Sidebar TreeView** — All clusters and their workspaces listed in the activity bar:
  - Cluster nodes with workspace count
  - Workspace items with real-time status icons:
    - 🟢 Running
    - ⚪ Stopped
    - 🔄 Starting/Stopping (animated spinner)
    - 🔴 Failed
  - Workspace display names from `kubernetes.io/metadata.name` label (respects renames in dashboard)
- **Start/Stop/Restart** — One-click workspace lifecycle management from the sidebar or Command Palette.
- **Delete workspace** — With confirmation dialog.
- **Create workspace from Git URL** — Creates a DevWorkspace via K8s API with `che.eclipse.org/che-editor` annotation.
- **Create empty workspace** — Creates a blank workspace with optional custom name.
- **Open in browser** — Open the workspace in the DevSpaces dashboard.
- **Live spinner** — Tree view shows animated spinner icon while a workspace is starting or stopping.

### Remote Connection (K8s Exec Transport)

- **No SSH required** — Connects to ANY running workspace via Kubernetes exec API. No SSH server, no SSH keys, no special editor template needed.
- **One-click connect** — Click "Connect" on a running workspace. Extension handles everything:
  1. Starts workspace if stopped
  2. Caches auth token for the resolver
  3. Syncs Kiro SSO auth to the pod
  4. Discovers project folder via K8s exec
  5. Opens remote session — resolver installs REH, port-forwards, connects
- **Full remote development** — File explorer, terminal, extensions, IntelliSense — all running on the remote workspace.
- **Same user context** — Terminal and file permissions match the native DevSpaces IDE experience (no SSH user mismatch).
- **Auto project folder** — Automatically opens the cloned repository folder.
- **Dynamic pod discovery** — Pod names are ephemeral (change on restart, OOM, reschedule). The extension always discovers the current pod from the DevWorkspace CR's `devworkspaceId` — never stores stale pod names.
- **Main container detection** — Reads the DevWorkspace CR to find the first component with `mountSources: true` — same logic the DevWorkspace operator uses for editor injection.
- **Port forwarding** — Apps running on ports inside the pod are forwarded to localhost on your machine via K8s port-forward (tunnelFactory).
- **Nexus REH download** — REH server tarball downloaded from Delta's Nexus (upstream `prod.download.desktop.kiro.dev` is firewalled). URL configurable via `devspaces.rehDownloadUrl`.
- **REH server reuse** — If the REH server is already installed from a previous session, it's reused without re-downloading.
- **Automatic reconnection** — When a pod is killed (OOM, reschedule), the resolver polls for the new pod (up to 2 minutes), re-installs REH, and reconnects. If the workspace is stopped, prompts to restart.

### Built-in Remote Authority Resolver

- **No Remote-SSH dependency** — The extension registers its own `RemoteAuthorityResolver` for the `devspaces` authority using the VS Code proposed `resolvers` API.
- **K8s exec transport** — REH server installed and started via K8s exec. Connection tunneled via K8s port-forward. No SSH anywhere in the stack.
- **Label formatter** — Remote window title shows `DevSpaces: <workspace-name>` instead of a raw SSH host.
- **Error handling** — On connection failure: if workspace is running, retries automatically. If stopped, shows "Restart Workspace" / "Close Remote" dialog.

### Shutdown Behavior

- **Workspace shutdown prompt** — When closing Kiro, if you have running workspaces across any cluster, you're asked whether to stop them or leave them running.
- **Clean disconnect** — Port-forwards and connections are properly closed on disconnect.

### Extension Behavior in Remote Sessions

- **Local-only UI** — Extension runs on the local side only (`extensionKind: ["ui"]`).
- **Hidden in remote windows** — The Dev Spaces sidebar (Workspaces and Welcome views) is hidden in remote sessions using the built-in `remoteName` context key. No sign-in prompt shown on the remote side.
- **Status bar indicator** — In remote sessions, a status bar item shows the connected workspace name.

### Configuration

| Setting | Description |
| --- | --- |
| `devspaces.autoConnect` | Auto-connect to last workspace on startup (default: false) |
| `devspaces.autoOpenFolder` | Auto-open project folder after connecting (default: true) |
| `devspaces.rehDownloadUrl` | Nexus URL template for Kiro REH server download |
| `devspaces.connectionTimeout` | Max seconds to wait for workspace start (default: 300) |
| `devspaces.reconnect.enabled` | Auto-reconnect on connection loss (default: true) |
| `devspaces.reconnect.maxRetries` | Max reconnection attempts (default: 5) |
| `devspaces.logLevel` | Logging verbosity: debug/info/warn/error (default: info) |
| `devspaces.hideRemoteExplorer` | Hide the Remote-SSH explorer sidebar (default: true) |

### Commands (Command Palette)

| Command | Description |
| --- | --- |
| Dev Spaces: Sign In | Authenticate to your cluster |
| Dev Spaces: Sign Out | Clear stored credentials |
| Dev Spaces: Add Cluster | Add a new DevSpaces cluster |
| Dev Spaces: Remove Cluster | Remove a cluster (right-click in sidebar) |
| Dev Spaces: Refresh Workspaces | Reload workspace list (also auto-refreshes every 30s) |
| Dev Spaces: Start Workspace | Start a stopped workspace |
| Dev Spaces: Stop Workspace | Stop a running workspace |
| Dev Spaces: Restart Workspace | Stop then start a workspace |
| Dev Spaces: Delete Workspace | Delete a workspace (with confirmation) |
| Dev Spaces: Create Workspace from Git URL | Create a new workspace from a Git repository |
| Dev Spaces: Create Empty Workspace | Create a blank workspace with optional name |
| Dev Spaces: Connect to Workspace | Connect and open remote session |
| Dev Spaces: Disconnect | Close the active connection |
| Dev Spaces: Open in Browser | Open workspace in DevSpaces dashboard |
| Dev Spaces: View Workspace Logs | Show extension output channel |

---

## Architecture

### How Authentication Works

```text
User clicks "Sign In"
  → Extension discovers cluster from URL (handles CNAME, ROSA, API URLs)
  → Opens browser to OpenShift OAuth (openshift-cli-client + PKCE)
  → User authenticates via Delta SSO
  → Browser redirects to localhost callback with auth code
  → Extension exchanges code for token
  → Token stored in SecretStorage + globalState (cross-window fallback)
  → Background timer schedules refresh before expiry
```

### How Connect Works (K8s Exec)

```text
User clicks "Connect" on workspace
  → Start workspace if stopped (K8s API patch spec.started=true)
  → Wait for Running phase (polling every 3s)
  → Cache token in globalState for resolver
  → Copy Kiro SSO auth to pod (~/.aws/sso/cache/kiro-auth-token.json)
  → Discover project folder via K8s exec (ls /projects)
  → Persist connection info (workspace name, namespace, devworkspaceId, clusterUrl)
  → Ask: "Current Window" or "New Window"
  → Open vscode-remote://devspaces+devspaces-<name>/projects/<repo>

Resolver activates in the new window:
  → Read connection info from globalState
  → Build KubeConfig from cached token + cluster URL
  → Find current pod via devworkspaceId label (polls up to 2 min if restarting)
  → Find main container via DevWorkspace CR mountSources attribute
  → K8s exec: install REH server (download from Nexus, extract)
  → K8s exec: start REH server (--host=127.0.0.1 --port=0)
  → K8s port-forward: localhost:random → pod:<REH-port>
  → Return ResolvedAuthority(localhost, port, token)
  → Kiro connects to REH server → full remote IDE session

On pod restart (OOM, reschedule, manual delete):
  → Resolver called again with incremented resolveAttempt
  → Polls for new pod (up to 2 minutes)
  → Re-installs REH, re-establishes port-forward
  → Session resumes with new connection token

On workspace stopped:
  → Shows "Your workspace is not running" dialog
  → "Restart Workspace" starts it and reloads window
  → "Close Remote" closes the remote session
```

### Component Architecture

```text
┌─────────────────────────────────────────────────────────┐
│ Kiro (Local)                                            │
│                                                         │
│  ┌─────────────────┐  ┌──────────────────────────────┐  │
│  │ ClusterManager  │  │ RemoteAuthorityResolver      │  │
│  │ (multi-cluster) │  │ (resolvers proposed API)     │  │
│  └────────┬────────┘  └──────────┬───────────────────┘  │
│           │                      │                      │
│  ┌────────▼────────┐  ┌─────────▼────────────────────┐  │
│  │ WorkspaceManager│  │ ServerSetup (K8s exec)       │  │
│  │ (per cluster)   │  │ Install + start REH server   │  │
│  └────────┬────────┘  └─────────┬────────────────────┘  │
│           │                      │                      │
│  ┌────────▼────────┐  ┌─────────▼────────────────────┐  │
│  │ DevWorkspaceApi │  │ K8s PortForward              │  │
│  │ NamespaceApi    │  │ localhost → pod:REH-port     │  │
│  │ PodDiscovery    │  └──────────────────────────────┘  │
│  └────────┬────────┘                                    │
│           │                                             │
│  ┌────────▼────────┐                                    │
│  │ OpenShift OAuth │                                    │
│  │ (PKCE + SSO)    │                                    │
│  └─────────────────┘                                    │
│                                                         │
└──────────────────────────┬──────────────────────────────┘
                           │ K8s API (exec, port-forward)
                           ▼
┌─────────────────────────────────────────────────────────┐
│ Workspace Pod                                           │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ Kiro REH Server (kiro-server)                   │    │
│  │ - Listening on 127.0.0.1:<random-port>          │    │
│  │ - Connection token authentication               │    │
│  │ - Remote extension host                         │    │
│  │ - File system, terminal, IntelliSense           │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  /projects/<repo>  ← project files                      │
│  ~/.aws/sso/cache/ ← Kiro auth (synced from local)     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### What Changed from v0.1.0 (SSH) to v0.6.0 (K8s Exec)

| Capability | v0.1.0 (SSH) | v0.6.0 (K8s Exec) |
| --- | --- | --- |
| Transport | SSH via `ssh2` library | K8s exec + port-forward |
| Requires in pod | sshd + SSH keys | Nothing extra |
| Editor template | `che-code-sshd` required | Any editor works |
| User permissions | SSH user context (may differ) | Container default user (matches native) |
| Native modules | `ssh2` (platform-specific VSIX) | None (universal VSIX, 343 KB) |
| Port forwarding | SSH tunnels | K8s port-forward API |
| REH download | Configured via Remote-SSH setting | Direct via install script from Nexus |
| Remote-SSH dependency | Required | Not needed (built-in resolver) |
| Pod restart handling | Stored pod name (stale) | Dynamic discovery + polling (up to 2 min) |
| Multi-cluster | Single cluster only | Multiple clusters simultaneously |
| Container selection | Exclude sidecars by name | DevWorkspace CR mountSources attribute |
| Workspace creation | Raw K8s API | K8s API with che-editor annotation |
| Auto-refresh | Manual only | Every 30 seconds |
| Kiro auth sync | Not available | Copies SSO token to pod |

---

## Security

- OAuth tokens stored in VS Code SecretStorage (OS keychain backed) with globalState fallback
- All API communication over TLS (K8s API, OAuth endpoints)
- Bearer tokens redacted from log output
- Connection tokens for REH server are unique per session (UUID)
- K8s exec authenticated via the same OAuth token used for workspace management
- No SSH keys written to disk (v2 doesn't use SSH)
- Kiro SSO token copied to pod with 600 permissions
- No telemetry or analytics collected

---

## Known Limitations

- Token refresh opens a browser tab briefly (SSO makes it instant but visible)
- `deactivate` has ~5 second window — stopping many workspaces on shutdown may not complete
- Extension identity uses `asbx.remote-ssh` to access the `resolvers` proposed API (Kiro allowlist constraint). Pending: request to add `deltaairlines.devspaces-connector` to Kiro's allowlist.
- REH server download (~170MB) takes time on first connect. Subsequent connects reuse the installed server.
- macOS may show "OS keyring couldn't be identified" warning on first sign-in — dismiss once, doesn't affect functionality.
