import { browser } from "wxt/browser";

import {
  createIWatchedApiClient,
  DEFAULT_IWATCHED_BASE_URL,
  type OAuthTokenResponse,
  type SessionResponse,
  type SessionUser
} from "@iwatched-scrobbler/api-client";

export const IWATCHED_BASE_URL = DEFAULT_IWATCHED_BASE_URL;
export const IWATCHED_OAUTH_CLIENT_ID = "iwatched-scrobbler-extension";

export const AUTH_STORAGE_KEY = "iwatched/auth-connection";
const ACCESS_TOKEN_REFRESH_LEEWAY_MS = 60_000;
const REQUESTED_SCOPES = [
  "watched:read",
  "watched:write",
  "review:read",
  "review:write",
  "scrobble:write"
].join(" ");

export interface StoredConnectionState {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string[];
  connectionId: string | null;
  user: SessionUser | null;
}

interface DeviceContext {
  deviceName: string;
  browserName: string;
  platformName: string;
  clientVersion: string;
}

const oauthApi = createIWatchedApiClient({
  baseUrl: IWATCHED_BASE_URL,
  defaultCredentials: "omit"
});

let refreshPromise: Promise<string | null> | null = null;

function toBase64Url(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Base64Url(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toBase64Url(digest);
}

function createRandomVerifier(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

function parseUserAgent(userAgent: string): { browserName: string; platformName: string } {
  const ua = String(userAgent || "");
  let browserName = "Browser";
  let version = "";
  let match: RegExpMatchArray | null = null;

  if ((match = ua.match(/Edg(?:e|A|iOS)?\/([\d.]+)/))) { browserName = "Edge"; version = match[1]; }
  else if ((match = ua.match(/OPR\/([\d.]+)/))) { browserName = "Opera"; version = match[1]; }
  else if ((match = ua.match(/Firefox\/([\d.]+)/))) { browserName = "Firefox"; version = match[1]; }
  else if ((match = ua.match(/Chrome\/([\d.]+)/)) && !/Chromium/i.test(ua)) { browserName = "Chrome"; version = match[1]; }
  else if ((match = ua.match(/Version\/([\d.]+).*Safari\//))) { browserName = "Safari"; version = match[1]; }
  else if (/Safari\//.test(ua)) { browserName = "Safari"; }

  let platformName = "Unknown OS";
  if (/Windows NT 10\.0/.test(ua)) platformName = "Windows 10/11";
  else if (/Windows NT 6\.3/.test(ua)) platformName = "Windows 8.1";
  else if (/Windows NT 6\.2/.test(ua)) platformName = "Windows 8";
  else if (/Windows NT 6\.1/.test(ua)) platformName = "Windows 7";
  else if (/Android\s([\d.]+)/.test(ua)) platformName = `Android ${(ua.match(/Android\s([\d.]+)/) || [])[1] || ""}`.trim();
  else if (/iPhone|iPad|iPod/.test(ua)) platformName = "iOS";
  else if (/Mac OS X\s([\d_]+)/.test(ua)) platformName = `macOS ${((ua.match(/Mac OS X\s([\d_]+)/) || [])[1] || "").replace(/_/g, ".")}`.trim();
  else if (/Linux/.test(ua)) platformName = "Linux";

  return {
    browserName: version ? `${browserName} ${version}` : browserName,
    platformName
  };
}

function getDeviceContext(): DeviceContext {
  const userAgent = navigator.userAgent || "";
  const parsed = parseUserAgent(userAgent);
  const clientVersion = browser.runtime.getManifest().version || "0.1.1";
  const deviceName = `${parsed.browserName} on ${parsed.platformName}`.trim();

  return {
    deviceName,
    browserName: parsed.browserName,
    platformName: parsed.platformName,
    clientVersion
  };
}

function buildStoredConnectionState(payload: OAuthTokenResponse): StoredConnectionState {
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + Math.max(0, Number(payload.expires_in || 0) * 1000),
    scope: String(payload.scope || "")
      .split(/\s+/)
      .map((entry) => entry.trim())
      .filter(Boolean),
    connectionId: payload.connection_id || null,
    user: payload.user || null
  };
}

function hasAnyScope(scopes: string[], prefix: string): boolean {
  return scopes.some((scope) => scope === prefix || scope.startsWith(`${prefix}:`));
}

export function buildStoredConnectionCapabilities(
  scopes: string[]
): NonNullable<SessionResponse["capabilities"]> {
  return {
    watched: hasAnyScope(scopes, "watched"),
    scrobble: scopes.includes("scrobble:write"),
    review: hasAnyScope(scopes, "review")
  };
}

async function readStoredConnection(): Promise<StoredConnectionState | null> {
  const stored = await browser.storage.local.get(AUTH_STORAGE_KEY);
  const value = stored ? stored[AUTH_STORAGE_KEY] : null;
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<StoredConnectionState>;
  if (!candidate.accessToken || !candidate.refreshToken) return null;

  return {
    accessToken: String(candidate.accessToken),
    refreshToken: String(candidate.refreshToken),
    expiresAt: Number(candidate.expiresAt || 0),
    scope: Array.isArray(candidate.scope) ? candidate.scope.map(String) : [],
    connectionId: candidate.connectionId ? String(candidate.connectionId) : null,
    user: candidate.user || null
  };
}

async function writeStoredConnection(value: StoredConnectionState): Promise<void> {
  await browser.storage.local.set({
    [AUTH_STORAGE_KEY]: value
  });
}

export async function clearStoredConnection(): Promise<void> {
  refreshPromise = null;
  await browser.storage.local.remove(AUTH_STORAGE_KEY);
}

async function getRedirectUri(): Promise<string> {
  return chrome.identity.getRedirectURL("oauth2");
}

async function launchWebAuthFlow(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (redirectUrl) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message || "Could not start sign-in"));
        return;
      }
      if (!redirectUrl) {
        reject(new Error("Sign-in was cancelled before it finished."));
        return;
      }
      resolve(redirectUrl);
    });
  });
}

export async function ensureValidAccessToken(forceRefresh = false): Promise<string | null> {
  const stored = await readStoredConnection();
  if (!stored) return null;

  if (!forceRefresh && stored.expiresAt > (Date.now() + ACCESS_TOKEN_REFRESH_LEEWAY_MS)) {
    return stored.accessToken;
  }

  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const device = getDeviceContext();
      const refreshed = await oauthApi.refreshAccessToken({
        clientId: IWATCHED_OAUTH_CLIENT_ID,
        refreshToken: stored.refreshToken,
        deviceName: device.deviceName,
        browserName: device.browserName,
        platformName: device.platformName,
        clientVersion: device.clientVersion
      });

      const nextState = buildStoredConnectionState(refreshed);
      await writeStoredConnection(nextState);
      return nextState.accessToken;
    } catch (_) {
      await clearStoredConnection();
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function startExtensionConnection(): Promise<StoredConnectionState> {
  const redirectUri = await getRedirectUri();
  const state = createRandomVerifier(24);
  const codeVerifier = createRandomVerifier(48);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const authorizeUrl = new URL(`${IWATCHED_BASE_URL}/connect/extension`);

  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", IWATCHED_OAUTH_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", REQUESTED_SCOPES);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  const redirectedUrl = await launchWebAuthFlow(authorizeUrl.toString());
  const redirected = new URL(redirectedUrl);
  const returnedState = redirected.searchParams.get("state");
  const error = redirected.searchParams.get("error");
  const code = redirected.searchParams.get("code");

  if (returnedState !== state) {
    throw new Error("The sign-in response did not match this request.");
  }

  if (error) {
    throw new Error(error === "access_denied" ? "The connection request was cancelled." : `Sign-in failed: ${error}`);
  }

  if (!code) {
    throw new Error("The sign-in response did not include an authorization code.");
  }

  const device = getDeviceContext();
  const exchanged = await oauthApi.exchangeAuthorizationCode({
    clientId: IWATCHED_OAUTH_CLIENT_ID,
    code,
    codeVerifier,
    redirectUri,
    deviceName: device.deviceName,
    browserName: device.browserName,
    platformName: device.platformName,
    clientVersion: device.clientVersion
  });

  const nextState = buildStoredConnectionState(exchanged);
  await writeStoredConnection(nextState);
  return nextState;
}

export async function disconnectExtensionConnection(): Promise<void> {
  const stored = await readStoredConnection();
  await clearStoredConnection();
  if (!stored) return;

  try {
    await oauthApi.revokeToken(stored.refreshToken);
  } catch (_) {
    // Ignore revoke failures after local disconnect.
  }
}

export async function getStoredConnection(): Promise<StoredConnectionState | null> {
  return readStoredConnection();
}

export async function getStoredConnectionSession(forceRefresh = false): Promise<{
  authenticated: true;
  user: SessionUser | null;
  capabilities: NonNullable<SessionResponse["capabilities"]>;
  lastCheckedAt: number;
} | null> {
  const stored = await readStoredConnection();
  if (!stored) return null;

  const accessToken = await ensureValidAccessToken(forceRefresh);
  if (!accessToken) return null;

  const latest = await readStoredConnection();
  if (!latest) return null;

  return {
    authenticated: true,
    user: latest.user || stored.user || null,
    capabilities: buildStoredConnectionCapabilities(latest.scope || stored.scope || []),
    lastCheckedAt: Date.now()
  };
}
