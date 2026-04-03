import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";

import {
  createPrimeWaitingState,
  createUnsupportedSiteState,
  isPrimeUrl
} from "../lib/detection/prime";
import {
  MESSAGE_GET_POPUP_SNAPSHOT,
  MESSAGE_GET_PRIME_STATE
} from "../lib/extension/messages";
import { resolveIWatchedTarget } from "../lib/iwatched/resolve-target";
import { createPopupSnapshot } from "../lib/extension/mock-session";
import type { SiteDetectionState } from "../lib/types/popup-state";

const resolvedTargetCache = new Map<
  string,
  Pick<SiteDetectionState, "iwatchedUrl" | "iwatchedMatchType">
>();

async function getActiveTab() {
  const [activeTab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (activeTab) return activeTab;

  const fallbackTabs = await browser.tabs.query({ active: true, currentWindow: true });
  return fallbackTabs[0];
}

async function requestPrimeState(tabId: number): Promise<SiteDetectionState | null> {
  try {
    const response = await browser.tabs.sendMessage(tabId, {
      type: MESSAGE_GET_PRIME_STATE
    });
    return response && typeof response === "object"
      ? (response as SiteDetectionState)
      : null;
  } catch (_) {
    return null;
  }
}

async function ensurePrimeContentScript(tabId: number) {
  await browser.scripting.executeScript({
    target: { tabId },
    files: ["content-scripts/prime.js"]
  });
}

function buildTargetCacheKey(site: SiteDetectionState): string | null {
  const query = site.mediaType === "show"
    ? (site.seriesTitle || site.detectedTitle)
    : site.detectedTitle;

  if (!query) return null;

  return JSON.stringify([
    site.mediaType,
    query,
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
      iwatchedMatchType: "none"
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

async function readPrimeState(tabId: number, url: string) {
  const liveState = await requestPrimeState(tabId);
  if (liveState) return enrichIWatchedTarget(liveState);

  if (!isPrimeUrl(url)) return createUnsupportedSiteState(url);

  try {
    await ensurePrimeContentScript(tabId);
    const injectedState = await requestPrimeState(tabId);
    if (injectedState) return enrichIWatchedTarget(injectedState);
  } catch (_) {
    return {
      ...createPrimeWaitingState(url),
      feedbackDetail:
        "Prime is active, but this tab may need a quick refresh before the extension can read playback signals."
    };
  }

  return {
    ...createPrimeWaitingState(url),
    feedbackDetail:
      "Prime is active, but the player signals are not readable yet. Refreshing the tab once should fix that."
  };
}

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== MESSAGE_GET_POPUP_SNAPSHOT) return undefined;

    void (async () => {
      try {
        const activeTab = await getActiveTab();
        const url = activeTab?.url || "";
        const title = activeTab?.title || "";

        if (!activeTab?.id) {
          sendResponse(createPopupSnapshot(createUnsupportedSiteState(url), title));
          return;
        }

        const activeSite = await readPrimeState(activeTab.id, url);
        sendResponse(createPopupSnapshot(activeSite, title));
      } catch (_) {
        sendResponse(createPopupSnapshot(createUnsupportedSiteState(""), ""));
      }
    })();

    return true;
  });
});
