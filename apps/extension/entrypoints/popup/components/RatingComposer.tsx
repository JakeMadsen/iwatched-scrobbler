import { useEffect, useRef, useState } from "react";

import { iwatchedApi } from "../../../lib/iwatched/client";
import type { ReviewQueueItem } from "../../../lib/iwatched/review-queue";
import { buildReviewQueueTarget } from "../../../lib/iwatched/review-queue";
import type { PopupSessionState } from "../hooks/useIWatchedSession";

const DRAFT_STORAGE_KEY = "iwatched-scrobbler/rating-drafts";

interface RatingComposerProps {
  item: ReviewQueueItem;
  session: PopupSessionState;
  onRequireSignIn: () => void | Promise<void>;
  onDismiss: (id: string) => void | Promise<void>;
}

interface DraftState {
  rating: number;
  body: string;
}

interface SyncNotice {
  tone: "neutral" | "success" | "error";
  text: string;
}

interface RemoteReviewState {
  rating: number;
  body: string;
  hasReview: boolean;
}

const EMPTY_DRAFT: DraftState = {
  rating: 0,
  body: ""
};

function clampRating(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(5, Math.round(value * 2) / 2));
}

function formatRating(value: number): string {
  return value > 0 ? `${value.toFixed(1)} / 5` : "Not rated";
}

function buildDraftKey(item: ReviewQueueItem): string {
  return JSON.stringify([
    "tmdb",
    item.itemType,
    item.tmdbId,
    item.seasonNumber ?? null,
    item.episodeNumber ?? null
  ]);
}

function parseDraftState(value: unknown): DraftState {
  if (!value || typeof value !== "object") return EMPTY_DRAFT;

  const candidate = value as Partial<DraftState>;

  return {
    rating: clampRating(Number(candidate.rating || 0)),
    body: typeof candidate.body === "string" ? candidate.body : ""
  };
}

function readDraftMap(): Record<string, DraftState> {
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};

    return Object.entries(parsed).reduce<Record<string, DraftState>>((next, [key, value]) => {
      next[key] = parseDraftState(value);
      return next;
    }, {});
  } catch (_) {
    return {};
  }
}

function writeDraftMap(next: Record<string, DraftState>): void {
  try {
    const keys = Object.keys(next);
    if (!keys.length) {
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(next));
  } catch (_) {
    // Ignore local draft persistence issues.
  }
}

function clearDraftState(draftKey: string): void {
  const nextMap = readDraftMap();
  delete nextMap[draftKey];
  writeDraftMap(nextMap);
}

function subjectLabel(item: ReviewQueueItem): string {
  if (item.itemType === "movie") return "movie";
  if (item.itemType === "episode") return "episode";
  if (item.itemType === "season") return "season";
  if (item.itemType === "show") return "series";
  return "title";
}

function starFillPercent(value: number, starIndex: number): number {
  const starValue = starIndex + 1;
  if (value >= starValue) return 100;
  if (value >= starValue - 0.5) return 50;
  return 0;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function normalizeRemoteReview(review: unknown): RemoteReviewState {
  if (!review || typeof review !== "object") {
    return {
      rating: 0,
      body: "",
      hasReview: false
    };
  }

  const candidate = review as Record<string, unknown>;
  const rating = clampRating(Number(candidate.stars || 0));
  const body = typeof candidate.text === "string" ? candidate.text : "";
  const hasReview = rating > 0 || body.trim().length > 0;

  return {
    rating,
    body,
    hasReview
  };
}

function formatWatchedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "just now";

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function RatingComposer({
  item,
  session,
  onRequireSignIn,
  onDismiss
}: RatingComposerProps) {
  const target = buildReviewQueueTarget(item);
  const targetKey = JSON.stringify([
    target.itemType,
    target.tmdbId,
    target.seasonNumber ?? null,
    target.episodeNumber ?? null
  ]);
  const draftKey = buildDraftKey(item);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [body, setBody] = useState("");
  const [remoteReview, setRemoteReview] = useState<RemoteReviewState | null>(null);
  const [isRemoteLoading, setIsRemoteLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<SyncNotice | null>(null);
  const dirtyRef = useRef(false);

  const updateRating = (next: number) => {
    dirtyRef.current = true;
    setHoverRating(null);
    setRating(clampRating(next));
  };

  const updateBody = (next: string) => {
    dirtyRef.current = true;
    setBody(next);
  };

  useEffect(() => {
    const next = readDraftMap()[draftKey] || EMPTY_DRAFT;
    dirtyRef.current = false;
    setRating(next.rating);
    setHoverRating(null);
    setBody(next.body);
  }, [draftKey]);

  useEffect(() => {
    const trimmed = body.trim();
    const nextMap = readDraftMap();

    if (rating <= 0 && !trimmed) {
      delete nextMap[draftKey];
    } else {
      nextMap[draftKey] = {
        rating,
        body
      };
    }

    writeDraftMap(nextMap);
  }, [body, draftKey, rating]);

  useEffect(() => {
    let cancelled = false;
    setNotice(null);

    if (!session.authenticated) {
      setRemoteReview(null);
      setIsRemoteLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setIsRemoteLoading(true);

    void (async () => {
      try {
        const response = await iwatchedApi.getReview(target);
        if (cancelled) return;

        const normalized = normalizeRemoteReview(response.review);
        setRemoteReview(normalized.hasReview ? normalized : null);

        const localDraft = readDraftMap()[draftKey];
        if (!localDraft && !dirtyRef.current) {
          setRating(normalized.rating);
          setBody(normalized.body);
        }
      } catch (_) {
        if (!cancelled) {
          setRemoteReview(null);
        }
      } finally {
        if (!cancelled) {
          setIsRemoteLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [draftKey, session.authenticated, targetKey]);

  const displayRating = hoverRating ?? rating;
  const trimmedBody = body.trim();
  const hasReviewText = trimmedBody.length > 0;
  const canSubmit = rating > 0 || hasReviewText;
  const syncBadge = !session.authenticated
    ? "Sign in required"
    : remoteReview?.hasReview
      ? "Live review"
      : "Ready to sync";
  const syncCopy = !session.authenticated
    ? `This draft is ready for ${item.title}. Sign in again when you want to push it to iWatched.`
    : isRemoteLoading
      ? `Loading the current iWatched review for ${item.title}.`
      : remoteReview?.hasReview
        ? `You already have a review saved for ${item.title}, and you can update it here.`
        : `Would you like to review or rate this title?`;
  const syncStatus = notice
    ? notice
    : !session.authenticated
      ? { tone: "neutral" as const, text: "Sign in to save this review to iWatched." }
      : remoteReview?.hasReview
        ? { tone: "neutral" as const, text: "This card is connected to your current iWatched review." }
        : { tone: "neutral" as const, text: "Pick a rating and add text only if you want to post a full review." };
  const primaryLabel = !session.authenticated
    ? "Sign in to sync"
    : isSaving
      ? "Posting..."
      : hasReviewText
        ? "Post Review"
        : "Post Rating";

  const resolvePointerRating = (
    index: number,
    event: React.MouseEvent<HTMLButtonElement>
  ): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const wholeStar = offsetX > rect.width / 2 ? 1 : 0.5;
    return clampRating(index + wholeStar);
  };

  const updateRatingFromKeyboard = (
    event: React.KeyboardEvent<HTMLButtonElement>
  ) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      updateRating(rating - 0.5);
      return;
    }

    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      updateRating(rating + 0.5);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      updateRating(0.5);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      updateRating(5);
      return;
    }

    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      updateRating(0);
    }
  };

  const handlePrimaryAction = async () => {
    if (!session.authenticated) {
      setNotice({
        tone: "neutral",
        text: "Reconnect the extension to iWatched and then save again."
      });
      void onRequireSignIn();
      return;
    }

    if (!canSubmit) {
      setNotice({
        tone: "neutral",
        text: "Add a rating before posting this title."
      });
      return;
    }

    if (hasReviewText && rating <= 0) {
      setNotice({
        tone: "error",
        text: "Add a star rating before saving a written review."
      });
      return;
    }

    setIsSaving(true);
    setNotice(null);
    let dismissAfterSave = false;

    try {
      const response = await iwatchedApi.upsertReview({
        ...target,
        rating,
        body: trimmedBody
      });

      if (response.removed) {
        dirtyRef.current = false;
        clearDraftState(draftKey);
        setRating(0);
        setBody("");
        setRemoteReview(null);
        setNotice({
          tone: "success",
          text: "Removed the review from iWatched."
        });
      } else {
        dirtyRef.current = false;
        clearDraftState(draftKey);
        dismissAfterSave = true;
      }
    } catch (error) {
      setNotice({
        tone: "error",
        text: getErrorMessage(error, "Could not save the review to iWatched.")
      });
    } finally {
      setIsSaving(false);
    }

    if (dismissAfterSave) {
      await onDismiss(item.id);
    }
  };

  const handleReset = () => {
    dirtyRef.current = true;
    setHoverRating(null);
    setRating(0);
    setBody("");
    setNotice({
      tone: "neutral",
      text: remoteReview?.hasReview
        ? "Cleared the local draft. Add a new rating or review if you want to post an update."
        : "Cleared the local draft."
    });
  };

  const handleDismiss = async () => {
    clearDraftState(draftKey);
    await onDismiss(item.id);
  };

  return (
    <section className="composer-card composer-card--queue">
      <div className="composer-card__header">
        <div>
          <p className="panel__eyebrow">Awaiting review</p>
          <h3 className="composer-card__title">{item.title}</h3>
        </div>

        <div className="composer-card__actions">
          <span className="composer-card__badge">{syncBadge}</span>
          <button
            type="button"
            className="composer-card__dismiss"
            onClick={() => {
              void handleDismiss();
            }}
          >
            Disregard
          </button>
        </div>
      </div>

      <p className="composer-card__copy">{syncCopy}</p>

      <div className="composer-card__meta">
        <span>{item.subtitle || `${item.siteLabel} watch`}</span>
        <span>{item.siteLabel} · {formatWatchedAt(item.watchedAt)}</span>
      </div>

      <div className="composer-rating">
        <div className="composer-rating__row">
          <span className="composer-rating__label">Your rating</span>

          <div
            className="composer-stars"
            role="radiogroup"
            aria-label="Draft rating"
            onMouseLeave={() => setHoverRating(null)}
          >
            {Array.from({ length: 5 }, (_, index) => {
              const fill = starFillPercent(displayRating, index);
              const buttonValue = index + 1;

              return (
                <button
                  key={buttonValue}
                  type="button"
                  className="composer-stars__button"
                  aria-label={`Rate ${buttonValue} star${buttonValue === 1 ? "" : "s"}`}
                  onMouseMove={(event) => setHoverRating(resolvePointerRating(index, event))}
                  onClick={(event) => {
                    updateRating(resolvePointerRating(index, event));
                  }}
                  onKeyDown={updateRatingFromKeyboard}
                >
                  <span className="composer-stars__icon" aria-hidden="true">
                    <span className="composer-stars__empty">★</span>
                    <span className="composer-stars__fill" style={{ width: `${fill}%` }}>
                      ★
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <strong className="composer-rating__value">{formatRating(displayRating)}</strong>
        </div>

        <p className="composer-rating__meta">
          {remoteReview?.hasReview
            ? `Editing your saved ${subjectLabel(item)} review.`
            : `Leave the text field empty if you only want to post the rating.`}
        </p>
      </div>

      <div className="composer-copy">
        <div className="composer-copy__topline">
          <label className="composer-copy__label" htmlFor={`rating-composer-body-${item.id}`}>
            Review draft
          </label>
        </div>

        <textarea
          id={`rating-composer-body-${item.id}`}
          className="composer-copy__textarea"
          rows={4}
          value={body}
          placeholder={`Write a full review for ${item.title}, or leave this blank to post the rating only.`}
          onChange={(event) => updateBody(event.target.value)}
        />

        <div className="composer-actions">
          <button
            type="button"
            className="composer-actions__button"
            onClick={handleReset}
          >
            Clear draft
          </button>

          <button
            type="button"
            className="composer-actions__button composer-actions__button--primary"
            disabled={isSaving || (session.authenticated && !canSubmit)}
            onClick={() => {
              void handlePrimaryAction();
            }}
          >
            {primaryLabel}
          </button>
        </div>

        <div className="composer-copy__footer">
          <p className="composer-copy__hint">
            Posting from here sends it to iWatched and then removes the title from Queue.
          </p>
          <span className={`composer-copy__status is-${syncStatus.tone}`}>
            {syncStatus.text}
          </span>
        </div>
      </div>
    </section>
  );
}
