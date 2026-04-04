import type {
  DetectedMediaType,
  IWatchedMatchType,
  SiteDetectionState
} from "../types/popup-state";
import { DEFAULT_IWATCHED_BASE_URL } from "@iwatched-scrobbler/api-client";

const IWATCHED_BASE_URL = DEFAULT_IWATCHED_BASE_URL;

interface SearchMovieItem {
  id: number;
  title: string;
  original_title?: string | null;
  release_date?: string | null;
}

interface SearchShowItem {
  id: number;
  name: string;
  original_name?: string | null;
  first_air_date?: string | null;
}

interface SearchPayload {
  movies?: SearchMovieItem[];
  shows?: SearchShowItem[];
}

interface MatchResult {
  id: number;
  score: number;
  type: DetectedMediaType;
}

interface ResolvedTarget {
  iwatchedUrl: string | null;
  iwatchedMatchType: IWatchedMatchType;
  iwatchedTmdbId: string | null;
  iwatchedTargetType: SiteDetectionState["iwatchedTargetType"];
}

function normalizeTitle(value?: string | null): string {
  const normalized = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\b(the|a|an)\b/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized;
}

function createSearchUrl(query: string): string {
  return `${IWATCHED_BASE_URL}/search?q=${encodeURIComponent(query)}`;
}

function uniqueValues(values: Array<string | null | undefined>): string[] {
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index);
}

function extractYear(value?: string | null): number | null {
  const match = String(value || "").match(/\b(19|20)\d{2}\b/);
  if (!match) return null;

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildQueryVariants(site: SiteDetectionState): string[] {
  const primary = site.mediaType === "show"
    ? (site.seriesTitle || site.detectedTitle)
    : site.detectedTitle;
  const compactPrimary = primary
    ? primary.replace(/\s*[:\-]\s*season\s+\d+.*$/i, "").trim()
    : null;

  return uniqueValues([
    primary,
    compactPrimary,
    site.seriesTitle,
    site.detectedTitle
  ]);
}

function scoreTitleMatch(query: string, candidate: string): number {
  const normalizedQuery = normalizeTitle(query);
  const normalizedCandidate = normalizeTitle(candidate);

  if (!normalizedQuery || !normalizedCandidate) return 0;
  if (normalizedQuery === normalizedCandidate) return 100;
  if (normalizedCandidate.startsWith(normalizedQuery)) return 92;
  if (normalizedQuery.startsWith(normalizedCandidate)) return 88;
  if (normalizedCandidate.includes(normalizedQuery)) return 80;
  if (normalizedQuery.includes(normalizedCandidate)) return 72;

  const queryTokens = normalizedQuery.split(" ");
  const candidateTokens = normalizedCandidate.split(" ");
  const overlap = queryTokens.filter((token) => candidateTokens.includes(token)).length;
  if (!overlap) return 0;

  return Math.round((overlap / Math.max(queryTokens.length, candidateTokens.length)) * 58);
}

function scoreYearMatch(expectedYear: number | null, candidateYear: number | null): number {
  if (!expectedYear || !candidateYear) return 0;
  if (expectedYear === candidateYear) return 12;
  if (Math.abs(expectedYear - candidateYear) === 1) return 4;
  return -10;
}

function scoreCandidate(
  query: string,
  titles: string[],
  expectedYear: number | null,
  candidateYear: number | null
): number {
  const titleScore = titles.reduce((best, title) => Math.max(best, scoreTitleMatch(query, title)), 0);
  return titleScore + scoreYearMatch(expectedYear, candidateYear);
}

function selectBestMatch(
  scored: MatchResult[],
  totalCandidates: number
): MatchResult | null {
  const best = scored[0] || null;
  if (!best) return null;

  if (best.score >= 66) return best;
  if (totalCandidates === 1 && best.score >= 46) return best;

  const second = scored[1];
  if (!second && best.score >= 56) return best;
  if (second && best.score >= 58 && best.score - second.score >= 12) {
    return best;
  }

  return null;
}

function matchMovie(
  query: string,
  expectedYear: number | null,
  movies: SearchMovieItem[]
): MatchResult | null {
  const scored = movies
    .map((movie) => ({
      id: movie.id,
      score: scoreCandidate(
        query,
        uniqueValues([movie.title, movie.original_title]),
        expectedYear,
        extractYear(movie.release_date)
      ),
      type: "movie" as const
    }))
    .sort((left, right) => right.score - left.score);

  return selectBestMatch(scored, movies.length);
}

function matchShow(
  query: string,
  expectedYear: number | null,
  shows: SearchShowItem[]
): MatchResult | null {
  const scored = shows
    .map((show) => ({
      id: show.id,
      score: scoreCandidate(
        query,
        uniqueValues([show.name, show.original_name]),
        expectedYear,
        extractYear(show.first_air_date)
      ),
      type: "show" as const
    }))
    .sort((left, right) => right.score - left.score);

  return selectBestMatch(scored, shows.length);
}

function buildResolvedUrl(site: SiteDetectionState, match: MatchResult): string {
  if (match.type === "movie") {
    return `${IWATCHED_BASE_URL}/movies/${match.id}`;
  }

  if (site.seasonNumber != null && site.episodeNumber != null) {
    return `${IWATCHED_BASE_URL}/shows/${match.id}/season/${site.seasonNumber}/episode/${site.episodeNumber}`;
  }

  if (site.seasonNumber != null) {
    return `${IWATCHED_BASE_URL}/shows/${match.id}/season/${site.seasonNumber}`;
  }

  return `${IWATCHED_BASE_URL}/shows/${match.id}`;
}

function preferShow(site: SiteDetectionState): boolean {
  return (
    site.mediaType === "show" ||
    site.seasonNumber != null ||
    site.episodeNumber != null ||
    !!site.episodeTitle ||
    !!site.detectedEpisode
  );
}

function createFallback(site: SiteDetectionState): ResolvedTarget {
  const [query] = buildQueryVariants(site);
  if (!query) {
    return {
      iwatchedUrl: null,
      iwatchedMatchType: "none",
      iwatchedTmdbId: null,
      iwatchedTargetType: null
    };
  }

  return {
    iwatchedUrl: createSearchUrl(query),
    iwatchedMatchType: "search",
    iwatchedTmdbId: null,
    iwatchedTargetType: null
  };
}

async function fetchSearchPayload(query: string, year: number | null): Promise<SearchPayload | null> {
  const params = new URLSearchParams({
    q: query,
    limit: "6"
  });

  if (year) {
    params.set("year", String(year));
  }

  const response = await fetch(`${IWATCHED_BASE_URL}/api/v1/search?${params.toString()}`);
  if (!response.ok) return null;

  return (await response.json()) as SearchPayload;
}

function resolvePayloadMatch(site: SiteDetectionState, query: string, payload: SearchPayload): MatchResult | null {
  const movies = Array.isArray(payload.movies) ? payload.movies : [];
  const shows = Array.isArray(payload.shows) ? payload.shows : [];
  const expectedYear = site.releaseYear ?? null;

  if (site.mediaType === "movie") {
    return matchMovie(query, expectedYear, movies);
  }

  if (site.mediaType === "show") {
    return matchShow(query, expectedYear, shows);
  }

  const movieMatch = matchMovie(query, expectedYear, movies);
  const showMatch = matchShow(query, expectedYear, shows);
  if (preferShow(site)) {
    return showMatch || movieMatch;
  }

  if (movieMatch && showMatch) {
    return movieMatch.score === showMatch.score
      ? null
      : (movieMatch.score > showMatch.score ? movieMatch : showMatch);
  }

  return movieMatch || showMatch;
}

export async function resolveIWatchedTarget(site: SiteDetectionState): Promise<ResolvedTarget> {
  const queries = buildQueryVariants(site);
  if (!queries.length) return createFallback(site);

  try {
    for (const query of queries) {
      const withYear = await fetchSearchPayload(query, site.releaseYear ?? null);
      const withYearMatch = withYear ? resolvePayloadMatch(site, query, withYear) : null;
      if (withYearMatch) {
        return {
          iwatchedUrl: buildResolvedUrl(site, withYearMatch),
          iwatchedMatchType: "resolved",
          iwatchedTmdbId: String(withYearMatch.id),
          iwatchedTargetType:
            withYearMatch.type === "movie"
              ? "movie"
              : site.episodeNumber != null
                ? "episode"
                : site.seasonNumber != null
                  ? "season"
                  : "show"
        };
      }

      const withoutYear = site.releaseYear ? await fetchSearchPayload(query, null) : withYear;
      const fallbackMatch = withoutYear ? resolvePayloadMatch(site, query, withoutYear) : null;
      if (!fallbackMatch) continue;

      return {
        iwatchedUrl: buildResolvedUrl(site, fallbackMatch),
        iwatchedMatchType: "resolved",
        iwatchedTmdbId: String(fallbackMatch.id),
        iwatchedTargetType:
          fallbackMatch.type === "movie"
            ? "movie"
            : site.episodeNumber != null
              ? "episode"
              : site.seasonNumber != null
                ? "season"
                : "show"
      };
    }

    return createFallback(site);
  } catch (_) {
    return createFallback(site);
  }
}
