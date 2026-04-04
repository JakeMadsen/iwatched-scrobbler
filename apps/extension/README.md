# iWatched Scrobbler Extension

The iWatched browser extension watches supported streaming pages, detects what is currently playing, and sends that activity to iWatched as timeline events. It also keeps a lightweight review queue in the popup so people can rate or review titles after they finish watching.

## What It Does

- Detects playback from supported browser pages
- Connects to iWatched with the extension auth flow
- Adds watched activity to the iWatched timeline once the watch threshold is met
- Prevents obvious duplicate scrobbles
- Lets people rate or review recently watched titles from the popup queue
- Shows connection issues directly on the toolbar icon

## Current Status

This extension is already usable, but it is still being actively shaped.

### Support Matrix

| Service | Status | Page families | Notes |
| --- | --- | --- | --- |
| Prime Video | Working | `https://www.primevideo.com/*`, `https://www.amazon.com/gp/video/*` | Best-supported scrobble target right now |
| Plex | WIP | `https://app.plex.tv/*`, `https://watch.plex.tv/*`, `https://*.plex.direct/*`, local Plex web surfaces | Detection and matching are still being tuned |
| Netflix | Planned | TBD | Not implemented yet |
| Hulu | Planned | TBD | Not implemented yet |
| Disney+ | Planned | TBD | Not implemented yet |
| HBO / Max | Planned | TBD | Not implemented yet |

Beyond service support, these pieces are already working:

- iWatched connection flow
- Automatic timeline scrobbling for supported movie and episode matches
- Review queue and review saving from the popup

## How It Works

1. A site-specific content script reads the active supported page.
2. The background worker turns that into a normalized playback snapshot.
3. The extension tries to resolve the playback to an iWatched title.
4. Once the watch threshold is met, the extension creates a timeline watch event.
5. The watched title is added to Queue so the user can rate or review it later.

## Local Development

### Requirements

- Node.js `>=20`
- npm `>=10`

### Install

From the monorepo root:

```bash
npm install
```

### Run the extension in development

From the monorepo root:

```bash
npm run dev:extension
```

Or from this directory:

```bash
npm run dev
```

### Build the extension

From the monorepo root:

```bash
npm run build --workspace @iwatched-scrobbler/extension
```

The unpacked Chrome build is written to:

```text
apps/extension/.output/chrome-mv3/
```

### Load it in Chrome

1. Open `chrome://extensions`
2. Enable Developer Mode
3. Choose `Load unpacked`
4. Select `apps/extension/.output/chrome-mv3`

## Local iWatched Setup

The extension talks to the iWatched API through the shared API client in:

`packages/api-client/src/index.ts`

The base URL is currently set to:

```ts
export const DEFAULT_IWATCHED_BASE_URL = "http://localhost:3000";
```

That is ideal for local testing against a local iWatched app. Before shipping a release build, make sure this points where you expect.

## Directory Guide

```text
apps/extension/
  assets/                Fonts, icons, and static visual assets
  entrypoints/
    background.ts        Extension background worker
    prime.content.ts     Prime Video content script entrypoint
    plex.content.ts      Plex content script entrypoint
    popup/               React popup application
  lib/
    detection/           Site detection and playback extraction
    extension/           Runtime messages and popup helpers
    iwatched/            Auth, API client helpers, queue helpers, matching
    types/               Shared popup and detection types
  wxt.config.ts          WXT configuration
```

## Contributing

Contributions are welcome, especially around detection quality, matching reliability, popup polish, and new service support.

### Good first contribution areas

- Improve title matching and metadata cleanup
- Tighten playback detection on supported pages
- Improve queue and review UX
- Add better failure states and recovery flows
- Expand support to additional streaming services

### Typical contribution flow

1. Make your changes in the relevant detector, popup surface, or background flow.
2. Build the extension locally.
3. Load the unpacked build in Chrome.
4. Test the full path manually:
   - connection
   - detection
   - timeline scrobble
   - queue behavior
   - review save flow
5. Include a clear note about what pages or playback situations you tested.

### When adding a new streaming service

Try to keep the implementation split into the same layers used by the existing services:

- add a content script entrypoint in `entrypoints/`
- add a detector in `lib/detection/`
- register the service in the background adapter list
- make sure title resolution produces safe write targets
- test both idle page state and active playback state

### Current testing reality

There is not a real automated test suite for the extension yet. Manual verification is still important, especially for:

- title matching
- playback progress detection
- duplicate scrobble prevention
- queue behavior
- auth reconnect flows

## Notes

- The popup is intentionally conservative about what it writes. Safe movie and episode matches are the main sync targets.
- Queue is where follow-up rating and review work should happen, so the main live view can stay focused.
- The toolbar badge is meant to warn the user when the extension connection needs attention.
