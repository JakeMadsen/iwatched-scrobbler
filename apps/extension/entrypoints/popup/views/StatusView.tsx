import { useEffect, useState } from "react";
import { browser } from "wxt/browser";

import type { WatchedStateResponse } from "@iwatched-scrobbler/api-client";

import { MESSAGE_MARK_ACTIVE_PLAYBACK_SCROBBLED } from "../../../lib/extension/messages";
import type { PopupSnapshot } from "../../../lib/types/popup-state";
import { buildApiTarget, buildScrobbleInput, iwatchedApi } from "../../../lib/iwatched/client";
import { enqueueReviewFromSite } from "../../../lib/iwatched/review-queue";
import type { PopupSessionState } from "../hooks/useIWatchedSession";

interface StatusViewProps {
  snapshot: PopupSnapshot;
  session: PopupSessionState;
  onRequireSignIn: () => void | Promise<void>;
}

interface ActionNotice {
  tone: "neutral" | "success" | "error";
  text: string;
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

function formatSavedAt(value: string | null): string {
  if (!value) return "No watched timestamp yet";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Saved on iWatched";

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function buildCandidateMeta(snapshot: PopupSnapshot): string {
  const site = snapshot.activeSite;
  const parts: string[] = [];

  if (site.detectedEpisode) {
    parts.push(site.detectedEpisode);
  } else if (site.mediaType === "movie") {
    parts.push("Movie");
  } else if (site.mediaType === "show") {
    parts.push("Series");
  }

  if (site.releaseYear != null) {
    parts.push(String(site.releaseYear));
  }

  return parts.join(" · ") || snapshot.tabTitle || "Detecting title details";
}

export function StatusView({ snapshot, session, onRequireSignIn }: StatusViewProps) {
  const site = snapshot.activeSite;
  const target = buildApiTarget(site);
  const hasPlaybackSignal = site.supported && site.videoPresent && (
    site.isPlaying ||
    site.playbackPositionSeconds != null ||
    site.durationSeconds != null ||
    site.playbackSource !== "none"
  );
  const canSyncPlaybackTarget = !!target && (target.itemType === "movie" || target.itemType === "episode");
  const targetKey = target
    ? JSON.stringify([
        target.itemType,
        target.tmdbId,
        target.seasonNumber ?? null,
        target.episodeNumber ?? null
      ])
    : "";
  const siteMark = site.siteKey === "prime" ? "PV" : site.siteKey === "plex" ? "PX" : "?";
  const statusClass = site.supported ? "is-supported" : "is-unsupported";
  const [watchedState, setWatchedState] = useState<WatchedStateResponse | null>(null);
  const [isWatchedLoading, setIsWatchedLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<ActionNotice | null>(null);

  const progressLabel =
    site.playbackPositionSeconds == null
      ? "No playback position yet"
      : site.durationSeconds && site.durationSeconds > 0
        ? `${formatRuntime(site.playbackPositionSeconds)} / ${formatRuntime(site.durationSeconds)}`
        : formatRuntime(site.playbackPositionSeconds);
  const progressWidth =
    site.playbackPositionSeconds != null && site.durationSeconds && site.durationSeconds > 0
      ? Math.max(6, Math.min(100, Math.round((site.playbackPositionSeconds / site.durationSeconds) * 100)))
      : 6;
  const playbackLabel = site.isPlaying
    ? "Playing"
    : site.videoPresent && (site.playbackPositionSeconds ?? 0) > 0
      ? "Paused"
      : "Player ready";
  const thresholdNote = site.watchThresholdMet
    ? `Playback threshold met${site.watchThresholdReason ? `: ${site.watchThresholdReason.toLowerCase()}` : "."}`
    : "This playback will auto-add to your timeline once it reaches the watch threshold. You can still add it early if you want.";
  const openLabel = site.iwatchedMatchType === "search"
    ? "Search on iWatched"
    : "Open on iWatched";
  const matchLabel = !site.iwatchedUrl
    ? "Looking for iWatched match"
    : !target
      ? "Search match only"
      : "Matched on iWatched";
  const watchedBadge = watchedState?.watched
    ? `Watched ${watchedState.watched_count}x`
    : null;

  const openOnIWatched = async () => {
    if (!site.iwatchedUrl) return;
    await browser.tabs.create({ url: site.iwatchedUrl });
  };

  useEffect(() => {
    let cancelled = false;
    setNotice(null);

    if (!hasPlaybackSignal || !session.authenticated || !target || !canSyncPlaybackTarget) {
      setWatchedState(null);
      setIsWatchedLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setIsWatchedLoading(true);

    void (async () => {
      try {
        const next = await iwatchedApi.getWatched(target);
        if (!cancelled) {
          setWatchedState(next);
        }
      } catch (_) {
        if (!cancelled) {
          setWatchedState(null);
        }
      } finally {
        if (!cancelled) {
          setIsWatchedLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canSyncPlaybackTarget, hasPlaybackSignal, session.authenticated, targetKey]);

  const refreshWatchedState = async (): Promise<WatchedStateResponse | null> => {
    if (!target || !canSyncPlaybackTarget || !session.authenticated) {
      setWatchedState(null);
      return null;
    }

    const next = await iwatchedApi.getWatched(target);
    setWatchedState(next);
    return next;
  };

  const handleScrobble = async () => {
    const watchedAt = new Date().toISOString();
    const input = buildScrobbleInput(site, { watchedAt });
    if (!input || !canSyncPlaybackTarget) return;
    if (!session.authenticated) {
      setNotice({
        tone: "neutral",
        text: "Sign in first so the extension can send scrobbles to iWatched."
      });
      void onRequireSignIn();
      return;
    }

    setIsSubmitting(true);
    setNotice(null);

    try {
      const result = await iwatchedApi.scrobble(input);
      await browser.runtime.sendMessage({
        type: MESSAGE_MARK_ACTIVE_PLAYBACK_SCROBBLED
      }).catch(() => null);
      await refreshWatchedState();
      const queuedReview = await enqueueReviewFromSite(site, watchedAt);
      setNotice({
        tone: "success",
        text: result.duplicate
          ? (queuedReview
            ? "That watch event was already on iWatched. It is ready in Queue if you want to rate it."
            : "That watch event was already on iWatched.")
          : (queuedReview
            ? "Added to your iWatched timeline. You can rate or review it from Queue."
            : "Added to your iWatched timeline.")
      });
    } catch (error) {
      setNotice({
        tone: "error",
        text: getErrorMessage(error, "Could not send the scrobble.")
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!hasPlaybackSignal) {
    return (
      <section className="panel panel--main panel--waiting">
        <p className="panel__eyebrow">Live Detection</p>
        <h1 className="panel__title">Waiting for streaming service</h1>
        <p className="panel__body-copy">
          Start playback on Prime Video, Plex, or another supported service and live detection will appear here once the player is active.
        </p>
      </section>
    );
  }

  const watchedSummary = !site.iwatchedUrl
    ? "Trying to find the right iWatched title for this playback."
    : !target
      ? "A search page is ready, but the extension still needs a safe movie or episode match before it can log the event."
      : !session.authenticated
        ? "Sign in to connect the extension before reading watched state or sending writes."
        : target.itemType === "show"
          ? "Series-level matches stay read-only here so the popup does not accidentally complete an entire show."
          : target.itemType === "season"
            ? "Season pages stay read-only here. Timeline logging is limited to movies and episodes."
            : isWatchedLoading
              ? "Checking the current watched state on iWatched."
              : watchedState?.watched
                ? `Already tracked ${watchedState.watched_count} time${watchedState.watched_count === 1 ? "" : "s"} on iWatched. Last saved ${formatSavedAt(watchedState.watched_at)}.`
                : "Ready to create a watch event on iWatched. That timeline entry will also update watched state.";
  const primaryActionLabel = !target
    ? "Waiting for match"
    : !session.authenticated
      ? "Sign in to sync"
      : !canSyncPlaybackTarget
        ? "Playback sync unavailable"
        : isSubmitting
          ? "Adding to timeline..."
          : "Add to timeline";
  const isPrimaryDisabled = !target || (session.authenticated && !canSyncPlaybackTarget) || isSubmitting;

  return (
    <section className="panel panel--main panel--live">
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

      <div className="live-summary">
        <div className="live-summary__poster">
          <span>{siteMark}</span>
        </div>

        <div className="live-summary__body">
          <p className="live-summary__eyebrow">{site.siteLabel} · {playbackLabel}</p>
          <h2 className="live-summary__title">{site.detectedTitle || "Nothing locked yet"}</h2>
          <p className="live-summary__meta">{buildCandidateMeta(snapshot)}</p>
        </div>
      </div>

      <div className="live-pills">
        <span className={`live-pill ${target ? "is-ok" : "is-neutral"}`}>{matchLabel}</span>
        {watchedBadge && <span className="live-pill is-muted">{watchedBadge}</span>}
      </div>

      <div className="live-progress">
        <div className="live-progress__topline">
          <span>Playback position</span>
          <strong>{progressLabel}</strong>
        </div>

        <div className="live-progress__bar" aria-hidden="true">
          <span
            className="live-progress__fill"
            style={{ width: `${progressWidth}%` }}
          />
        </div>

        <p className={`live-progress__note ${site.watchThresholdMet ? "is-ready" : ""}`}>
          {thresholdNote}
        </p>
      </div>

      <p className="live-sync-copy">{watchedSummary}</p>

      <div className="sync-actions sync-actions--flat">
        <button
          type="button"
          className="sync-actions__button sync-actions__button--primary"
          onClick={() => {
            if (!session.authenticated) {
              setNotice({
                tone: "neutral",
                text: "Connect the extension to iWatched and then try again."
              });
              void onRequireSignIn();
              return;
            }

            void handleScrobble();
          }}
          disabled={isPrimaryDisabled}
        >
          {primaryActionLabel}
        </button>

        <button
          type="button"
          className="sync-actions__button"
          onClick={openOnIWatched}
          disabled={!site.iwatchedUrl}
        >
          {openLabel}
        </button>
      </div>

      {notice && (
        <p className={`sync-card__status is-${notice.tone}`}>
          {notice.text}
        </p>
      )}
    </section>
  );
}
