export const DEFAULT_IWATCHED_BASE_URL = "http://localhost:3000";

export type ReviewTargetType = "movie" | "show" | "season" | "episode";

export interface SessionUser {
  id: string;
  username: string;
  handle: string;
  plan: string;
  premium: boolean;
}

export interface SessionResponse {
  ok: boolean;
  authenticated: boolean;
  auth_mode: string;
  connection?: {
    id: string;
    client_id: string;
    client_name: string;
    scopes: string[];
  } | null;
  user?: SessionUser;
  capabilities?: {
    scrobble: boolean;
    watched: boolean;
    review: boolean;
  };
}

export interface OAuthTokenResponse {
  token_type: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  connection_id: string;
  user: SessionUser;
}

export interface OAuthTokenErrorResponse {
  error: string;
  error_description?: string;
}

export interface PublicClientReleaseResponse {
  ok: boolean;
  client_key: string;
  label: string;
  available: boolean;
  status: string;
  status_label: string;
  tone: string;
  version: string;
  notes: string;
  size_display: string;
  updated_at_display: string;
  download_url: string;
  details_url: string;
}

export interface OAuthAuthorizationCodeInput {
  clientId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  deviceName?: string;
  browserName?: string;
  platformName?: string;
  clientVersion?: string;
}

export interface OAuthRefreshInput {
  clientId: string;
  refreshToken: string;
  deviceName?: string;
  browserName?: string;
  platformName?: string;
  clientVersion?: string;
}

export interface TargetInput {
  itemType: ReviewTargetType;
  tmdbId: string;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
}

export interface WatchedStateResponse {
  ok: boolean;
  item_type: string;
  tmdb_id: string;
  season_number?: number | null;
  episode_number?: number | null;
  watched: boolean;
  watched_count: number;
  watched_at: string | null;
  personal_rating: number;
  personal_note: string;
}

export interface MarkWatchedInput extends TargetInput {
  watchedAt?: string;
  watchedFormat?: string;
  source?: string;
}

export interface ScrobbleInput extends TargetInput {
  watchedAt: string;
  watchedFormat?: string;
  source?: string;
  platform?: string;
  externalEventId?: string;
  idempotencyKey?: string;
  clientName?: string;
  clientVersion?: string;
  showTitle?: string;
  seriesTitle?: string;
  episodeTitle?: string;
  contentTitle?: string;
}

export interface ReviewResponse {
  ok: boolean;
  id?: string;
  removed?: boolean;
  mode?: string;
  review: unknown | null;
}

export interface ScrobbleResponse {
  ok: boolean;
  duplicate: boolean;
  item_type: string;
  tmdb_id: string;
  season_number?: number | null;
  episode_number?: number | null;
  event?: unknown;
}

export interface ReviewInput extends TargetInput {
  rating: number;
  title?: string;
  body?: string;
}

export class IWatchedApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "IWatchedApiError";
    this.status = status;
    this.payload = payload;
  }
}

interface ClientOptions {
  baseUrl?: string;
  getAccessToken?: ((forceRefresh?: boolean) => Promise<string | null> | string | null) | null;
  defaultCredentials?: RequestCredentials;
}

interface RequestOptions extends RequestInit {
  allowUnauthorized?: boolean;
  skipAuth?: boolean;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function buildTargetParams(target: TargetInput): URLSearchParams {
  const params = new URLSearchParams();
  params.set("item_type", target.itemType);
  params.set("tmdb_id", String(target.tmdbId));
  if (target.seasonNumber != null) params.set("season_number", String(target.seasonNumber));
  if (target.episodeNumber != null) params.set("episode_number", String(target.episodeNumber));
  return params;
}

async function parseResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

export function createIWatchedApiClient(options: ClientOptions = {}) {
  const baseUrl = trimTrailingSlash(options.baseUrl || DEFAULT_IWATCHED_BASE_URL);
  const getAccessToken = options.getAccessToken || null;
  const defaultCredentials = options.defaultCredentials || "include";

  async function request<T>(path: string, init?: RequestOptions): Promise<T> {
    const { allowUnauthorized = false, skipAuth = false, ...requestInit } = init || {};
    const sendRequest = async (accessToken: string | null) => {
      const response = await fetch(`${baseUrl}${path}`, {
        credentials: accessToken ? "omit" : defaultCredentials,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(requestInit.headers ? requestInit.headers : {})
        },
        ...requestInit
      });

      return {
        response,
        payload: await parseResponse(response)
      };
    };

    const initialAccessToken = !skipAuth && getAccessToken
      ? await getAccessToken(false)
      : null;

    let { response, payload } = await sendRequest(initialAccessToken);

    if (!skipAuth && initialAccessToken && response.status === 401 && getAccessToken) {
      const refreshedAccessToken = await getAccessToken(true);
      if (refreshedAccessToken && refreshedAccessToken !== initialAccessToken) {
        const retried = await sendRequest(refreshedAccessToken);
        response = retried.response;
        payload = retried.payload;
      }
    }

    if (!response.ok) {
      if (allowUnauthorized && response.status === 401) {
        return payload as T;
      }

      const message =
        typeof payload === "object" && payload && "message" in payload
          ? String((payload as { message?: string }).message || "API request failed")
          : "API request failed";
      throw new IWatchedApiError(message, response.status, payload);
    }

    return payload as T;
  }

  return {
    exchangeAuthorizationCode(input: OAuthAuthorizationCodeInput): Promise<OAuthTokenResponse> {
      return request<OAuthTokenResponse>("/oauth/token", {
        method: "POST",
        skipAuth: true,
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: input.clientId,
          code: input.code,
          code_verifier: input.codeVerifier,
          redirect_uri: input.redirectUri,
          device_name: input.deviceName,
          browser_name: input.browserName,
          platform_name: input.platformName,
          client_version: input.clientVersion
        })
      });
    },

    refreshAccessToken(input: OAuthRefreshInput): Promise<OAuthTokenResponse> {
      return request<OAuthTokenResponse>("/oauth/token", {
        method: "POST",
        skipAuth: true,
        body: JSON.stringify({
          grant_type: "refresh_token",
          client_id: input.clientId,
          refresh_token: input.refreshToken,
          device_name: input.deviceName,
          browser_name: input.browserName,
          platform_name: input.platformName,
          client_version: input.clientVersion
        })
      });
    },

    revokeToken(token: string): Promise<{ ok: boolean }> {
      return request<{ ok: boolean }>("/oauth/revoke", {
        method: "POST",
        skipAuth: true,
        body: JSON.stringify({ token })
      });
    },

    getSession(): Promise<SessionResponse> {
      return request<SessionResponse>("/api/v1/scrobbler/session", {
        method: "GET",
        allowUnauthorized: true
      });
    },

    getPublicClientRelease(clientKey: "browser" | "desktop"): Promise<PublicClientReleaseResponse> {
      return request<PublicClientReleaseResponse>(`/api/v1/scrobbler/releases/${clientKey}`, {
        method: "GET",
        skipAuth: true
      });
    },

    getWatched(target: TargetInput): Promise<WatchedStateResponse> {
      return request<WatchedStateResponse>(`/api/v1/watched?${buildTargetParams(target).toString()}`, {
        method: "GET"
      });
    },

    markWatched(input: MarkWatchedInput): Promise<WatchedStateResponse> {
      return request<WatchedStateResponse>("/api/v1/watched", {
        method: "POST",
        body: JSON.stringify({
          item_type: input.itemType,
          tmdb_id: input.tmdbId,
          season_number: input.seasonNumber ?? null,
          episode_number: input.episodeNumber ?? null,
          watched_at: input.watchedAt,
          watched_format: input.watchedFormat,
          source: input.source
        })
      });
    },

    scrobble(input: ScrobbleInput): Promise<ScrobbleResponse> {
      return request<ScrobbleResponse>("/api/v1/scrobble", {
        method: "POST",
        body: JSON.stringify({
          media_type: input.itemType === "movie" ? "movie" : "show",
          item_type: input.itemType,
          tmdb_id: input.tmdbId,
          season_number: input.seasonNumber ?? null,
          episode_number: input.episodeNumber ?? null,
          watched_at: input.watchedAt,
          watched_format: input.watchedFormat,
          source: input.source,
          platform: input.platform,
          external_event_id: input.externalEventId,
          idempotency_key: input.idempotencyKey,
          client_name: input.clientName,
          client_version: input.clientVersion,
          show_title: input.showTitle,
          series_title: input.seriesTitle,
          episode_title: input.episodeTitle,
          content_title: input.contentTitle
        })
      });
    },

    getReview(target: TargetInput): Promise<ReviewResponse> {
      return request<ReviewResponse>(`/api/v1/review?${buildTargetParams(target).toString()}`, {
        method: "GET"
      });
    },

    upsertReview(input: ReviewInput): Promise<ReviewResponse> {
      return request<ReviewResponse>("/api/v1/review", {
        method: "PUT",
        body: JSON.stringify({
          item_type: input.itemType,
          tmdb_id: input.tmdbId,
          season_number: input.seasonNumber ?? null,
          episode_number: input.episodeNumber ?? null,
          rating: input.rating,
          title: input.title,
          body: input.body
        })
      });
    }
  };
}
