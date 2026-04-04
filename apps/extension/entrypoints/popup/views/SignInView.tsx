import type { PopupSnapshot } from "../../../lib/types/popup-state";
import type { PopupSessionState } from "../hooks/useIWatchedSession";

interface SignInViewProps {
  snapshot: PopupSnapshot;
  session: PopupSessionState;
  onSignIn: () => void | Promise<void>;
}

function buildCopy(snapshot: PopupSnapshot, session: PopupSessionState): string {
  if (session.status === "loading") {
    return "Checking whether this browser already has an active iWatched extension connection.";
  }

  if (session.status === "error") {
    return "Your iWatched connection could not be confirmed. Sign in again before you keep watching so new activity can sync.";
  }

  if (snapshot.activeSite.supported) {
    return `Sign in before you keep watching on ${snapshot.activeSite.siteLabel} so this title actually gets registered on iWatched.`;
  }

  return "Sign in to connect this extension so watched titles, scrobbles, and reviews can sync to iWatched.";
}

export function SignInView({ snapshot, session, onSignIn }: SignInViewProps) {
  const statusLabel = session.status === "loading"
    ? "Checking connection"
    : session.status === "error"
      ? "Connection unavailable"
      : "Signed out";

  return (
    <section className="auth-card">
      <div className="auth-card__topline">
        <div className="hero-card__brandmark" aria-label="iWatched Beta">
          <span className="th-logo__word">iWatched</span>
          <span className="th-badge">BETA</span>
        </div>

        <span className="hero-card__badge">{statusLabel}</span>
      </div>

      <div className="auth-card__body">
        <p className="auth-card__eyebrow">Connection required</p>
        <h1 className="auth-card__title">Sign in</h1>
        <p className="auth-card__copy">{buildCopy(snapshot, session)}</p>

        <button
          type="button"
          className="auth-card__button"
          onClick={() => {
            void onSignIn();
          }}
        >
          Sign in
        </button>
      </div>
    </section>
  );
}
