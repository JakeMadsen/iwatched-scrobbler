import type { PopupSnapshot } from "../../../lib/types/popup-state";

interface DisclaimerViewProps {
  snapshot: PopupSnapshot;
}

export function DisclaimerView({ snapshot }: DisclaimerViewProps) {
  return (
    <section className="panel panel--main">
      <div className="panel__header">
        <div>
          <p className="panel__eyebrow">How This Works</p>
          <h1 className="panel__title">Prototype disclaimer</h1>
        </div>
      </div>

      <div className="info-stack">
        <article className="info-card">
          <strong>What the prototype does</strong>
          <p>
            The popup checks the active tab, asks the Prime content script for title and player signals, and turns that into a local candidate preview.
          </p>
        </article>
        <article className="info-card">
          <strong>Prime Video only for now</strong>
          <p>
            Amazon Prime Video is the first target because it is the first service being tuned and tested. Other sites will come later behind separate adapters.
          </p>
        </article>
        <article className="info-card">
          <strong>No live account sync yet</strong>
          <p>
            The signed-in state is mocked so the UI and detection flow can be developed before the auth and API layers are attached.
          </p>
        </article>
        <article className="info-card">
          <strong>What the extension reads</strong>
          <p>
            In this prototype it only reads the active tab URL, the page title, and Prime page or player metadata needed to identify a likely watch candidate.
          </p>
        </article>
        <article className="info-card">
          <strong>Current active site</strong>
          <p>
            {snapshot.activeSite.supported
              ? `${snapshot.activeSite.siteLabel} is active at ${snapshot.activeSite.host}.`
              : "A non-supported site is active right now, so the extension is waiting for Prime Video."}
          </p>
        </article>
      </div>
    </section>
  );
}
