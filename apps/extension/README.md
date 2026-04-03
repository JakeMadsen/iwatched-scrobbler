# Extension App

This app will become the first production scrobbler client.

Planned responsibilities:

- detect supported playback environments
- gather title metadata from supported sites
- authenticate the user with iWatched
- submit scrobbles through the shared API client
- prompt for confirmation when matching confidence is low

## Current State

The extension now uses a real React-based WXT app structure.

Current capabilities:

- React popup with bottom navigation views
- emulated signed-in state for UI development
- Prime Video detection pipeline started
- popup feedback based on the active browser tab
- disclaimer view explaining the current prototype behavior

## Structure

```text
assets/
  brand/
  fonts/
  icons/
public/
entrypoints/
  background.ts
  popup/
  prime.content.ts
lib/
  detection/
  extension/
  types/
wxt.config.ts
tsconfig.json
```

### Directory intent

- `entrypoints/popup/` holds the popup React app.
- `entrypoints/background.ts` is the service worker entrypoint.
- `entrypoints/prime.content.ts` is the first content script target.
- `lib/detection/` holds Prime-specific extraction and detection logic.
- `lib/extension/` holds message contracts and mock session helpers.
- `lib/types/` holds shared types used across the extension surfaces.

## Development

Run:

```bash
npm run dev
```

WXT will build the extension and open a Chrome-targeted development flow.

If you want to load the build manually, use the generated extension output from:

```text
.output/chrome-mv3/
```
