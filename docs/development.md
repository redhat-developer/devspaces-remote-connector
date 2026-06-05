# Development Guide

How to build, test, and contribute to the Dev Spaces Connector extension.

## Prerequisites

- Node.js 22+
- npm

## Setup

```bash
npm install
```

## Build

```bash
# Development build (includes CA bundle fetch)
npm run compile

# Production build (minified, hidden source maps)
npm run package

# Watch mode (auto-rebuild on changes)
npm run watch
```

## Test

```bash
npm test
```

Tests use Jest with ts-jest. Test files live alongside source files or in `__tests__/` directories.

## Lint

```bash
npm run lint
```

Uses ESLint with TypeScript parser.

## Package VSIX

```bash
npm run vsix
```

Produces `devspaces-connector-<version>.vsix` in the project root.

## Proposed API: `resolvers`

This extension uses the VS Code `resolvers` proposed API to register a custom `RemoteAuthorityResolver`. This is what enables the `vscode-remote://devspaces+...` URI scheme and the K8s exec transport.

For the resolver to activate, the extension ID must be allowed access to proposed APIs. There are two ways:

1. **product.json allowlist** (production) — add the extension ID to `extensionAllowedProposedApi` in the IDE's `product.json`. This is how the distributed VSIX works without any user action.
2. **CLI flag** (development) — launch the IDE with `--enable-proposed-api <extension-id>`.

If neither is in place, the resolver silently won't activate and connections will fail.

## Run in Development

```bash
# Kiro IDE
kiro --enable-proposed-api devspaces.devspaces-connector --extensionDevelopmentPath=.

# VS Code
code --enable-proposed-api devspaces.devspaces-connector --extensionDevelopmentPath=.
```

## Custom CA Certificates (Build-Time)

For environments with custom/enterprise CAs, set environment variables before building:

```bash
# Download CA bundle from a URL
CA_BUNDLE_URL=https://your-pki-server/ca-bundle.pem npm run compile

# Or extract from a server's TLS chain
CA_BUNDLE_HOST=devspaces.your-cluster.example.com npm run compile
```

The `scripts/fetch-ca-bundle.js` script runs automatically as part of `compile` and `package`. It embeds the CA bundle into the extension build.

## Project Structure

```
src/
  extension.ts          Entry point
  auth/                 OAuth2 PKCE authentication
  cluster/              Multi-cluster management
  workspace/            Workspace lifecycle (start/stop/create/delete)
  remote/               RemoteAuthorityResolver, REH setup, port-forward
  views/                TreeView providers
  utils/                Shared utilities
scripts/
  fetch-ca-bundle.js    CA bundle fetcher (runs at build time)
docs/                   Documentation
dist/                   Compiled output (webpack bundle)
```

## Architecture

See [architecture.md](./architecture.md) for detailed technical internals, diagrams, and design decisions.
