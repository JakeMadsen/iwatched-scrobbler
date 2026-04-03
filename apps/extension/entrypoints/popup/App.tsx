import { useEffect, useState } from "react";

import type { PopupSnapshot } from "../../lib/types/popup-state";
import { AccountMenu } from "./components/AccountMenu";
import { BottomNav } from "./components/BottomNav";
import { usePopupSnapshot } from "./hooks/usePopupSnapshot";
import { DisclaimerView } from "./views/DisclaimerView";
import { QueueView } from "./views/QueueView";
import { StatusView } from "./views/StatusView";

type PopupView = "status" | "queue" | "about";

const MOCK_SESSION_STORAGE_KEY = "iwatched-scrobbler/mock-session";

function formatLastSeen(snapshot: PopupSnapshot): string {
  const diffSeconds = Math.max(0, Math.round((Date.now() - snapshot.refreshedAt) / 1000));
  if (diffSeconds < 2) return "just now";
  return `${diffSeconds}s ago`;
}

export default function App() {
  const [view, setView] = useState<PopupView>("status");
  const [mockConnected, setMockConnected] = useState(true);
  const { snapshot, isRefreshing } = usePopupSnapshot();

  useEffect(() => {
    const stored = window.localStorage.getItem(MOCK_SESSION_STORAGE_KEY);
    if (stored === "0") {
      setMockConnected(false);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(MOCK_SESSION_STORAGE_KEY, mockConnected ? "1" : "0");
  }, [mockConnected]);

  const displayName = mockConnected ? snapshot.session.displayName : "Extension Guest";
  const handle = mockConnected ? snapshot.session.handle : "Sign in to sync later";
  const subtitle = snapshot.activeSite.supported
    ? `${snapshot.activeSite.siteLabel} active - ${formatLastSeen(snapshot)}`
    : `Waiting for Prime - ${formatLastSeen(snapshot)}`;

  return (
    <main className="popup-shell">
      <header className="hero-card">
        <div className="hero-card__topline">
          <div className="hero-card__brandmark" aria-label="iWatched Beta">
            <span className="th-logo__word">iWatched</span>
            <span className="th-badge">BETA</span>
          </div>

          <div className="hero-card__top-actions">
            <span className="hero-card__badge">
              {mockConnected ? "Mock connected" : "Signed out"}
            </span>
            <AccountMenu
              connected={mockConnected}
              displayName={displayName}
              handle={handle}
              onSignIn={() => setMockConnected(true)}
              onLogOut={() => setMockConnected(false)}
            />
          </div>
        </div>

        <div className="hero-card__session">
          <div>
            <p className="hero-card__session-label">
              {mockConnected ? "Signed in for UI work" : "Local preview mode"}
            </p>
            <strong>{displayName}</strong>
            <span>{handle}</span>
          </div>

          <span className={`hero-card__pulse ${isRefreshing ? "is-live" : ""}`}>
            {mockConnected
              ? (isRefreshing ? "refreshing" : "connected")
              : "detector only"}
          </span>
        </div>

        <p className="hero-card__copy">{subtitle}</p>
      </header>

      <section className="view-shell">
        {view === "status" && <StatusView snapshot={snapshot} />}
        {view === "queue" && <QueueView snapshot={snapshot} />}
        {view === "about" && <DisclaimerView snapshot={snapshot} />}
      </section>

      <BottomNav activeView={view} onChange={setView} />
    </main>
  );
}
