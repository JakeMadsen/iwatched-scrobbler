import type { PopupSnapshot, SiteDetectionState } from "../types/popup-state";

export function createPopupSnapshot(
  activeSite: SiteDetectionState,
  tabTitle = ""
): PopupSnapshot {
  return {
    activeSite,
    tabTitle,
    refreshedAt: Date.now()
  };
}
