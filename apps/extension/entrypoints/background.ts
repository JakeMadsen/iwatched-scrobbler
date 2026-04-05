import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";

import {
  createPrimeWaitingState,
  createUnsupportedSiteState,
  isPrimeUrl
} from "../lib/detection/prime";
import { createPlexWaitingState, isPlexUrl } from "../lib/detection/plex";
import {
  MESSAGE_GET_POPUP_SNAPSHOT,
  MESSAGE_GET_SITE_STATE,
  MESSAGE_MARK_ACTIVE_PLAYBACK_SCROBBLED
} from "../lib/extension/messages";
import { createPopupSnapshot } from "../lib/extension/mock-session";
import {
  AUTH_STORAGE_KEY,
  getStoredConnection,
  getStoredConnectionSession
} from "../lib/iwatched/auth";
import { buildScrobbleInput, IWATCHED_BASE_URL, iwatchedApi } from "../lib/iwatched/client";
import { enqueueReviewFromSite } from "../lib/iwatched/review-queue";
import { resolveIWatchedTarget } from "../lib/iwatched/resolve-target";
import {
  createDefaultExtensionUpdateState,
  isExtensionUpdateStateStale,
  isVersionOutdated,
  normalizeVersionLabel,
  readExtensionUpdateState,
  writeExtensionUpdateState
} from "../lib/iwatched/update-state";
import type { SiteDetectionState } from "../lib/types/popup-state";

interface SiteAdapter {
  contentScriptFile: string;
  isMatch: (url: string) => boolean;
  createWaitingState: (url: string) => SiteDetectionState;
}

interface AutoScrobbleState {
  fingerprint: string;
  sessionKey: string;
  lastPositionSeconds: number | null;
  autoScrobbled: boolean;
  updatedAt: number;
}

interface ActionWarning {
  title: string;
  color: string;
}

type AutoScrobbleStateMap = Record<string, AutoScrobbleState>;

const resolvedTargetCache = new Map<
  string,
  Pick<SiteDetectionState, "iwatchedUrl" | "iwatchedMatchType" | "iwatchedTmdbId" | "iwatchedTargetType">
>();
const autoScrobbleInFlight = new Set<string>();

const SESSION_STATUS_ALARM = "iwatched/session-status";
const PLAYBACK_SYNC_ALARM = "iwatched/playback-sync";
const EXTENSION_UPDATE_ALARM = "iwatched/extension-update";
const SESSION_CHECK_INTERVAL_MINUTES = 1;
const PLAYBACK_SYNC_INTERVAL_MINUTES = 0.5;
const EXTENSION_UPDATE_INTERVAL_MINUTES = 24 * 60;
const SESSION_CHECK_COOLDOWN_MS = 30_000;
const DEFAULT_ACTION_TITLE = "iWatched Scrobbler";
const SIGNED_OUT_BADGE_TEXT = "!";
const AUTO_SCROBBLE_STATE_STORAGE_KEY = "iwatched/auto-scrobble-state";
const AUTO_SCROBBLE_STATE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const AUTO_SCROBBLE_REWIND_GRACE_SECONDS = 120;
const CURRENT_EXTENSION_VERSION = browser.runtime.getManifest().version || "0.1.1";
const UPDATE_WARNING_COLOR = "#b54708";

let lastSessionCheckAt = 0;
let sessionRefreshPromise: Promise<void> | null = null;
let sessionActionWarning: ActionWarning | null = null;
let updateActionWarning: ActionWarning | null = null;

const siteAdapters: SiteAdapter[] = [
  {
    contentScriptFile: "content-scripts/prime.js",
    isMatch: isPrimeUrl,
    createWaitingState: createPrimeWaitingState
  },
  {
    contentScriptFile: "content-scripts/plex.js",
    isMatch: isPlexUrl,
    createWaitingState: createPlexWaitingState
  }
];

async function getActiveTab() {
  const [activeTab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (activeTab) return activeTab;

  const fallbackTabs = await browser.tabs.query({ active: true, currentWindow: true });
  return fallbackTabs[0];
}

async function requestSiteState(tabId: number): Promise<SiteDetectionState | null> {
  try {
    const response = await browser.tabs.sendMessage(tabId, {
      type: MESSAGE_GET_SITE_STATE
    });
    return response && typeof response === "object"
      ? (response as SiteDetectionState)
      : null;
  } catch (_) {
    return null;
  }
}

async function ensureSiteContentScript(tabId: number, file: string) {
  await browser.scripting.executeScript({
    target: { tabId },
    files: [file]
  });
}

function resolveSiteAdapter(url: string): SiteAdapter | null {
  return siteAdapters.find((adapter) => adapter.isMatch(url)) || null;
}

function buildTargetCacheKey(site: SiteDetectionState): string | null {
  const query = site.mediaType === "show"
    ? (site.seriesTitle || site.detectedTitle)
    : site.detectedTitle;

  if (!query) return null;

  return JSON.stringify([
    site.mediaType,
    query,
    site.releaseYear,
    site.seasonNumber,
    site.episodeNumber
  ]);
}

async function enrichIWatchedTarget(site: SiteDetectionState): Promise<SiteDetectionState> {
  const cacheKey = buildTargetCacheKey(site);
  if (!cacheKey) {
    return {
      ...site,
      iwatchedUrl: null,
      iwatchedMatchType: "none",
      iwatchedTmdbId: null,
      iwatchedTargetType: null
    };
  }

  const cached = resolvedTargetCache.get(cacheKey);
  if (cached) {
    return {
      ...site,
      ...cached
    };
  }

  const resolved = await resolveIWatchedTarget(site);
  resolvedTargetCache.set(cacheKey, resolved);

  return {
    ...site,
    ...resolved
  };
}

async function readSiteState(tabId: number, url: string) {
  const liveState = await requestSiteState(tabId);
  if (liveState) return enrichIWatchedTarget(liveState);

  const adapter = resolveSiteAdapter(url);
  if (!adapter) return createUnsupportedSiteState(url);

  try {
    await ensureSiteContentScript(tabId, adapter.contentScriptFile);
    const injectedState = await requestSiteState(tabId);
    if (injectedState) return enrichIWatchedTarget(injectedState);
  } catch (_) {
    const waitingState = adapter.createWaitingState(url);
    return {
      ...waitingState,
      feedbackDetail:
        `${waitingState.siteLabel} is active, but this tab may need a quick refresh before the extension can read playback signals.`
    };
  }

  const waitingState = adapter.createWaitingState(url);
  return {
    ...waitingState,
    feedbackDetail:
      `${waitingState.siteLabel} is active, but the player signals are not readable yet. Refreshing the tab once should fix that.`
  };
}

function isIWatchedUrl(rawUrl?: string | null): boolean {
  if (!rawUrl) return false;

  try {
    const url = new URL(rawUrl);
    const iwatchedBase = new URL(IWATCHED_BASE_URL);
    return url.hostname === iwatchedBase.hostname;
  } catch (_) {
    return false;
  }
}

async function clearActionWarning() {
  await Promise.all([
    browser.action.setBadgeText({ text: "" }),
    browser.action.setTitle({ title: DEFAULT_ACTION_TITLE })
  ]);
}

async function applyActionWarning(title: string, color: string) {
  await Promise.all([
    browser.action.setBadgeText({ text: SIGNED_OUT_BADGE_TEXT }),
    browser.action.setBadgeBackgroundColor({ color }),
    browser.action.setTitle({ title })
  ]);
}

async function syncActionWarning() {
  const warning = sessionActionWarning || updateActionWarning;
  if (!warning) {
    await clearActionWarning();
    return;
  }

  await applyActionWarning(warning.title, warning.color);
}

function ensureSessionAlarm() {
  browser.alarms.create(SESSION_STATUS_ALARM, {
    periodInMinutes: SESSION_CHECK_INTERVAL_MINUTES
  });
}

function ensurePlaybackAlarm() {
  browser.alarms.create(PLAYBACK_SYNC_ALARM, {
    periodInMinutes: PLAYBACK_SYNC_INTERVAL_MINUTES
  });
}

function ensureExtensionUpdateAlarm() {
  browser.alarms.create(EXTENSION_UPDATE_ALARM, {
    periodInMinutes: EXTENSION_UPDATE_INTERVAL_MINUTES
  });
}

function absolutizeIWatchedUrl(pathOrUrl?: string | null): string | null {
  const value = String(pathOrUrl || "").trim();
  if (!value) return null;

  try {
    return new URL(value, IWATCHED_BASE_URL).toString();
  } catch (_) {
    return null;
  }
}

function buildUpdateWarningTitle(latestVersion: string | null): string {
  return latestVersion
    ? `Update available: install iWatched Scrobbler ${latestVersion} to stay current.`
    : "Update available: install the latest iWatched Scrobbler build.";
}

async function refreshSessionIndicator(force = false): Promise<void> {
  const now = Date.now();
  if (!force && sessionRefreshPromise) return sessionRefreshPromise;
  if (!force && now - lastSessionCheckAt < SESSION_CHECK_COOLDOWN_MS) return;

  lastSessionCheckAt = now;
  sessionRefreshPromise = (async () => {
    try {
      const session = await getStoredConnectionSession(false);
      if (session && session.authenticated) {
        sessionActionWarning = null;
        await syncActionWarning();
        return;
      }

      sessionActionWarning = {
        title: "Sign in required: the extension is not connected to iWatched, so new watches will not sync.",
        color: "#b42318"
      };
      await syncActionWarning();
    } catch (_) {
      sessionActionWarning = {
        title: "Attention needed: the extension could not verify its iWatched connection.",
        color: "#b54708"
      };
      await syncActionWarning();
    } finally {
      sessionRefreshPromise = null;
    }
  })();

  return sessionRefreshPromise;
}

async function refreshExtensionUpdateState(force = false): Promise<void> {
  const existingState = await readExtensionUpdateState(CURRENT_EXTENSION_VERSION);
  const shouldReuseCachedState = !force
    && existingState.currentVersion === CURRENT_EXTENSION_VERSION
    && !isExtensionUpdateStateStale(existingState);

  if (shouldReuseCachedState) {
    updateActionWarning = existingState.status === "update_available"
      ? {
          title: buildUpdateWarningTitle(existingState.latestVersion),
          color: UPDATE_WARNING_COLOR
        }
      : null;
    await syncActionWarning();
    return;
  }

  try {
    const release = await iwatchedApi.getPublicClientRelease("browser");
    const latestVersion = normalizeVersionLabel(release.version || "");
    const updateAvailable = !!release.available && isVersionOutdated(CURRENT_EXTENSION_VERSION, latestVersion);
    const nextState = {
      status: updateAvailable ? "update_available" : "current",
      currentVersion: CURRENT_EXTENSION_VERSION,
      latestVersion: latestVersion || null,
      checkedAt: Date.now(),
      detailsUrl: absolutizeIWatchedUrl(release.details_url || "/scrobbler#downloads"),
      downloadUrl: absolutizeIWatchedUrl(release.download_url || null),
      message: updateAvailable
        ? `Version ${latestVersion || release.version} is available on iWatched.`
        : null
    } as const;

    await writeExtensionUpdateState(nextState);
    updateActionWarning = updateAvailable
      ? {
          title: buildUpdateWarningTitle(nextState.latestVersion),
          color: UPDATE_WARNING_COLOR
        }
      : null;
    await syncActionWarning();
  } catch (_) {
    const fallbackState = existingState.status === "update_available"
      ? existingState
      : {
          ...createDefaultExtensionUpdateState(CURRENT_EXTENSION_VERSION),
          status: "error" as const,
          checkedAt: Date.now(),
          message: "Could not check for the latest extension build."
        };

    await writeExtensionUpdateState(fallbackState);
    updateActionWarning = fallbackState.status === "update_available"
      ? {
          title: buildUpdateWarningTitle(fallbackState.latestVersion),
          color: UPDATE_WARNING_COLOR
        }
      : null;
    await syncActionWarning();
  }
}

async function readAutoScrobbleStateMap(): Promise<AutoScrobbleStateMap> {
  const stored = await browser.storage.local.get(AUTO_SCROBBLE_STATE_STORAGE_KEY);
  const raw = stored ? stored[AUTO_SCROBBLE_STATE_STORAGE_KEY] : null;
  if (!raw || typeof raw !== "object") return {};

  const now = Date.now();
  const next: AutoScrobbleStateMap = {};

  for (const [tabKey, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;

    const candidate = value as Partial<AutoScrobbleState>;
    if (!candidate.fingerprint || !candidate.sessionKey) continue;

    const updatedAt = Number(candidate.updatedAt || 0);
    if (!updatedAt || now - updatedAt > AUTO_SCROBBLE_STATE_MAX_AGE_MS) continue;

    next[tabKey] = {
      fingerprint: String(candidate.fingerprint),
      sessionKey: String(candidate.sessionKey),
      lastPositionSeconds:
        candidate.lastPositionSeconds == null || !Number.isFinite(Number(candidate.lastPositionSeconds))
          ? null
          : Number(candidate.lastPositionSeconds),
      autoScrobbled: candidate.autoScrobbled === true,
      updatedAt
    };
  }

  return next;
}

async function writeAutoScrobbleStateMap(stateMap: AutoScrobbleStateMap): Promise<void> {
  await browser.storage.local.set({
    [AUTO_SCROBBLE_STATE_STORAGE_KEY]: stateMap
  });
}

function buildAutoScrobbleFingerprint(site: SiteDetectionState): string | null {
  const identity = site.iwatchedTmdbId || site.detectedTitle || site.seriesTitle;
  if (!identity) return null;

  return JSON.stringify([
    site.siteKey,
    site.iwatchedTargetType || site.mediaType,
    identity,
    site.releaseYear ?? null,
    site.seasonNumber ?? null,
    site.episodeNumber ?? null
  ]);
}

function shouldStartNewPlaybackSession(
  existing: AutoScrobbleState,
  fingerprint: string,
  positionSeconds: number | null
): boolean {
  if (existing.fingerprint !== fingerprint) return true;
  if (positionSeconds == null || existing.lastPositionSeconds == null) return false;

  return positionSeconds + AUTO_SCROBBLE_REWIND_GRACE_SECONDS < existing.lastPositionSeconds;
}

async function markPlaybackSessionScrobbled(
  tabId: number,
  site: SiteDetectionState
): Promise<void> {
  const fingerprint = buildAutoScrobbleFingerprint(site);
  if (!fingerprint) return;

  const stateMap = await readAutoScrobbleStateMap();
  const tabKey = String(tabId);
  const positionSeconds = site.playbackPositionSeconds ?? null;
  const existing = stateMap[tabKey];
  const next = !existing || shouldStartNewPlaybackSession(existing, fingerprint, positionSeconds)
    ? {
      fingerprint,
      sessionKey: `${tabId}-${Date.now()}`,
      lastPositionSeconds: positionSeconds,
      autoScrobbled: true,
      updatedAt: Date.now()
    }
    : {
      ...existing,
      lastPositionSeconds: positionSeconds,
      autoScrobbled: true,
      updatedAt: Date.now()
    };

  stateMap[tabKey] = next;
  await writeAutoScrobbleStateMap(stateMap);
}

async function maybeAutoScrobbleSite(tabId: number, site: SiteDetectionState): Promise<void> {
  if (!site.supported) {
    const stateMap = await readAutoScrobbleStateMap();
    if (stateMap[String(tabId)]) {
      delete stateMap[String(tabId)];
      await writeAutoScrobbleStateMap(stateMap);
    }
    return;
  }

  const fingerprint = buildAutoScrobbleFingerprint(site);
  if (!fingerprint) return;

  const stateMap = await readAutoScrobbleStateMap();
  const tabKey = String(tabId);
  const positionSeconds = site.playbackPositionSeconds ?? null;
  const existing = stateMap[tabKey];
  const nextState = !existing || shouldStartNewPlaybackSession(existing, fingerprint, positionSeconds)
    ? {
      fingerprint,
      sessionKey: `${tabId}-${Date.now()}`,
      lastPositionSeconds: positionSeconds,
      autoScrobbled: false,
      updatedAt: Date.now()
    }
    : {
      ...existing,
      lastPositionSeconds: positionSeconds,
      updatedAt: Date.now()
    };

  stateMap[tabKey] = nextState;
  await writeAutoScrobbleStateMap(stateMap);

  if (!site.watchThresholdMet || nextState.autoScrobbled) return;

  const input = buildScrobbleInput(site, {
    watchedAt: new Date().toISOString(),
    playbackSessionKey: nextState.sessionKey
  });
  if (!input) return;
  if (autoScrobbleInFlight.has(nextState.sessionKey)) return;

  autoScrobbleInFlight.add(nextState.sessionKey);

  try {
    const result = await iwatchedApi.scrobble(input);
    if (!result || !result.ok) return;

    await enqueueReviewFromSite(site, input.watchedAt);

    const latestStateMap = await readAutoScrobbleStateMap();
    const latest = latestStateMap[tabKey];
    if (latest && latest.sessionKey === nextState.sessionKey) {
      latestStateMap[tabKey] = {
        ...latest,
        lastPositionSeconds: positionSeconds,
        autoScrobbled: true,
        updatedAt: Date.now()
      };
      await writeAutoScrobbleStateMap(latestStateMap);
    }
  } catch (_) {
    // Ignore automatic scrobble failures and try again on the next playback sync tick.
  } finally {
    autoScrobbleInFlight.delete(nextState.sessionKey);
  }
}

async function maybeAutoScrobbleActivePlayback(): Promise<void> {
  const storedConnection = await getStoredConnection();
  if (!storedConnection) return;

  const activeTab = await getActiveTab();
  const url = activeTab?.url || "";
  if (!activeTab?.id || !resolveSiteAdapter(url)) return;

  const site = await readSiteState(activeTab.id, url);
  await maybeAutoScrobbleSite(activeTab.id, site);
}

export default defineBackground(() => {
  ensureSessionAlarm();
  ensurePlaybackAlarm();
  ensureExtensionUpdateAlarm();
  void refreshSessionIndicator(true);
  void refreshExtensionUpdateState(false);
  void maybeAutoScrobbleActivePlayback();

  browser.runtime.onInstalled.addListener(() => {
    ensureSessionAlarm();
    ensurePlaybackAlarm();
    ensureExtensionUpdateAlarm();
    void refreshSessionIndicator(true);
    void refreshExtensionUpdateState(true);
    void maybeAutoScrobbleActivePlayback();
  });

  browser.runtime.onStartup.addListener(() => {
    ensureSessionAlarm();
    ensurePlaybackAlarm();
    ensureExtensionUpdateAlarm();
    void refreshSessionIndicator(true);
    void refreshExtensionUpdateState(false);
    void maybeAutoScrobbleActivePlayback();
  });

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[AUTH_STORAGE_KEY]) return;
    void refreshSessionIndicator(true);
    void maybeAutoScrobbleActivePlayback();
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (!alarm) return;

    if (alarm.name === SESSION_STATUS_ALARM) {
      void refreshSessionIndicator(true);
      return;
    }

    if (alarm.name === PLAYBACK_SYNC_ALARM) {
      void maybeAutoScrobbleActivePlayback();
      return;
    }

    if (alarm.name === EXTENSION_UPDATE_ALARM) {
      void refreshExtensionUpdateState(false);
    }
  });

  browser.tabs.onActivated.addListener(() => {
    void maybeAutoScrobbleActivePlayback();
  });

  browser.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete") return;

    if (isIWatchedUrl(tab.url)) {
      void refreshSessionIndicator(true);
    }

    if (tab.active && resolveSiteAdapter(tab.url || "")) {
      void maybeAutoScrobbleActivePlayback();
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") return undefined;

    if (message.type === MESSAGE_GET_POPUP_SNAPSHOT) {
      void (async () => {
        try {
          const activeTab = await getActiveTab();
          const url = activeTab?.url || "";
          const title = activeTab?.title || "";

          if (!activeTab?.id) {
            sendResponse(createPopupSnapshot(createUnsupportedSiteState(url), title));
            return;
          }

          const activeSite = await readSiteState(activeTab.id, url);
          sendResponse(createPopupSnapshot(activeSite, title));
        } catch (_) {
          sendResponse(createPopupSnapshot(createUnsupportedSiteState(""), ""));
        }
      })();

      return true;
    }

    if (message.type === MESSAGE_MARK_ACTIVE_PLAYBACK_SCROBBLED) {
      void (async () => {
        try {
          const activeTab = await getActiveTab();
          const url = activeTab?.url || "";
          if (!activeTab?.id || !resolveSiteAdapter(url)) {
            sendResponse({ ok: false });
            return;
          }

          const activeSite = await readSiteState(activeTab.id, url);
          await markPlaybackSessionScrobbled(activeTab.id, activeSite);
          sendResponse({ ok: true });
        } catch (_) {
          sendResponse({ ok: false });
        }
      })();

      return true;
    }

    return undefined;
  });
});
