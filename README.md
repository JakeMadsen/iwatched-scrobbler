# iWatched Scrobbler

This repository contains the public client-side scrobbler code for iWatched.

It is intended to hold:

- browser extension clients
- a future desktop companion
- shared API client code
- shared site adapters
- shared UI or utility packages

It does not contain the private iWatched server, token issuing logic, or production secrets. Those stay in the main iWatched repository.

## Repository Layout

```text
apps/
  extension/   Browser extension app
  desktop/     Future desktop companion
packages/
  adapters/    Site/platform adapters
  api-client/  Shared client for the iWatched scrobble API
  core/        Shared domain logic
  ui/          Shared UI components or primitives
docs/          Repo-specific architecture and roadmap notes
```

## Current Status

This repo is in setup mode.

The initial focus is:

1. define the public client structure
2. keep shared logic in packages instead of duplicating it per app
3. prepare for a browser-extension-first MVP

## Getting Started

This is an npm workspace monorepo.

```bash
npm install
```

Useful commands:

```bash
npm run dev:extension
npm run dev:desktop
```

The app-level commands are placeholders until the first implementation pass lands.

## Notes

- The iWatched backend and deployment config live in the private main repo.
- The public scrobbler should consume a dedicated scrobble API instead of reaching into private server internals.
- If the license for this repo should be changed from MIT to GPL or AGPL, do that before the first substantial public release.
