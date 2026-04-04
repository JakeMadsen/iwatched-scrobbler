import { browser } from "wxt/browser";

import type { ReviewTargetType, TargetInput } from "@iwatched-scrobbler/api-client";

import type { SiteDetectionState, SiteKey } from "../types/popup-state";
import { buildApiTarget } from "./client";

const REVIEW_QUEUE_STORAGE_KEY = "iwatched-scrobbler/review-queue";
const MAX_REVIEW_QUEUE_ITEMS = 8;

export interface ReviewQueueItem {
  id: string;
  itemType: ReviewTargetType;
  tmdbId: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  title: string;
  subtitle: string | null;
  siteKey: SiteKey;
  siteLabel: string;
  iwatchedUrl: string | null;
  watchedAt: string;
  createdAt: number;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNullableString(value: unknown): string | null {
  const next = normalizeString(value);
  return next || null;
}

function normalizeNullableNumber(value: unknown): number | null {
  if (value === null || typeof value === "undefined" || value === "") return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function normalizeItemType(value: unknown): ReviewTargetType | null {
  const next = normalizeString(value).toLowerCase();
  if (next === "movie" || next === "show" || next === "season" || next === "episode") {
    return next;
  }

  return null;
}

function buildQueueItemId(input: {
  itemType: ReviewTargetType;
  tmdbId: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
}): string {
  return JSON.stringify([
    input.itemType,
    input.tmdbId,
    input.seasonNumber ?? null,
    input.episodeNumber ?? null
  ]);
}

function buildQueueTitle(site: SiteDetectionState): string | null {
  if (site.mediaType === "show") {
    return site.seriesTitle || site.detectedTitle;
  }

  return site.detectedTitle;
}

function buildQueueSubtitle(site: SiteDetectionState, itemType: ReviewTargetType): string | null {
  if (itemType === "episode") {
    return site.detectedEpisode || site.episodeTitle || "Episode";
  }

  if (itemType === "movie") {
    return "Movie";
  }

  if (itemType === "season" && site.seasonNumber != null) {
    return `Season ${site.seasonNumber}`;
  }

  return null;
}

function parseQueueItem(value: unknown): ReviewQueueItem | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Record<string, unknown>;
  const itemType = normalizeItemType(candidate.itemType);
  const tmdbId = normalizeString(candidate.tmdbId);
  if (!itemType || !tmdbId) return null;

  const seasonNumber = normalizeNullableNumber(candidate.seasonNumber);
  const episodeNumber = normalizeNullableNumber(candidate.episodeNumber);
  const watchedAt = normalizeString(candidate.watchedAt);
  const createdAt = normalizeNullableNumber(candidate.createdAt) ?? Date.now();
  const title = normalizeString(candidate.title);
  if (!title) return null;

  return {
    id:
      normalizeString(candidate.id) ||
      buildQueueItemId({
        itemType,
        tmdbId,
        seasonNumber,
        episodeNumber
      }),
    itemType,
    tmdbId,
    seasonNumber,
    episodeNumber,
    title,
    subtitle: normalizeNullableString(candidate.subtitle),
    siteKey: (candidate.siteKey === "prime" || candidate.siteKey === "plex")
      ? candidate.siteKey
      : "unsupported",
    siteLabel: normalizeString(candidate.siteLabel) || "Supported service",
    iwatchedUrl: normalizeNullableString(candidate.iwatchedUrl),
    watchedAt,
    createdAt
  };
}

function toStoredQueue(items: ReviewQueueItem[]): { [REVIEW_QUEUE_STORAGE_KEY]: ReviewQueueItem[] } {
  return {
    [REVIEW_QUEUE_STORAGE_KEY]: items
  };
}

export function buildReviewQueueTarget(item: ReviewQueueItem): TargetInput {
  return {
    itemType: item.itemType,
    tmdbId: item.tmdbId,
    seasonNumber: item.seasonNumber,
    episodeNumber: item.episodeNumber
  };
}

export async function getReviewQueue(): Promise<ReviewQueueItem[]> {
  const stored = await browser.storage.local.get(REVIEW_QUEUE_STORAGE_KEY);
  const raw = stored[REVIEW_QUEUE_STORAGE_KEY];
  if (!Array.isArray(raw)) return [];

  return raw
    .map(parseQueueItem)
    .filter((item): item is ReviewQueueItem => !!item)
    .sort((left, right) => right.createdAt - left.createdAt);
}

export async function dismissReviewQueueItem(id: string): Promise<void> {
  const queue = await getReviewQueue();
  const next = queue.filter((item) => item.id !== id);
  await browser.storage.local.set(toStoredQueue(next));
}

export function createReviewQueueItem(
  site: SiteDetectionState,
  watchedAt: string
): ReviewQueueItem | null {
  const target = buildApiTarget(site);
  if (!target || (target.itemType !== "movie" && target.itemType !== "episode")) {
    return null;
  }

  const title = buildQueueTitle(site);
  if (!title) return null;

  return {
    id: buildQueueItemId({
      itemType: target.itemType,
      tmdbId: target.tmdbId,
      seasonNumber: target.seasonNumber ?? null,
      episodeNumber: target.episodeNumber ?? null
    }),
    itemType: target.itemType,
    tmdbId: target.tmdbId,
    seasonNumber: target.seasonNumber ?? null,
    episodeNumber: target.episodeNumber ?? null,
    title,
    subtitle: buildQueueSubtitle(site, target.itemType),
    siteKey: site.siteKey,
    siteLabel: site.siteLabel,
    iwatchedUrl: site.iwatchedUrl,
    watchedAt,
    createdAt: Date.now()
  };
}

export async function enqueueReviewQueueItem(item: ReviewQueueItem): Promise<void> {
  const queue = await getReviewQueue();
  const next = [item, ...queue.filter((entry) => entry.id !== item.id)].slice(0, MAX_REVIEW_QUEUE_ITEMS);
  await browser.storage.local.set(toStoredQueue(next));
}

export async function enqueueReviewFromSite(
  site: SiteDetectionState,
  watchedAt: string
): Promise<ReviewQueueItem | null> {
  const item = createReviewQueueItem(site, watchedAt);
  if (!item) return null;

  await enqueueReviewQueueItem(item);
  return item;
}
