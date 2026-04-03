import type {
  DetectedMediaType,
  IWatchedMatchType,
  SiteDetectionState
} from "../types/popup-state";

const IWATCHED_BASE_URL = "https://iwatched.app";

interface SearchMovieItem {
  id: number;
  title: string;
}

interface SearchShowItem {
  id: number;
  name: string;
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
}

function normalizeTitle(value?: string | null): string {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function createSearchUrl(query: string): string {
  return `${IWATCHED_BASE_URL}/search?q=${encodeURIComponent(query)}`;
}

function scoreTitleMatch(query: string, candidate: string): number {
  const normalizedQuery = normalizeTitle(query);
  const normalizedCandidate = normalizeTitle(candidate);

  if (!normalizedQuery || !normalizedCandidate) return 0;
  if (normalizedQuery === normalizedCandidate) return 100;
  if (normalizedCandidate.startsWith(normalizedQuery)) return 92;
  if (normalizedQuery.startsWith(normalizedCandidate)) return 88;
  if (normalizedCandidate.includes(normalizedQuery)) return 76;
  if (normalizedQuery.includes(normalizedCandidate)) return 68;

  const queryTokens = normalizedQuery.split(" ");
  const candidateTokens = normalizedCandidate.split(" ");
  const overlap = queryTokens.filter((token) => candidateTokens.includes(token)).length;
  if (!overlap) return 0;

  return Math.round((overlap / Math.max(queryTokens.length, candidateTokens.length)) * 50);
}

function matchMovie(query: string, movies: SearchMovieItem[]): MatchResult | null {
  const scored = movies
    .map((movie) => ({
      id: movie.id,
      score: scoreTitleMatch(query, movie.title),
      type: "movie" as const
    }))
    .sort((left, right) => right.score - left.score);

  const best = scored[0] || null;
  if (!best) return null;

  if (best.score >= 60) return best;
  if (movies.length === 1 && best.score >= 30) return best;

  const second = scored[1];
  if (!second && best.score >= 45) return best;
  if (second && best.score >= 52 && best.score - second.score >= 14) {
    return best;
  }

  return null;
}

function matchShow(query: string, shows: SearchShowItem[]): MatchResult | null {
  const scored = shows
    .map((show) => ({
      id: show.id,
      score: scoreTitleMatch(query, show.name),
      type: "show" as const
    }))
    .sort((left, right) => right.score - left.score);

  const best = scored[0] || null;
  if (!best) return null;

  if (best.score >= 60) return best;
  if (shows.length === 1 && best.score >= 30) return best;

  const second = scored[1];
  if (!second && best.score >= 45) return best;
  if (second && best.score >= 52 && best.score - second.score >= 14) {
    return best;
  }

  return null;
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

function resolveQuery(site: SiteDetectionState): string | null {
  if (site.mediaType === "show") {
    return site.seriesTitle || site.detectedTitle;
  }

  if (site.mediaType === "movie") {
    return site.detectedTitle;
  }

  return site.seriesTitle || site.detectedTitle;
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
  const query = resolveQuery(site);
  if (!query) {
    return {
      iwatchedUrl: null,
      iwatchedMatchType: "none"
    };
  }

  return {
    iwatchedUrl: createSearchUrl(query),
    iwatchedMatchType: "search"
  };
}

export async function resolveIWatchedTarget(site: SiteDetectionState): Promise<ResolvedTarget> {
  const query = resolveQuery(site);
  if (!query) return createFallback(site);

  try {
    const response = await fetch(
      `${IWATCHED_BASE_URL}/api/v1/search?q=${encodeURIComponent(query)}&limit=6`
    );

    if (!response.ok) return createFallback(site);

    const payload = (await response.json()) as SearchPayload;
    const movies = Array.isArray(payload.movies) ? payload.movies : [];
    const shows = Array.isArray(payload.shows) ? payload.shows : [];

    let match: MatchResult | null = null;

    if (site.mediaType === "movie") {
      match = matchMovie(query, movies);
    } else if (site.mediaType === "show") {
      match = matchShow(query, shows);
    } else {
      const movieMatch = matchMovie(query, movies);
      const showMatch = matchShow(query, shows);
      if (preferShow(site)) {
        match = showMatch || movieMatch;
      } else if (movieMatch && showMatch) {
        match = movieMatch.score === showMatch.score
          ? null
          : (movieMatch.score > showMatch.score ? movieMatch : showMatch);
      } else {
        match = movieMatch || showMatch;
      }
    }

    if (!match) return createFallback(site);

    return {
      iwatchedUrl: buildResolvedUrl(site, match),
      iwatchedMatchType: "resolved"
    };
  } catch (_) {
    return createFallback(site);
  }
}
