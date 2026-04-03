export type SiteKey = "prime" | "unsupported";
export type QueueItemState = "ready" | "hold" | "info";
export type DetectedMediaType = "movie" | "show" | "unknown";
export type IWatchedMatchType = "resolved" | "search" | "none";

export interface MockSessionState {
  connected: boolean;
  mode: "mock";
  displayName: string;
  handle: string;
  planLabel: string;
}

export interface SiteDetectionState {
  siteKey: SiteKey;
  siteLabel: string;
  host: string;
  url: string;
  supported: boolean;
  videoPresent: boolean;
  isPlaying: boolean;
  playbackSource: "overlay" | "video" | "none";
  mediaType: DetectedMediaType;
  detectedTitle: string | null;
  detectedEpisode: string | null;
  seriesTitle: string | null;
  episodeTitle: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  progressPercent: number | null;
  playbackPositionSeconds: number | null;
  durationSeconds: number | null;
  remainingSeconds: number | null;
  watchThresholdMet: boolean;
  watchThresholdReason: string | null;
  iwatchedUrl: string | null;
  iwatchedMatchType: IWatchedMatchType;
  feedbackTitle: string;
  feedbackDetail: string;
  updatedAt: number;
}

export interface QueuePreviewItem {
  id: string;
  title: string;
  detail: string;
  state: QueueItemState;
}

export interface PopupSnapshot {
  session: MockSessionState;
  activeSite: SiteDetectionState;
  queue: QueuePreviewItem[];
  tabTitle: string;
  refreshedAt: number;
}
