# Architecture Notes

## Intent

The scrobbler is structured as a client monorepo so shared logic is implemented once and consumed by multiple runtimes.

## Boundaries

### This repo owns

- extension code
- desktop code
- adapter code
- shared API client code
- shared client-side domain logic

### The private iWatched repo owns

- auth/token issuance
- server-side scrobble ingestion
- persistent watch-state updates
- abuse protection
- production secrets

## Package Responsibilities

### `packages/core`

Shared domain logic such as:

- normalized scrobble payload shapes
- idempotency helpers
- playback-state helpers
- title matching confidence rules

### `packages/api-client`

Shared logic for talking to the public iWatched scrobble API.

### `packages/adapters`

Platform-specific detection and extraction logic.

### `packages/ui`

Shared UI primitives for auth, confirmation, settings, and troubleshooting flows.

## App Responsibilities

### `apps/extension`

The primary MVP client.

Expected responsibilities:

- site detection
- playback observation
- sign-in / connect flow
- manual confirmation when confidence is low

### `apps/desktop`

Deferred until there is a clear requirement.

Expected future responsibilities:

- background helper tasks
- non-browser integration support
- advanced diagnostics
