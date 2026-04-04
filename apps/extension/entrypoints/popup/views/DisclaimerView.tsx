import type { PopupSnapshot } from "../../../lib/types/popup-state";
import type { PopupSessionState } from "../hooks/useIWatchedSession";

interface DisclaimerViewProps {
  snapshot: PopupSnapshot;
  session: PopupSessionState;
}

export function DisclaimerView({ snapshot, session }: DisclaimerViewProps) {
  const detectionState = snapshot.activeSite.supported
    ? "Supported page detected"
    : "Waiting for a supported page";
  const connectionState = session.authenticated
    ? `${session.user?.handle || "@iwatched"} connected`
    : "Sign in required";
  const detectionCopy = snapshot.activeSite.supported
    ? "Live detection is ready as soon as the page exposes playback state."
    : "Open a supported streaming page and start playback to wake up live detection in the main view.";

  return (
    <section className="panel panel--main about-panel">
      <div className="panel__header">
        <div>
          <p className="panel__eyebrow">How</p>
          <h1 className="panel__title">How the extension works</h1>
        </div>
      </div>

      <p className="panel__body-copy">
        The popup stays focused on what is playing now. Detection happens on supported streaming pages, timeline entries are created once playback crosses the watch threshold, and Queue keeps recently watched titles ready for rating or review.
      </p>

      <div className="about-status">
        <article className="about-status__card">
          <span className="about-status__label">Connection</span>
          <strong>{connectionState}</strong>
          <p>
            {session.authenticated
              ? "Watched, scrobble, and review sync are available from this popup."
              : "Reconnect the extension before you keep watching if you want new activity to sync."}
          </p>
        </article>

        <article className="about-status__card">
          <span className="about-status__label">Live detection</span>
          <strong>{detectionState}</strong>
          <p>
            {detectionCopy}
          </p>
        </article>
      </div>

      <div className="about-steps">
        <article className="about-step">
          <span className="about-step__index">1</span>
          <div className="about-step__body">
            <strong>Detect playback</strong>
            <p>
              The extension reads the active tab and the playback metadata it needs to identify what you are watching on supported streaming pages.
            </p>
          </div>
        </article>

        <article className="about-step">
          <span className="about-step__index">2</span>
          <div className="about-step__body">
            <strong>Add it to your timeline</strong>
            <p>
              Once playback reaches the watch threshold, the extension creates a watch event on iWatched. Movies and specific episodes are the safe write targets here.
            </p>
          </div>
        </article>

        <article className="about-step">
          <span className="about-step__index">3</span>
          <div className="about-step__body">
            <strong>Review it later from Queue</strong>
            <p>
              Recently watched titles stay in Queue so you can rate or review them afterward without cluttering the live detection screen.
            </p>
          </div>
        </article>
      </div>

      <div className="about-note">
        <strong>Privacy and safety</strong>
        <p>
          The extension only reads the active tab URL, page title, and supported-site playback details needed for matching. Series-level matches stay read-only in the popup so it does not accidentally complete an entire show from an ambiguous page.
        </p>
      </div>

      <div className="about-note about-note--muted">
        <strong>Right now</strong>
        <p>
          Automatic detection is tuned for the currently supported services first. Additional services can be added behind the same playback and timeline flow later.
        </p>
      </div>
    </section>
  );
}
