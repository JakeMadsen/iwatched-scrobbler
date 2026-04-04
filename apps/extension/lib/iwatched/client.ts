import {
  createIWatchedApiClient,
  DEFAULT_IWATCHED_BASE_URL,
  type ScrobbleInput,
  type TargetInput
} from "@iwatched-scrobbler/api-client";

import type { SiteDetectionState } from "../types/popup-state";
import { ensureValidAccessToken } from "./auth";

interface BuildScrobbleInputOptions {
  watchedAt?: string;
  playbackSessionKey?: string | null;
}

export const IWATCHED_BASE_URL = DEFAULT_IWATCHED_BASE_URL;
export const iwatchedApi = createIWatchedApiClient({
  baseUrl: IWATCHED_BASE_URL,
  defaultCredentials: "omit",
  getAccessToken: () => ensureValidAccessToken(false)
});

export function buildApiTarget(site: SiteDetectionState): TargetInput | null {
  if (!site.iwatchedTmdbId || !site.iwatchedTargetType) return null;

  return {
    itemType: site.iwatchedTargetType,
    tmdbId: site.iwatchedTmdbId,
    seasonNumber: site.seasonNumber,
    episodeNumber: site.episodeNumber
  };
}

export function buildScrobbleInput(
  site: SiteDetectionState,
  options: BuildScrobbleInputOptions = {}
): ScrobbleInput | null {
  const target = buildApiTarget(site);
  if (!target) return null;

  const watchedAt = options.watchedAt || new Date().toISOString();
  const playbackSessionKey = options.playbackSessionKey || watchedAt;
  const eventBits = [
    site.siteKey,
    target.tmdbId,
    target.itemType,
    target.seasonNumber ?? "",
    target.episodeNumber ?? "",
    playbackSessionKey
  ];

  return {
    ...target,
    watchedAt,
    source: "browser_extension",
    platform: site.siteKey,
    externalEventId: eventBits.join(":"),
    idempotencyKey: eventBits.join("-"),
    clientName: "iwatched-scrobbler-extension",
    clientVersion: "0.1.0",
    showTitle: site.seriesTitle || site.detectedTitle || undefined,
    seriesTitle: site.seriesTitle || undefined,
    episodeTitle: site.episodeTitle || undefined,
    contentTitle: site.detectedEpisode || site.detectedTitle || undefined
  };
}
