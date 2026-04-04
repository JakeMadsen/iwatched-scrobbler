import type { SiteDetectionState } from "../types/popup-state";

const PRIME_HOSTNAMES = new Set(["www.primevideo.com", "primevideo.com"]);
const TIMECODE_PATTERN = /^(-)?(\d{1,2}:\d{2}(?::\d{2})?)$/;
const WATCH_COMPLETION_PERCENT = 90;
const WATCH_REMAINING_SECONDS = 10 * 60;

interface RuntimeToken {
  rect: DOMRect;
  seconds: number;
  isRemaining: boolean;
}

interface StructuredPrimeMetadata {
  mediaType: "movie" | "show" | "unknown";
  movieTitle: string | null;
  seriesTitle: string | null;
  episodeTitle: string | null;
  releaseYear: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
}

interface ParsedEpisodeDescriptor {
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
}

interface PageLevelSeriesSignals {
  seriesTitle: string | null;
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

export function isPrimeUrl(rawUrl?: string | null): boolean {
  const url = parseUrl(rawUrl);
  if (!url) return false;

  if (PRIME_HOSTNAMES.has(url.hostname)) return true;
  if (url.hostname === "www.amazon.com" && url.pathname.startsWith("/gp/video")) return true;
  return false;
}

function hostLabel(rawUrl?: string | null): string {
  const url = parseUrl(rawUrl);
  if (!url) return "Unsupported site";
  if (isPrimeUrl(rawUrl)) return "Prime Video";
  return url.hostname.replace(/^www\./, "");
}

function normalizeText(value?: string | null): string | null {
  const next = String(value || "").replace(/\s+/g, " ").trim();
  return next ? next : null;
}

function cleanPrimeTitle(value?: string | null): string | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;

  return normalized
    .replace(/\s*\|\s*Prime Video\s*$/i, "")
    .replace(/\s*-\s*Prime Video\s*$/i, "")
    .replace(/^prime video:\s*/i, "")
    .replace(/^\s*watch\s+/i, "")
    .trim();
}

function firstText(doc: Document, selectors: string[]): string | null {
  for (const selector of selectors) {
    const element = doc.querySelector(selector);
    const text = cleanPrimeTitle(element?.textContent || "");
    if (text) return text;
  }
  return null;
}

function readMeta(doc: Document, selector: string): string | null {
  const element = doc.querySelector(selector);
  if (!(element instanceof HTMLMetaElement)) return null;
  return cleanPrimeTitle(element.content);
}

function readMetaContent(doc: Document, selector: string): string | null {
  const element = doc.querySelector(selector);
  if (!(element instanceof HTMLMetaElement)) return null;
  return normalizeText(element.content);
}

function readDocumentTitle(value: string): string | null {
  return cleanPrimeTitle(value);
}

function findPrimeTitle(doc: Document): string | null {
  return (
    firstText(doc, [
      "[data-automation-id='title']",
      "[data-testid='title']",
      "h1",
      ".atvwebplayersdk-title-text"
    ]) ||
    readMeta(doc, "meta[property='og:title']") ||
    readMeta(doc, "meta[name='twitter:title']") ||
    readDocumentTitle(doc.title)
  );
}

function findPrimeSubtitle(doc: Document): string | null {
  const subtitle = normalizeText(
    firstText(doc, [
      "[data-automation-id='subtitle']",
      "[data-testid='subtitle']",
      ".atvwebplayersdk-subtitle-text"
    ])
  );

  if (!subtitle) return null;
  if (/customers also watched/i.test(subtitle)) return null;
  return subtitle;
}

function findPrimeDescription(doc: Document): string | null {
  return (
    readMetaContent(doc, "meta[property='og:description']") ||
    readMetaContent(doc, "meta[name='description']") ||
    readMetaContent(doc, "meta[name='twitter:description']")
  );
}

function roundProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function clampTime(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
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
  const shortPenalty =
    Number.isFinite(video.duration) && video.duration > 0 && video.duration < 180
      ? -50_000
      : 0;

  return (
    visibleBonus +
    activeBonus +
    progressedBonus +
    readyBonus +
    srcBonus +
    longFormBonus +
    shortPenalty +
    area
  );
}

function selectPrimeVideo(doc: Document): HTMLVideoElement | null {
  const videos = Array.from(doc.querySelectorAll("video")).filter(
    (node): node is HTMLVideoElement => node instanceof HTMLVideoElement
  );
  if (!videos.length) return null;

  return videos.sort((left, right) => scoreVideo(right) - scoreVideo(left))[0] || null;
}

function parseRuntimeText(value: string): RuntimeToken | null {
  const text = normalizeText(value);
  if (!text) return null;

  const match = TIMECODE_PATTERN.exec(text);
  if (!match) return null;

  const rawTime = match[2];
  const segments = rawTime.split(":").map((segment) => Number.parseInt(segment, 10));
  if (segments.some((segment) => Number.isNaN(segment))) return null;

  let seconds = 0;
  if (segments.length === 3) {
    seconds = segments[0] * 3600 + segments[1] * 60 + segments[2];
  } else {
    seconds = segments[0] * 60 + segments[1];
  }

  return {
    rect: new DOMRect(),
    seconds,
    isRemaining: !!match[1]
  };
}

function findOverlayRuntime(
  doc: Document,
  video: HTMLVideoElement | null
): { elapsed: number | null; duration: number | null } {
  const videoRect = video?.getBoundingClientRect();
  const tokens: RuntimeToken[] = [];
  const elements = doc.querySelectorAll("span, div, p, time");

  for (const element of elements) {
    if (!(element instanceof HTMLElement)) continue;
    if (element.children.length > 0) continue;
    if (!isVisibleElement(element)) continue;

    const token = parseRuntimeText(element.textContent || "");
    if (!token) continue;

    const rect = element.getBoundingClientRect();
    if (videoRect) {
      const withinHorizontal =
        rect.left >= videoRect.left - 32 && rect.right <= videoRect.right + 32;
      const nearBottom =
        rect.top >= videoRect.bottom - Math.max(160, videoRect.height * 0.35) &&
        rect.bottom <= videoRect.bottom + 32;

      if (!withinHorizontal || !nearBottom) continue;
    }

    tokens.push({
      rect,
      seconds: token.seconds,
      isRemaining: token.isRemaining
    });
  }

  if (tokens.length < 2) return { elapsed: null, duration: null };

  const lowestRowTop = Math.max(...tokens.map((token) => token.rect.top));
  const rowTokens = tokens
    .filter((token) => Math.abs(token.rect.top - lowestRowTop) <= 28)
    .sort((left, right) => left.rect.left - right.rect.left);

  if (rowTokens.length < 2) return { elapsed: null, duration: null };

  const leftToken = rowTokens[0];
  const rightToken = rowTokens[rowTokens.length - 1];
  const elapsed = leftToken.isRemaining ? null : leftToken.seconds;

  if (elapsed == null) return { elapsed: null, duration: null };

  const duration = rightToken.isRemaining
    ? elapsed + rightToken.seconds
    : Math.max(elapsed, rightToken.seconds);

  return {
    elapsed,
    duration
  };
}

function flattenJsonLd(value: unknown, acc: Array<Record<string, unknown>>): void {
  if (!value) return;

  if (Array.isArray(value)) {
    value.forEach((entry) => flattenJsonLd(entry, acc));
    return;
  }

  if (typeof value !== "object") return;

  const node = value as Record<string, unknown>;
  acc.push(node);

  if (Array.isArray(node["@graph"])) {
    flattenJsonLd(node["@graph"], acc);
  }
}

function getJsonLdNodes(doc: Document): Array<Record<string, unknown>> {
  const nodes: Array<Record<string, unknown>> = [];

  doc.querySelectorAll("script[type='application/ld+json']").forEach((script) => {
    const text = script.textContent || "";
    if (!text.trim()) return;

    try {
      const parsed = JSON.parse(text);
      flattenJsonLd(parsed, nodes);
    } catch (_) {
      // Ignore malformed structured data.
    }
  });

  return nodes;
}

function getJsonLdTypes(node: Record<string, unknown>): string[] {
  const raw = node["@type"];
  if (Array.isArray(raw)) {
    return raw.map((entry) => String(entry).toLowerCase());
  }

  if (raw) {
    return [String(raw).toLowerCase()];
  }

  return [];
}

function parseNumberish(...values: unknown[]): number | null {
  for (const value of values) {
    if (value == null || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
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

function extractStructuredPrimeMetadata(doc: Document): StructuredPrimeMetadata {
  const nodes = getJsonLdNodes(doc);

  for (const node of nodes) {
    const types = getJsonLdTypes(node);
    if (!types.includes("tvepisode")) continue;

    const partOfSeries =
      (node.partOfSeries as Record<string, unknown> | undefined) ||
      (node.partOfTVSeries as Record<string, unknown> | undefined) ||
      (node.isPartOf as Record<string, unknown> | undefined);
    const partOfSeason =
      (node.partOfSeason as Record<string, unknown> | undefined) ||
      (node.partOfTVSeason as Record<string, unknown> | undefined);

    return {
      mediaType: "show",
      movieTitle: null,
      seriesTitle: cleanPrimeTitle(String(partOfSeries?.name || "")),
      episodeTitle: cleanPrimeTitle(String(node.name || "")),
      releaseYear: parseYearValue(
        node.datePublished,
        node.dateCreated,
        node.startDate,
        partOfSeries && (partOfSeries.datePublished || partOfSeries.startDate)
      ),
      seasonNumber: parseNumberish(
        partOfSeason?.seasonNumber,
        partOfSeason?.position,
        node.seasonNumber
      ),
      episodeNumber: parseNumberish(node.episodeNumber, node.position)
    };
  }

  for (const node of nodes) {
    const types = getJsonLdTypes(node);
    if (!types.includes("movie")) continue;

    return {
      mediaType: "movie",
      movieTitle: cleanPrimeTitle(String(node.name || "")),
      seriesTitle: null,
      episodeTitle: null,
      releaseYear: parseYearValue(node.datePublished, node.dateCreated, node.startDate),
      seasonNumber: null,
      episodeNumber: null
    };
  }

  for (const node of nodes) {
    const types = getJsonLdTypes(node);
    if (!(types.includes("tvseries") || types.includes("creativeworkseries"))) continue;

    return {
      mediaType: "show",
      movieTitle: null,
      seriesTitle: cleanPrimeTitle(String(node.name || "")),
      episodeTitle: null,
      releaseYear: parseYearValue(node.datePublished, node.dateCreated, node.startDate),
      seasonNumber: null,
      episodeNumber: null
    };
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

function extractMetaMediaType(doc: Document): "movie" | "show" | "unknown" {
  const content = (
    readMetaContent(doc, "meta[property='og:type']") ||
    readMetaContent(doc, "meta[name='twitter:card']")
  )?.toLowerCase();

  if (!content) return "unknown";
  if (content.includes("episode") || content.includes("series") || content.includes("tv")) {
    return "show";
  }
  if (content.includes("movie")) return "movie";
  return "unknown";
}

function parseEpisodeDescriptor(value?: string | null): ParsedEpisodeDescriptor {
  const text = normalizeText(value);
  if (!text) {
    return {
      seasonNumber: null,
      episodeNumber: null,
      episodeTitle: null
    };
  }

  const matchers = [
    /\bS(?:eason)?\s*(\d{1,2})\s*E(?:pisode)?\s*(\d{1,3})\b[:\s.-]*(.*)$/i,
    /\bSeason\s*(\d{1,2})\b.*?\bEpisode\s*(\d{1,3})\b[:\s.-]*(.*)$/i,
    /\b(\d{1,2})x(\d{1,3})\b[:\s.-]*(.*)$/i
  ];

  for (const pattern of matchers) {
    const match = text.match(pattern);
    if (!match) continue;

    const seasonNumber = parseNumberish(match[1]);
    const episodeNumber = parseNumberish(match[2]);
    const remainder = cleanPrimeTitle(match[3] || "");

    return {
      seasonNumber,
      episodeNumber,
      episodeTitle: remainder || null
    };
  }

  const episodeOnly = text.match(/\bEpisode\s*(\d{1,3})\b[:\s.-]*(.*)$/i);
  if (episodeOnly) {
    return {
      seasonNumber: null,
      episodeNumber: parseNumberish(episodeOnly[1]),
      episodeTitle: cleanPrimeTitle(episodeOnly[2] || "")
    };
  }

  const seasonOnly = text.match(/\bSeason\s*(\d{1,2})\b[:\s.-]*(.*)$/i);
  if (seasonOnly) {
    return {
      seasonNumber: parseNumberish(seasonOnly[1]),
      episodeNumber: null,
      episodeTitle: cleanPrimeTitle(seasonOnly[2] || "")
    };
  }

  return {
    seasonNumber: null,
    episodeNumber: null,
    episodeTitle: null
  };
}

function buildDetectedEpisodeLabel(
  seasonNumber: number | null,
  episodeNumber: number | null,
  episodeTitle: string | null,
  fallbackSubtitle: string | null
): string | null {
  const segments: string[] = [];

  if (seasonNumber != null && episodeNumber != null) {
    segments.push(`S${seasonNumber}E${episodeNumber}`);
  } else if (seasonNumber != null) {
    segments.push(`Season ${seasonNumber}`);
  } else if (episodeNumber != null) {
    segments.push(`Episode ${episodeNumber}`);
  }

  if (episodeTitle) {
    segments.push(episodeTitle);
  } else if (fallbackSubtitle) {
    segments.push(fallbackSubtitle);
  }

  return segments.length ? segments.join(" · ") : null;
}

function subtitleSuggestsSeries(subtitle: string | null, title: string | null): boolean {
  const cleanedSubtitle = normalizeText(subtitle);
  if (!cleanedSubtitle) return false;

  const cleanedTitle = normalizeText(title);
  if (cleanedTitle && cleanedSubtitle === cleanedTitle) return false;

  if (/\bseason\b/i.test(cleanedSubtitle)) return true;
  if (/\bseasons\b/i.test(cleanedSubtitle)) return true;
  if (/\bepisode\b/i.test(cleanedSubtitle)) return true;
  if (/\bepisodes\b/i.test(cleanedSubtitle)) return true;
  if (/\bs\d+\s*e\d+\b/i.test(cleanedSubtitle)) return true;
  if (/\b\d+x\d+\b/i.test(cleanedSubtitle)) return true;
  if (/\btv\s*series\b/i.test(cleanedSubtitle)) return true;
  if (/\bseries\b/i.test(cleanedSubtitle)) return true;
  return false;
}

function extractSeriesTitleFromSeasonTitle(value?: string | null): string | null {
  const cleaned = cleanPrimeTitle(value);
  if (!cleaned) return null;

  const withoutSeason = cleaned
    .replace(/[:\-]\s*season\s*\d{1,2}\b.*$/i, "")
    .replace(/\bseason\s*\d{1,2}\b.*$/i, "")
    .trim();

  return withoutSeason || cleaned;
}

function findSeasonNumberInText(value?: string | null): number | null {
  const text = normalizeText(value);
  if (!text) return null;

  const matchers = [
    /\bseason\s*(\d{1,2})\b/i,
    /\bseasonNumber["'\s:=>]+(\d{1,2})\b/i,
    /\bseason_number["'\s:=>]+(\d{1,2})\b/i
  ];

  for (const pattern of matchers) {
    const match = text.match(pattern);
    if (!match) continue;
    return parseNumberish(match[1]);
  }

  return null;
}

function findEpisodeNumberInText(value?: string | null): number | null {
  const text = normalizeText(value);
  if (!text) return null;

  const matchers = [
    /\bepisode\s*(\d{1,3})\b/i,
    /\bdownload\s+episode\s*(\d{1,3})\b/i,
    /\bepisodeNumber["'\s:=>]+(\d{1,3})\b/i,
    /\bepisode_number["'\s:=>]+(\d{1,3})\b/i
  ];

  for (const pattern of matchers) {
    const match = text.match(pattern);
    if (!match) continue;
    return parseNumberish(match[1]);
  }

  return null;
}

function collectPageLevelSeriesSignals(
  doc: Document,
  domTitle: string | null,
  domSubtitle: string | null
): PageLevelSeriesSignals {
  const titleSeason = parseEpisodeDescriptor(doc.title);
  const domTitleParsed = parseEpisodeDescriptor(domTitle);
  const domSubtitleParsed = parseEpisodeDescriptor(domSubtitle);
  const description = findPrimeDescription(doc);
  const descriptionParsed = parseEpisodeDescriptor(description);
  const seasonNumber =
    titleSeason.seasonNumber ??
    domTitleParsed.seasonNumber ??
    domSubtitleParsed.seasonNumber ??
    descriptionParsed.seasonNumber ??
    findSeasonNumberInText(description);
  const episodeNumber =
    domSubtitleParsed.episodeNumber ??
    domTitleParsed.episodeNumber ??
    titleSeason.episodeNumber ??
    descriptionParsed.episodeNumber ??
    findEpisodeNumberInText(description);
  const seriesTitle =
    extractSeriesTitleFromSeasonTitle(domTitle) ||
    extractSeriesTitleFromSeasonTitle(doc.title) ||
    domTitle;

  return {
    seriesTitle,
    seasonNumber,
    episodeNumber
  };
}

function findPageReleaseYear(doc: Document): number | null {
  return parseYearValue(
    readMetaContent(doc, "meta[property='video:release_date']"),
    readMetaContent(doc, "meta[property='og:video:release_date']"),
    readMetaContent(doc, "meta[name='release_date']"),
    readMetaContent(doc, "meta[itemprop='datePublished']"),
    findPrimeDescription(doc),
    doc.title
  );
}

function createBaseState(rawUrl?: string | null): Pick<
  SiteDetectionState,
  | "siteKey"
  | "siteLabel"
  | "host"
  | "url"
  | "supported"
  | "videoPresent"
  | "isPlaying"
  | "playbackSource"
  | "mediaType"
  | "detectedTitle"
  | "detectedEpisode"
  | "seriesTitle"
  | "episodeTitle"
  | "releaseYear"
  | "seasonNumber"
  | "episodeNumber"
  | "progressPercent"
  | "playbackPositionSeconds"
  | "durationSeconds"
  | "remainingSeconds"
  | "watchThresholdMet"
  | "watchThresholdReason"
  | "iwatchedUrl"
  | "iwatchedMatchType"
> {
  const url = parseUrl(rawUrl);

  return {
    siteKey: isPrimeUrl(rawUrl) ? "prime" : "unsupported",
    siteLabel: hostLabel(rawUrl),
    host: url?.hostname || "unknown",
    url: rawUrl || "",
    supported: isPrimeUrl(rawUrl),
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

export function createUnsupportedSiteState(rawUrl?: string | null): SiteDetectionState {
  return {
    ...createBaseState(rawUrl),
    feedbackTitle: "Supported site not active",
    feedbackDetail: "Open Prime Video or Plex in this browser tab to start building a scrobble candidate.",
    updatedAt: Date.now()
  };
}

export function createPrimeWaitingState(rawUrl?: string | null): SiteDetectionState {
  return {
    ...createBaseState(rawUrl),
    siteKey: "prime",
    siteLabel: "Prime Video",
    supported: true,
    host: parseUrl(rawUrl)?.hostname || "www.primevideo.com",
    feedbackTitle: "Prime ready",
    feedbackDetail: "Start a title page or playback and the extension will begin surfacing a scrobble candidate.",
    updatedAt: Date.now()
  };
}

export function detectPrimeState(doc: Document, rawUrl: string): SiteDetectionState {
  if (!isPrimeUrl(rawUrl)) return createUnsupportedSiteState(rawUrl);

  const url = parseUrl(rawUrl);
  const video = selectPrimeVideo(doc);
  const domTitle = findPrimeTitle(doc);
  const domSubtitle = findPrimeSubtitle(doc);
  const domDescription = findPrimeDescription(doc);
  const structured = extractStructuredPrimeMetadata(doc);
  const metaMediaType = extractMetaMediaType(doc);
  const parsedSubtitle = parseEpisodeDescriptor(domSubtitle);
  const parsedDomTitle = parseEpisodeDescriptor(domTitle);
  const parsedTitle = parseEpisodeDescriptor(doc.title);
  const pageLevelSignals = collectPageLevelSeriesSignals(doc, domTitle, domSubtitle);
  const hasShowSignals =
    parsedSubtitle.seasonNumber != null ||
    parsedSubtitle.episodeNumber != null ||
    parsedDomTitle.seasonNumber != null ||
    parsedDomTitle.episodeNumber != null ||
    parsedTitle.seasonNumber != null ||
    parsedTitle.episodeNumber != null ||
    pageLevelSignals.seasonNumber != null ||
    pageLevelSignals.episodeNumber != null ||
    !!structured.episodeTitle ||
    !!structured.seriesTitle ||
    subtitleSuggestsSeries(domSubtitle, domTitle) ||
    subtitleSuggestsSeries(domDescription, domTitle);

  const mediaTypeHint = structured.mediaType !== "unknown"
    ? structured.mediaType
    : metaMediaType;
  const mediaType = mediaTypeHint !== "unknown"
    ? mediaTypeHint
    : hasShowSignals
      ? "show"
      : "movie";

  const seriesTitle =
    structured.seriesTitle ||
    pageLevelSignals.seriesTitle ||
    (mediaType === "show" ? domTitle : null);
  const episodeTitle =
    structured.episodeTitle ||
    parsedSubtitle.episodeTitle ||
    (mediaType === "show" && domSubtitle && domSubtitle !== domTitle ? domSubtitle : null);
  const releaseYear =
    structured.releaseYear ??
    findPageReleaseYear(doc);
  const seasonNumber =
    structured.seasonNumber ??
    parsedSubtitle.seasonNumber ??
    parsedDomTitle.seasonNumber ??
    parsedTitle.seasonNumber ??
    pageLevelSignals.seasonNumber;
  const episodeNumber =
    structured.episodeNumber ??
    parsedSubtitle.episodeNumber ??
    parsedDomTitle.episodeNumber ??
    parsedTitle.episodeNumber ??
    pageLevelSignals.episodeNumber;
  const detectedTitle =
    mediaType === "show"
      ? (seriesTitle || domTitle)
      : (structured.movieTitle || domTitle);
  const detectedEpisode = buildDetectedEpisodeLabel(
    seasonNumber,
    episodeNumber,
    episodeTitle,
    mediaType === "show" ? domSubtitle : null
  );

  const overlayRuntime = findOverlayRuntime(doc, video);
  const videoPosition = video ? clampTime(video.currentTime) : null;
  const videoDuration = video ? clampTime(video.duration) : null;
  const playbackPositionSeconds = overlayRuntime.elapsed ?? videoPosition;
  const durationSeconds = overlayRuntime.duration ?? videoDuration;
  const remainingSeconds =
    playbackPositionSeconds != null && durationSeconds != null
      ? Math.max(0, durationSeconds - playbackPositionSeconds)
      : null;
  const progressPercent =
    playbackPositionSeconds != null && durationSeconds != null && durationSeconds > 0
      ? roundProgress((playbackPositionSeconds / durationSeconds) * 100)
      : null;
  const isPlaying = !!(
    video &&
    !video.paused &&
    !video.ended &&
    (playbackPositionSeconds ?? 0) >= 0
  );
  const playbackSource =
    overlayRuntime.elapsed != null && overlayRuntime.duration != null
      ? "overlay"
      : video
        ? "video"
        : "none";
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

  let feedbackTitle = "Prime ready";
  let feedbackDetail =
    "Start a title and the extension will turn the current player state into a scrobble candidate.";

  if (detectedTitle && watchThresholdMet) {
    feedbackTitle = "Ready to add to timeline";
    feedbackDetail = watchThresholdReason
      ? `Detected ${detectedTitle}. Local watch rule met: ${watchThresholdReason.toLowerCase()}.`
      : `Detected ${detectedTitle}. Local watch rule met.`;
  } else if (detectedTitle && video && isPlaying) {
    feedbackTitle = "Playback active";
    feedbackDetail = `Detected ${detectedTitle} in active playback.`;
  } else if (detectedTitle && video) {
    feedbackTitle = "Player ready";
    feedbackDetail = `Detected ${detectedTitle}. Start the player to see live watch progress.`;
  } else if (detectedTitle) {
    feedbackTitle = "Title detected";
    feedbackDetail = `Found ${detectedTitle}. Start playback to preview a scrobble candidate.`;
  }

  return {
    siteKey: "prime",
    siteLabel: "Prime Video",
    host: url?.hostname || "www.primevideo.com",
    url: rawUrl,
    supported: true,
    videoPresent: !!video,
    isPlaying,
    playbackSource,
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
