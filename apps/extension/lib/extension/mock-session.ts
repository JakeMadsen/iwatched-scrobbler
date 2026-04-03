import type {
  PopupSnapshot,
  QueuePreviewItem,
  SiteDetectionState,
  MockSessionState
} from "../types/popup-state";

export const mockSession: MockSessionState = {
  connected: true,
  mode: "mock",
  displayName: "Preview Viewer",
  handle: "@preview",
  planLabel: "Mock Connected Session"
};

export function buildQueuePreview(activeSite: SiteDetectionState): QueuePreviewItem[] {
  const items: QueuePreviewItem[] = [];
  const queueTitle = activeSite.mediaType === "show" && activeSite.detectedEpisode
    ? `${activeSite.detectedTitle} - ${activeSite.detectedEpisode}`
    : activeSite.detectedTitle;

  if (activeSite.supported && queueTitle) {
    items.push({
      id: "current-prime-candidate",
      title: queueTitle,
      detail: activeSite.watchThresholdMet
        ? `Ready to mark watched. ${activeSite.watchThresholdReason || "Local watched rule met."}`
        : activeSite.isPlaying
          ? "Playback is active, but the watched threshold has not been met yet."
          : "Candidate found. Resume playback to keep tracking progress.",
      state: activeSite.watchThresholdMet ? "ready" : "hold"
    });
  }

  if (!items.length) {
    items.push({
      id: "empty-queue",
      title: "No scrobble candidates yet",
      detail: "Open Prime Video and start playback to see live detection feedback here.",
      state: "info"
    });
  }

  items.push({
    id: "prototype-info",
    title: "Prototype mode",
    detail: "Sign-in and API sync are intentionally mocked while the browser-side detection is being built.",
    state: "info"
  });

  return items;
}

export function createPopupSnapshot(
  activeSite: SiteDetectionState,
  tabTitle = ""
): PopupSnapshot {
  return {
    session: mockSession,
    activeSite,
    queue: buildQueuePreview(activeSite),
    tabTitle,
    refreshedAt: Date.now()
  };
}
