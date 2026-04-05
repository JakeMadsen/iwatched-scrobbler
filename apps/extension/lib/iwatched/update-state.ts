import { browser } from "wxt/browser";

export const EXTENSION_UPDATE_STATE_STORAGE_KEY = "iwatched/extension-update-state";
export const EXTENSION_UPDATE_CHECK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type ExtensionUpdateStatus =
  | "idle"
  | "current"
  | "update_available"
  | "error";

export interface ExtensionUpdateState {
  status: ExtensionUpdateStatus;
  currentVersion: string;
  latestVersion: string | null;
  checkedAt: number | null;
  detailsUrl: string | null;
  downloadUrl: string | null;
  message: string | null;
}

function normalizeVersionSegment(value: string): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function normalizeVersionLabel(value: string | null | undefined): string {
  return String(value || "").trim().replace(/^v/i, "");
}

export function compareVersionLabels(left: string, right: string): number {
  const leftParts = normalizeVersionLabel(left).split(/[.\-_]+/g).filter(Boolean);
  const rightParts = normalizeVersionLabel(right).split(/[.\-_]+/g).filter(Boolean);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] || "0";
    const rightPart = rightParts[index] || "0";
    const leftNumber = Number(leftPart);
    const rightNumber = Number(rightPart);
    const bothNumeric = Number.isFinite(leftNumber) && Number.isFinite(rightNumber);

    if (bothNumeric) {
      if (leftNumber > rightNumber) return 1;
      if (leftNumber < rightNumber) return -1;
      continue;
    }

    const normalizedLeft = normalizeVersionSegment(leftPart);
    const normalizedRight = normalizeVersionSegment(rightPart);
    if (normalizedLeft > normalizedRight) return 1;
    if (normalizedLeft < normalizedRight) return -1;
  }

  return 0;
}

export function isVersionOutdated(currentVersion: string, latestVersion: string | null): boolean {
  if (!latestVersion) return false;
  return compareVersionLabels(currentVersion, latestVersion) < 0;
}

export function createDefaultExtensionUpdateState(currentVersion: string): ExtensionUpdateState {
  return {
    status: "idle",
    currentVersion,
    latestVersion: null,
    checkedAt: null,
    detailsUrl: null,
    downloadUrl: null,
    message: null
  };
}

function parseStoredUpdateState(
  currentVersion: string,
  value: unknown
): ExtensionUpdateState {
  if (!value || typeof value !== "object") {
    return createDefaultExtensionUpdateState(currentVersion);
  }

  const candidate = value as Partial<ExtensionUpdateState>;
  const status = candidate.status === "current"
    || candidate.status === "update_available"
    || candidate.status === "error"
    || candidate.status === "idle"
    ? candidate.status
    : "idle";

  return {
    status,
    currentVersion: String(candidate.currentVersion || currentVersion),
    latestVersion: candidate.latestVersion ? String(candidate.latestVersion) : null,
    checkedAt: Number.isFinite(Number(candidate.checkedAt)) ? Number(candidate.checkedAt) : null,
    detailsUrl: candidate.detailsUrl ? String(candidate.detailsUrl) : null,
    downloadUrl: candidate.downloadUrl ? String(candidate.downloadUrl) : null,
    message: candidate.message ? String(candidate.message) : null
  };
}

export async function readExtensionUpdateState(
  currentVersion: string
): Promise<ExtensionUpdateState> {
  const stored = await browser.storage.local.get(EXTENSION_UPDATE_STATE_STORAGE_KEY);
  return parseStoredUpdateState(currentVersion, stored[EXTENSION_UPDATE_STATE_STORAGE_KEY]);
}

export async function writeExtensionUpdateState(state: ExtensionUpdateState): Promise<void> {
  await browser.storage.local.set({
    [EXTENSION_UPDATE_STATE_STORAGE_KEY]: state
  });
}

export function isExtensionUpdateStateStale(
  state: ExtensionUpdateState,
  maxAgeMs = EXTENSION_UPDATE_CHECK_MAX_AGE_MS
): boolean {
  if (!state.checkedAt) return true;
  return Date.now() - state.checkedAt > maxAgeMs;
}
