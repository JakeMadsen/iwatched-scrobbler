import type { DetectedMediaType, SiteDetectionState } from "../types/popup-state";

const PLEX_HOSTNAMES = new Set(["app.plex.tv", "watch.plex.tv"]);
const WATCH_COMPLETION_PERCENT = 90;
const WATCH_REMAINING_SECONDS = 10 * 60;

interface StructuredPlexMetadata {
  mediaType: DetectedMediaType;
  movieTitle: string | null;
  seriesTitle: string | null;
  episodeTitle: string | null;
  releaseYear: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
}

interface ParsedPlexDescriptor {
  seriesTitle: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
}

interface PathSignals {
  mediaType: DetectedMediaType;
  seasonNumber: number | null;
  episodeNumber: number | null;
}

function parseUrl(rawUrl?: string | null): URL | null {
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl);
  } catch (_) {
    return null;
  }
}

function isIpv4Hostname(hostname: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
}

export function isPlexUrl(rawUrl?: string | null): boolean {
  const url = parseUrl(rawUrl);
  if (!url) return false;

  if (PLEX_HOSTNAMES.has(url.hostname)) return true;

  const localHosts = new Set(["localhost", "127.0.0.1"]);
  if (localHosts.has(url.hostname)) return url.pathname.startsWith("/web");
  if (url.hostname.endsWith(".plex.direct")) return url.pathname.startsWith("/web");
  if (isIpv4Hostname(url.hostname) && url.port === "32400") {
    return url.pathname.startsWith("/web");
  }

  return false;
}

function normalizeText(value?: string | null): string | null {
  const next = String(value || "").replace(/\s+/g, " ").trim();
  return next ? next : null;
}

function cleanPlexText(value?: string | null): string | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;

  const cleaned = normalized
    .replace(/\s*\|\s*Plex\s*$/i, "")
    .replace(/\s*-\s*Plex\s*$/i, "")
    .replace(/^where to watch\s+/i, "")
    .replace(/\s+online$/i, "")
    .trim();

  if (!cleaned || /^plex$/i.test(cleaned)) return null;
  return cleaned;
}

function readMeta(doc: Document, selector: string): string | null {
  const element = doc.querySelector(selector);
  if (!(element instanceof HTMLMetaElement)) return null;
  return cleanPlexText(element.content);
}

function firstText(doc: Document, selectors: string[]): string | null {
  for (const selector of selectors) {
    const element = doc.querySelector(selector);
    const text = cleanPlexText(element?.textContent || "");
    if (text) return text;
  }
  return null;
}

function parseInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }

  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseYearValue(...values: unknown[]): number | null {
  for (const value of values) {
    const text = normalizeText(String(value || ""));
    if (!text) continue;

    const match = text.match(/\b(19|20)\d{2}\b/);
    if (!match) continue;

    const parsed = Number(match[0]);
    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
}

function walkJson(value: unknown, visit: (node: Record<string, unknown>) => void) {
  if (!value) return;

  if (Array.isArray(value)) {
    for (const entry of value) walkJson(entry, visit);
    return;
  }

  if (typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  visit(record);

  if (Array.isArray(record["@graph"])) {
    walkJson(record["@graph"], visit);
  }

  for (const entry of Object.values(record)) {
    if (entry && typeof entry === "object") {
      walkJson(entry, visit);
    }
  }
}

function extractStructuredPlexMetadata(doc: Document): StructuredPlexMetadata {
  const scripts = Array.from(
    doc.querySelectorAll("script[type='application/ld+json']")
  ).filter((node): node is HTMLScriptElement => node instanceof HTMLScriptElement);

  for (const script of scripts) {
    try {
      const payload = JSON.parse(script.textContent || "null") as unknown;
      let match: StructuredPlexMetadata | null = null;

      walkJson(payload, (node) => {
        if (match) return;

        const type = normalizeText(String(node["@type"] || ""))?.toLowerCase();
        if (!type) return;

        if (type === "tvepisode") {
          const partOfSeries =
            node.partOfSeries && typeof node.partOfSeries === "object"
              ? (node.partOfSeries as Record<string, unknown>)
              : null;
          const partOfSeason =
            node.partOfSeason && typeof node.partOfSeason === "object"
              ? (node.partOfSeason as Record<string, unknown>)
              : null;

          match = {
            mediaType: "show",
            movieTitle: null,
            seriesTitle: cleanPlexText(String(partOfSeries?.name || "")),
            episodeTitle: cleanPlexText(String(node.name || "")),
            releaseYear: parseYearValue(
              node.datePublished,
              node.dateCreated,
              node.startDate,
              partOfSeries && (partOfSeries.datePublished || partOfSeries.startDate)
            ),
            seasonNumber: parseInteger(partOfSeason?.seasonNumber),
            episodeNumber: parseInteger(node.episodeNumber)
          };
          return;
        }

        if (type === "movie") {
          match = {
            mediaType: "movie",
            movieTitle: cleanPlexText(String(node.name || "")),
            seriesTitle: null,
            episodeTitle: null,
            releaseYear: parseYearValue(node.datePublished, node.dateCreated, node.startDate),
            seasonNumber: null,
            episodeNumber: null
          };
          return;
        }

        if (type === "tvseries") {
          match = {
            mediaType: "show",
            movieTitle: null,
            seriesTitle: cleanPlexText(String(node.name || "")),
            episodeTitle: null,
            releaseYear: parseYearValue(node.datePublished, node.dateCreated, node.startDate),
            seasonNumber: null,
            episodeNumber: null
          };
        }
      });

      if (match) return match;
    } catch (_) {
      continue;
    }
  }

  return {
    mediaType: "unknown",
    movieTitle: null,
    seriesTitle: null,
    episodeTitle: null,
    releaseYear: null,
    seasonNumber: null,
    episodeNumber: null
  };
}

function readPlexOgType(doc: Document): DetectedMediaType {
  const value =
    readMeta(doc, "meta[property='og:type']") ||
    readMeta(doc, "meta[name='twitter:card']");

  if (!value) return "unknown";

  const normalized = value.toLowerCase();
  if (normalized === "video.movie") return "movie";
  if (normalized === "video.episode" || normalized === "video.tv_show") return "show";
  return "unknown";
}

function parsePlexDescriptor(value?: string | null): ParsedPlexDescriptor {
  const cleaned = cleanPlexText(value);
  if (!cleaned) {
    return {
      seriesTitle: null,
      seasonNumber: null,
      episodeNumber: null,
      episodeTitle: null
    };
  }

  const shortEpisode = /^(.*?)\s*-\s*S(\d+)\s*[•.\-]\s*E(\d+)(?:\s*-\s*(.+))?$/i.exec(cleaned);
  if (shortEpisode) {
    return {
      seriesTitle: cleanPlexText(shortEpisode[1]),
      seasonNumber: parseInteger(shortEpisode[2]),
      episodeNumber: parseInteger(shortEpisode[3]),
      episodeTitle: cleanPlexText(shortEpisode[4] || "")
    };
  }

  const longEpisode =
    /^(.*?)\s*-\s*Season\s*(\d+)\s*[•-]\s*Episode\s*(\d+)(?:\s*-\s*(.+))?$/i.exec(cleaned);
  if (longEpisode) {
    return {
      seriesTitle: cleanPlexText(longEpisode[1]),
      seasonNumber: parseInteger(longEpisode[2]),
      episodeNumber: parseInteger(longEpisode[3]),
      episodeTitle: cleanPlexText(longEpisode[4] || "")
    };
  }

  const seasonOnly = /^(.*?)\s*[•-]\s*Season\s*(\d+)$/i.exec(cleaned);
  if (seasonOnly) {
    return {
      seriesTitle: cleanPlexText(seasonOnly[1]),
      seasonNumber: parseInteger(seasonOnly[2]),
      episodeNumber: null,
      episodeTitle: null
    };
  }

  return {
    seriesTitle: null,
    seasonNumber: null,
    episodeNumber: null,
    episodeTitle: null
  };
}

function readPathSignals(url: URL | null): PathSignals {
  if (!url || url.hostname !== "watch.plex.tv") {
    return {
      mediaType: "unknown",
      seasonNumber: null,
      episodeNumber: null
    };
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (!segments.length) {
    return {
      mediaType: "unknown",
      seasonNumber: null,
      episodeNumber: null
    };
  }

  if (segments[0] === "movie") {
    return {
      mediaType: "movie",
      seasonNumber: null,
      episodeNumber: null
    };
  }

  if (segments[0] === "show") {
    const seasonIndex = segments.indexOf("season");
    const episodeIndex = segments.indexOf("episode");

    return {
      mediaType: "show",
      seasonNumber:
        seasonIndex >= 0 && segments[seasonIndex + 1]
          ? parseInteger(segments[seasonIndex + 1])
          : null,
      episodeNumber:
        episodeIndex >= 0 && segments[episodeIndex + 1]
          ? parseInteger(segments[episodeIndex + 1])
          : null
    };
  }

  return {
    mediaType: "unknown",
    seasonNumber: null,
    episodeNumber: null
  };
}

function isVisibleElement(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;

  const rect = element.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  if (rect.bottom <= 0 || rect.right <= 0) return false;
  if (rect.top >= window.innerHeight || rect.left >= window.innerWidth) return false;

  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (Number.parseFloat(style.opacity || "1") === 0) return false;

  return true;
}

function scoreVideo(video: HTMLVideoElement): number {
  const rect = video.getBoundingClientRect();
  const area = Math.max(0, rect.width) * Math.max(0, rect.height);
  const visibleBonus = isVisibleElement(video) ? 1_000_000 : 0;
  const activeBonus = !video.paused && !video.ended ? 250_000 : 0;
  const progressedBonus = video.currentTime > 0 ? 150_000 : 0;
  const readyBonus = video.readyState >= 2 ? 75_000 : 0;
  const srcBonus = video.currentSrc ? 40_000 : 0;
  const longFormBonus =
    Number.isFinite(video.duration) && video.duration >= 300 ? 60_000 : 0;

  return visibleBonus + activeBonus + progressedBonus + readyBonus + srcBonus + longFormBonus + area;
}

function selectPlexVideo(doc: Document): HTMLVideoElement | null {
  const videos = Array.from(doc.querySelectorAll("video")).filter(
    (node): node is HTMLVideoElement => node instanceof HTMLVideoElement
  );
  if (!videos.length) return null;

  return videos.sort((left, right) => scoreVideo(right) - scoreVideo(left))[0] || null;
}

function clampTime(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

function roundProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function buildDetectedEpisodeLabel(
  seasonNumber: number | null,
  episodeNumber: number | null,
  episodeTitle: string | null
): string | null {
  const parts: string[] = [];
  if (seasonNumber != null) parts.push(`S${seasonNumber}`);
  if (episodeNumber != null) parts.push(`E${episodeNumber}`);
  if (episodeTitle) parts.push(episodeTitle);
  return parts.length ? parts.join(" · ") : null;
}

function findPlexReleaseYear(doc: Document): number | null {
  return parseYearValue(
    readMeta(doc, "meta[property='video:release_date']"),
    readMeta(doc, "meta[property='og:video:release_date']"),
    readMeta(doc, "meta[name='release_date']"),
    readMeta(doc, "meta[itemprop='datePublished']"),
    doc.title
  );
}

function createBaseState(
  rawUrl?: string | null
): Omit<
  SiteDetectionState,
  | "feedbackTitle"
  | "feedbackDetail"
  | "updatedAt"
  | "supported"
  | "siteKey"
  | "siteLabel"
> {
  const url = parseUrl(rawUrl);

  return {
    host: url?.hostname || "unknown",
    url: rawUrl || "",
    videoPresent: false,
    isPlaying: false,
    playbackSource: "none",
    mediaType: "unknown",
    detectedTitle: null,
    detectedEpisode: null,
    seriesTitle: null,
    episodeTitle: null,
    releaseYear: null,
    seasonNumber: null,
    episodeNumber: null,
    progressPercent: null,
    playbackPositionSeconds: null,
    durationSeconds: null,
    remainingSeconds: null,
    watchThresholdMet: false,
    watchThresholdReason: null,
    iwatchedUrl: null,
    iwatchedMatchType: "none",
    iwatchedTmdbId: null,
    iwatchedTargetType: null
  };
}

export function createPlexWaitingState(rawUrl?: string | null): SiteDetectionState {
  return {
    ...createBaseState(rawUrl),
    siteKey: "plex",
    siteLabel: "Plex",
    supported: true,
    host: parseUrl(rawUrl)?.hostname || "app.plex.tv",
    feedbackTitle: "Plex ready",
    feedbackDetail: "Open a Plex title page or start playback and the extension will begin surfacing a scrobble candidate.",
    updatedAt: Date.now()
  };
}

export function detectPlexState(doc: Document, rawUrl: string): SiteDetectionState {
  if (!isPlexUrl(rawUrl)) {
    return {
      ...createBaseState(rawUrl),
      siteKey: "unsupported",
      siteLabel: parseUrl(rawUrl)?.hostname || "Unsupported site",
      supported: false,
      feedbackTitle: "Plex not active",
      feedbackDetail: "Open Plex in this browser tab to start building a scrobble candidate.",
      updatedAt: Date.now()
    };
  }

  const url = parseUrl(rawUrl);
  const video = selectPlexVideo(doc);
  const structured = extractStructuredPlexMetadata(doc);
  const metaTitle =
    readMeta(doc, "meta[property='og:title']") ||
    readMeta(doc, "meta[name='twitter:title']");
  const metaSeries = readMeta(doc, "meta[property='video:series']");
  const domTitle = firstText(doc, ["h1", "[data-testid='metadata-title']"]) || cleanPlexText(doc.title);
  const parsedMetaTitle = parsePlexDescriptor(metaTitle);
  const parsedDomTitle = parsePlexDescriptor(domTitle);
  const pathSignals = readPathSignals(url);
  const metaMediaType = readPlexOgType(doc);
  const titleCandidate =
    structured.movieTitle ||
    structured.seriesTitle ||
    metaSeries ||
    metaTitle ||
    domTitle;
  const mediaType = structured.mediaType !== "unknown"
    ? structured.mediaType
    : metaMediaType !== "unknown"
      ? metaMediaType
      : pathSignals.mediaType !== "unknown"
        ? pathSignals.mediaType
        : (parsedMetaTitle.episodeNumber != null ||
          parsedMetaTitle.seasonNumber != null ||
          parsedDomTitle.episodeNumber != null ||
          parsedDomTitle.seasonNumber != null ||
          !!metaSeries)
          ? "show"
          : titleCandidate
            ? "movie"
            : "unknown";

  const seriesTitle =
    structured.seriesTitle ||
    metaSeries ||
    parsedMetaTitle.seriesTitle ||
    parsedDomTitle.seriesTitle ||
    (mediaType === "show" ? metaTitle || domTitle : null);
  const episodeTitle =
    structured.episodeTitle ||
    parsedMetaTitle.episodeTitle ||
    parsedDomTitle.episodeTitle;
  const releaseYear =
    structured.releaseYear ??
    findPlexReleaseYear(doc);
  const seasonNumber =
    structured.seasonNumber ??
    parsedMetaTitle.seasonNumber ??
    parsedDomTitle.seasonNumber ??
    pathSignals.seasonNumber;
  const episodeNumber =
    structured.episodeNumber ??
    parsedMetaTitle.episodeNumber ??
    parsedDomTitle.episodeNumber ??
    pathSignals.episodeNumber;
  const detectedTitle =
    mediaType === "show"
      ? (seriesTitle || metaTitle || domTitle)
      : (structured.movieTitle || metaTitle || domTitle);
  const detectedEpisode =
    mediaType === "show"
      ? buildDetectedEpisodeLabel(seasonNumber, episodeNumber, episodeTitle)
      : null;

  const playbackPositionSeconds = video ? clampTime(video.currentTime) : null;
  const durationSeconds = video ? clampTime(video.duration) : null;
  const remainingSeconds =
    playbackPositionSeconds != null && durationSeconds != null
      ? Math.max(0, durationSeconds - playbackPositionSeconds)
      : null;
  const progressPercent =
    playbackPositionSeconds != null && durationSeconds != null && durationSeconds > 0
      ? roundProgress((playbackPositionSeconds / durationSeconds) * 100)
      : null;
  const isPlaying = !!(video && !video.paused && !video.ended);
  const watchThresholdMet = !!(
    durationSeconds != null &&
    playbackPositionSeconds != null &&
    (
      (progressPercent != null && progressPercent >= WATCH_COMPLETION_PERCENT) ||
      (remainingSeconds != null && remainingSeconds <= WATCH_REMAINING_SECONDS)
    )
  );
  const watchThresholdReason =
    durationSeconds == null || playbackPositionSeconds == null
      ? null
      : progressPercent != null && progressPercent >= WATCH_COMPLETION_PERCENT
        ? "90% of runtime reached"
        : remainingSeconds != null && remainingSeconds <= WATCH_REMAINING_SECONDS
          ? "10 minutes or less remaining"
          : null;

  let feedbackTitle = "Plex ready";
  let feedbackDetail =
    "Open a title page or start playback and the extension will turn the current Plex state into a scrobble candidate.";

  if (detectedTitle && watchThresholdMet) {
    feedbackTitle = "Ready to add to timeline";
    feedbackDetail = watchThresholdReason
      ? `Detected ${detectedTitle}. Local watch rule met: ${watchThresholdReason.toLowerCase()}.`
      : `Detected ${detectedTitle}. Local watch rule met.`;
  } else if (detectedTitle && video && isPlaying) {
    feedbackTitle = "Playback active";
    feedbackDetail = `Detected ${detectedTitle} in active Plex playback.`;
  } else if (detectedTitle && video) {
    feedbackTitle = "Player ready";
    feedbackDetail = `Detected ${detectedTitle}. Start the player to see live watch progress.`;
  } else if (detectedTitle) {
    feedbackTitle = "Title detected";
    feedbackDetail = `Found ${detectedTitle}. Start playback to preview a scrobble candidate.`;
  }

  return {
    siteKey: "plex",
    siteLabel: "Plex",
    host: url?.hostname || "app.plex.tv",
    url: rawUrl,
    supported: true,
    videoPresent: !!video,
    isPlaying,
    playbackSource: video ? "video" : "none",
    mediaType,
    detectedTitle,
    detectedEpisode,
    seriesTitle,
    episodeTitle,
    releaseYear,
    seasonNumber,
    episodeNumber,
    progressPercent,
    playbackPositionSeconds,
    durationSeconds,
    remainingSeconds,
    watchThresholdMet,
    watchThresholdReason,
    iwatchedUrl: null,
    iwatchedMatchType: "none",
    iwatchedTmdbId: null,
    iwatchedTargetType: null,
    feedbackTitle,
    feedbackDetail,
    updatedAt: Date.now()
  };
}
