import { browser } from "wxt/browser";

import type { PopupSnapshot } from "../../../lib/types/popup-state";

interface StatusViewProps {
  snapshot: PopupSnapshot;
}

function formatRuntime(totalSeconds: number | null): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return "--:--";
  }

  const rounded = Math.floor(totalSeconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatMediaMeta(snapshot: PopupSnapshot): string {
  const site = snapshot.activeSite;

  if (site.mediaType === "show") {
    const pieces: string[] = [];
    if (site.seasonNumber != null) pieces.push(`Season ${site.seasonNumber}`);
    if (site.episodeNumber != null) pieces.push(`Episode ${site.episodeNumber}`);
    if (!pieces.length && site.episodeTitle) pieces.push("Series");
    return pieces.join(" · ") || "Series";
  }

  if (site.mediaType === "movie") return "Movie";
  return snapshot.tabTitle || "Unknown";
}

export function StatusView({ snapshot }: StatusViewProps) {
  const site = snapshot.activeSite;
  const statusClass = site.supported ? "is-supported" : "is-unsupported";
  const progressLabel =
    site.playbackPositionSeconds == null
      ? "No playback position yet"
      : site.durationSeconds && site.durationSeconds > 0
        ? `${formatRuntime(site.playbackPositionSeconds)} / ${formatRuntime(site.durationSeconds)}`
        : formatRuntime(site.playbackPositionSeconds);
  const playbackLabel = site.isPlaying
    ? "Playing"
    : site.videoPresent && (site.playbackPositionSeconds ?? 0) > 0
      ? "Paused"
      : site.videoPresent
        ? "Player ready"
        : "Idle";
  const playbackMeta = !site.videoPresent
    ? "Waiting for player"
    : site.playbackSource === "overlay"
      ? "Overlay timecode"
      : "Video element";
  const thresholdNote = site.watchThresholdMet
    ? `Ready to mark watched - ${site.watchThresholdReason || "local watched rule met"}`
    : "Marks watched at 90% runtime or with 10 minutes left.";
  const candidateMeta = site.detectedEpisode || (site.mediaType === "movie" ? "Movie" : "Film or episode details pending.");
  const progressWidth =
    site.playbackPositionSeconds != null && site.durationSeconds && site.durationSeconds > 0
      ? Math.max(6, Math.min(100, Math.round((site.playbackPositionSeconds / site.durationSeconds) * 100)))
      : 6;
  const openLabel = site.iwatchedMatchType === "search"
    ? "Search on iWatched"
    : "Open on iWatched";

  const openOnIWatched = async () => {
    if (!site.iwatchedUrl) return;
    await browser.tabs.create({ url: site.iwatchedUrl });
  };

  return (
    <section className="panel panel--main">
      <div className="panel__header">
        <div>
          <p className="panel__eyebrow">Live Detection</p>
          <h1 className="panel__title">{site.feedbackTitle}</h1>
        </div>
        <span className={`status-chip ${statusClass}`}>
          {site.supported ? site.siteLabel : "Unsupported"}
        </span>
      </div>

      <p className="panel__body-copy">{site.feedbackDetail}</p>

      <article className="detected-card">
        <div className="detected-card__poster">
          <span>{site.siteKey === "prime" ? "P" : "?"}</span>
        </div>

        <div className="detected-card__body">
          <span className="detected-card__label">Current candidate</span>
          <h2 className="detected-card__title">
            {site.detectedTitle || "Nothing locked yet"}
          </h2>
          <p className="detected-card__meta">
            {candidateMeta}
          </p>
        </div>
      </article>

      <div className="candidate-actions">
        <button
          type="button"
          className="candidate-actions__button"
          onClick={openOnIWatched}
          disabled={!site.iwatchedUrl}
        >
          {openLabel}
        </button>
        <span className="candidate-actions__hint">
          {site.iwatchedMatchType === "resolved"
            ? "Exact iWatched page"
            : site.iwatchedMatchType === "search"
              ? "Search fallback"
              : "Waiting for a match"}
        </span>
      </div>

      <div className="progress-card">
        <div className="progress-card__topline">
          <span>Playback position</span>
          <strong>{progressLabel}</strong>
        </div>
        <div className="progress-card__bar" aria-hidden="true">
          <span
            className="progress-card__fill"
            style={{ width: `${progressWidth}%` }}
          />
        </div>
        <p className={`progress-card__note ${site.watchThresholdMet ? "is-ready" : ""}`}>
          {thresholdNote}
        </p>
      </div>

      <div className="signal-grid">
        <article className="signal-tile">
          <span className="signal-tile__label">Website</span>
          <strong>{site.siteLabel}</strong>
          <span className="signal-tile__meta">{site.host || "No active host"}</span>
        </article>
        <article className="signal-tile">
          <span className="signal-tile__label">Media</span>
          <strong>{site.mediaType === "show" ? (site.seriesTitle || "Series") : site.mediaType === "movie" ? "Movie" : "Unknown"}</strong>
          <span className="signal-tile__meta">{formatMediaMeta(snapshot)}</span>
        </article>
        <article className="signal-tile">
          <span className="signal-tile__label">Playback</span>
          <strong>{playbackLabel}</strong>
          <span className="signal-tile__meta">{playbackMeta}</span>
        </article>
      </div>
    </section>
  );
}
