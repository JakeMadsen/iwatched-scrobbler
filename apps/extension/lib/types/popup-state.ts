export type SiteKey = "prime" | "plex" | "unsupported";
export type DetectedMediaType = "movie" | "show" | "unknown";
export type IWatchedMatchType = "resolved" | "search" | "none";
export type IWatchedTargetType = "movie" | "show" | "season" | "episode" | null;

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
  releaseYear: number | null;
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
  iwatchedTmdbId: string | null;
  iwatchedTargetType: IWatchedTargetType;
  feedbackTitle: string;
  feedbackDetail: string;
  updatedAt: number;
}

export interface PopupSnapshot {
  activeSite: SiteDetectionState;
  tabTitle: string;
  refreshedAt: number;
}
