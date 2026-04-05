import { browser } from "wxt/browser";

import { useState } from "react";

import { IWATCHED_BASE_URL } from "../../lib/iwatched/client";
import type { PopupSnapshot } from "../../lib/types/popup-state";
import { AccountMenu } from "./components/AccountMenu";
import { BottomNav } from "./components/BottomNav";
import { UpdateNotice } from "./components/UpdateNotice";
import { useExtensionUpdateState } from "./hooks/useExtensionUpdateState";
import { useIWatchedSession } from "./hooks/useIWatchedSession";
import { usePopupSnapshot } from "./hooks/usePopupSnapshot";
import { useReviewQueue } from "./hooks/useReviewQueue";
import { DisclaimerView } from "./views/DisclaimerView";
import { QueueView } from "./views/QueueView";
import { SignInView } from "./views/SignInView";
import { StatusView } from "./views/StatusView";

type PopupView = "status" | "queue" | "about";

function formatLastSeen(snapshot: PopupSnapshot): string {
  const diffSeconds = Math.max(0, Math.round((Date.now() - snapshot.refreshedAt) / 1000));
  if (diffSeconds < 2) return "just now";
  return `${diffSeconds}s ago`;
}

export default function App() {
  const [view, setView] = useState<PopupView>("status");
  const { snapshot, isRefreshing } = usePopupSnapshot();
  const { updateState, hasUpdateAvailable } = useExtensionUpdateState();
  const {
    session,
    isRefreshing: isSessionRefreshing,
    openIWatched,
    openLogin,
    openLogout
  } = useIWatchedSession();
  const {
    items: reviewQueueItems,
    queueCount,
    isLoading: isQueueLoading,
    dismissItem
  } = useReviewQueue();

  const displayName = session.authenticated
    ? (session.user?.username || "iWatched User")
    : "Not signed in";
  const handle = session.authenticated
    ? `${session.user?.handle || "@iwatched"} · ${session.user?.plan || "free"} plan`
    : "Connect the extension to iWatched";
  const sessionBadge = session.authenticated
    ? "Connection active"
    : session.status === "loading"
      ? "Checking connection"
      : session.status === "error"
        ? "Connection unavailable"
        : "Sign in required";
  const subtitle = snapshot.activeSite.supported
    ? `${snapshot.activeSite.siteLabel} active - ${formatLastSeen(snapshot)}`
    : `Waiting for Prime or Plex - ${formatLastSeen(snapshot)}`;
  const sessionCopy = session.authenticated
    ? `${session.user?.handle || "@iwatched"} is ready for watched, scrobble, and review sync.`
    : session.status === "error"
      ? "The popup could not validate its iWatched connection right now."
      : "Sign in to connect this extension so watched, scrobble, and review sync can start.";
  const openUpdatePage = () => browser.tabs.create({
    url: updateState.detailsUrl || `${IWATCHED_BASE_URL}/scrobbler#downloads`
  });

  if (!session.authenticated) {
    return (
      <main className={`popup-shell popup-shell--signed-out ${hasUpdateAvailable ? "popup-shell--stacked" : ""}`.trim()}>
        <UpdateNotice updateState={updateState} onOpenUpdate={openUpdatePage} />
        <SignInView
          snapshot={snapshot}
          session={session}
          onSignIn={openLogin}
        />
      </main>
    );
  }

  return (
    <main className="popup-shell">
      <header className="hero-card">
        <div className="hero-card__topline">
          <div className="hero-card__brandmark" aria-label="iWatched Beta">
            <span className="th-logo__word">iWatched</span>
            <span className="th-badge">BETA</span>
          </div>

          <div className="hero-card__top-actions">
            <span className="hero-card__badge">{sessionBadge}</span>
            <AccountMenu
              connected={session.authenticated}
              displayName={displayName}
              handle={handle}
              onOpenIWatched={openIWatched}
              onSignIn={openLogin}
              onLogOut={openLogout}
            />
          </div>
        </div>

        <div className="hero-card__session">
          <div>
            <p className="hero-card__session-label">
              {session.authenticated ? "Connected iWatched account" : "Extension connection"}
            </p>
            <strong>{displayName}</strong>
            <span>{handle}</span>
          </div>

          <span className={`hero-card__pulse ${isRefreshing || isSessionRefreshing ? "is-live" : ""}`}>
            {isRefreshing || isSessionRefreshing
              ? "syncing"
              : session.authenticated
                ? "connected"
                : "local only"}
          </span>
        </div>

        <p className="hero-card__copy">{subtitle}. {sessionCopy}</p>
      </header>

      <section className="view-shell">
        {hasUpdateAvailable && (
          <UpdateNotice updateState={updateState} onOpenUpdate={openUpdatePage} />
        )}
        {view === "status" && (
          <StatusView
            snapshot={snapshot}
            session={session}
            onRequireSignIn={openLogin}
          />
        )}
        {view === "queue" && (
          <QueueView
            session={session}
            onRequireSignIn={openLogin}
            items={reviewQueueItems}
            isLoading={isQueueLoading}
            onDismiss={dismissItem}
          />
        )}
        {view === "about" && <DisclaimerView snapshot={snapshot} session={session} />}
      </section>

      <BottomNav activeView={view} onChange={setView} queueCount={queueCount} />
    </main>
  );
}
