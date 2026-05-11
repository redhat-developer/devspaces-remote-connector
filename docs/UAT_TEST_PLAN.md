# Delta Dev Spaces Connector — UAT Test Plan

## Prerequisites

- Kiro IDE installed on macOS or Windows
- Network access to DevSpaces cluster(s)
- Delta SSO credentials
- At least one DevSpaces cluster available (default: devspaces.delta.com)

## Reset for Clean Testing

```bash
# Clear all extension state
sqlite3 ~/Library/Application\ Support/Kiro/User/globalStorage/state.vscdb \
  "DELETE FROM ItemTable WHERE key LIKE '%asbx%' OR key LIKE '%remote-ssh%' OR key LIKE '%devspaces%';"

# Uninstall and reinstall extension
# Then restart Kiro
```

---

## Test Cases

### TC-01: First Launch Experience

1. Install the VSIX on a clean Kiro instance
2. Open the Dev Spaces sidebar (activity bar icon)
3. **Expected:** `devspaces.delta.com` cluster appears with "Sign In to Dev Spaces" welcome view
4. **Expected:** Documentation link points to `https://zap.delta.com/devex/genai/kiro/devspaces-guide/`

### TC-02: Sign In

1. Click "Sign In to Dev Spaces"
2. Browser opens to Delta SSO
3. Authenticate
4. **Expected:** Browser shows "Authentication Successful" page
5. **Expected:** Sidebar shows cluster with workspace count
6. **Expected:** Output channel shows "Signed in as <username>"

### TC-03: Workspace List

1. After sign-in, check the sidebar tree
2. **Expected:** All user workspaces listed under the cluster node
3. **Expected:** Status icons: 🟢 Running, ⚪ Stopped, 🔴 Failed
4. **Expected:** Workspace display names match dashboard (respects renames)
5. **Expected:** Workspace count shown on cluster node

### TC-04: Auto-Refresh

1. Start a workspace from the DevSpaces dashboard (browser)
2. Wait up to 30 seconds
3. **Expected:** Workspace status updates in sidebar without manual refresh

### TC-05: Start Workspace

1. Right-click a stopped workspace → Start
2. **Expected:** Spinner icon appears during Starting phase
3. **Expected:** Notification shows progress
4. **Expected:** Status changes to Running (🟢) when ready

### TC-06: Stop Workspace

1. Right-click a running workspace → Stop
2. **Expected:** Workspace status changes to Stopped (⚪)
3. **Expected:** Notification confirms stop

### TC-07: Connect to Running Workspace

1. Click Connect (plug icon) on a running workspace
2. **Expected:** Progress notification shows steps (1/5 through 5/5)
3. **Expected:** "Current Window" / "New Window" prompt appears
4. Choose "New Window"
5. **Expected:** New Kiro window opens with remote session
6. **Expected:** File explorer shows `/projects/<repo>` contents
7. **Expected:** Terminal opens in the pod's user context
8. **Expected:** Window title shows "DevSpaces: <workspace-name>"
9. **Expected:** Dev Spaces sidebar is hidden in remote window

### TC-08: Connect to Stopped Workspace

1. Click Connect on a stopped workspace
2. **Expected:** Workspace starts automatically
3. **Expected:** Progress shows "Starting workspace..."
4. **Expected:** After Running, continues with connect flow

### TC-09: Port Forwarding

1. While connected, run an app in the terminal (e.g. `python3 -m http.server 8080`)
2. **Expected:** Port appears in the Ports tab
3. **Expected:** `localhost:<forwarded-port>` accessible from local browser

### TC-10: Pod Restart Reconnection

1. While connected, kill the pod: `oc delete pod <pod-name> -n <namespace>`
2. **Expected:** "Attempting to reconnect" countdown appears
3. **Expected:** Resolver polls for new pod (up to 2 minutes)
4. **Expected:** Session reconnects automatically when new pod is ready
5. **Expected:** Terminal and file explorer work after reconnect

### TC-11: Workspace Stopped During Session

1. While connected, stop the workspace from the dashboard
2. **Expected:** "Your workspace is not running" dialog appears
3. Click "Restart Workspace"
4. **Expected:** Workspace starts and window reloads
5. **Expected:** Session reconnects

### TC-12: Create Workspace from Git URL

1. Click the repo-clone icon in sidebar title bar
2. Enter a Git URL (e.g. `https://git.delta.com/team/my-app.git`)
3. Enter branch (or leave empty)
4. **Expected:** Input boxes stay open on focus loss (ignoreFocusOut)
5. **Expected:** Workspace created and appears in sidebar
6. **Expected:** Workspace is in Stopped state initially

### TC-13: Create Empty Workspace

1. Click the file-add icon in sidebar title bar
2. Enter a name (or leave empty)
3. **Expected:** Empty workspace created and appears in sidebar

### TC-14: Delete Workspace

1. Right-click a workspace → Delete
2. **Expected:** Confirmation dialog appears
3. Confirm deletion
4. **Expected:** Workspace removed from sidebar

### TC-15: Add Second Cluster

1. Click the + icon in sidebar title bar
2. Enter a different cluster URL (e.g. `https://devspaces.apps.devspc02-1d.zs5b.p1.openshiftapps.com`)
3. **Expected:** New cluster appears in sidebar
4. **Expected:** Sign-in flow triggers
5. **Expected:** Both clusters show workspaces simultaneously

### TC-16: Remove Cluster

1. Right-click a cluster → Remove
2. **Expected:** Confirmation dialog
3. Confirm removal
4. **Expected:** Cluster and its workspaces removed from sidebar

### TC-17: Sign Out

1. Command Palette → "Dev Spaces: Sign Out"
2. **Expected:** All workspaces cleared from sidebar
3. **Expected:** Welcome view with "Sign In" button appears

### TC-18: Kiro Auth Sync

1. Connect to a workspace
2. In the remote terminal, check: `cat ~/.aws/sso/cache/kiro-auth-token.json`
3. **Expected:** File exists with valid token content
4. **Expected:** Kiro login prompt does NOT appear in remote window (or appears less frequently)

### TC-19: Multi-Container Workspace

1. Create/start a workspace with multiple containers (e.g. nodejs + mongodb)
2. Connect to it
3. **Expected:** REH server installed in the main dev container (the one with mountSources: true)
4. **Expected:** Terminal opens in the correct container

### TC-20: Current Window Connect

1. Connect to a workspace, choose "Current Window"
2. **Expected:** Window reloads and opens remote session
3. **Expected:** Session works (resolver re-establishes connection after reload)

---

## Edge Cases

- **Expired token:** Sign in, wait 24+ hours, try to connect. Should prompt re-auth.
- **Network interruption:** Disconnect VPN while connected. Should show reconnect dialog.
- **Concurrent sessions:** Connect to two different workspaces in two windows.
- **Large workspace:** Workspace with many files/extensions. Verify performance.
- **Workspace with no /projects:** Empty workspace with no Git project. Should open /projects root.
