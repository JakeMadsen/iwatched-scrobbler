import type { PopupSnapshot } from "../../../lib/types/popup-state";

interface QueueViewProps {
  snapshot: PopupSnapshot;
}

export function QueueView({ snapshot }: QueueViewProps) {
  return (
    <section className="panel panel--main">
      <div className="panel__header">
        <div>
          <p className="panel__eyebrow">Queue Preview</p>
          <h1 className="panel__title">Local scrobble preview</h1>
        </div>
      </div>

      <p className="panel__body-copy">
        This queue is generated locally from the active tab. Nothing is being sent to iWatched yet.
      </p>

      <div className="queue-list">
        {snapshot.queue.map((item) => (
          <article key={item.id} className={`queue-item queue-item--${item.state}`}>
            <span className="queue-item__marker" aria-hidden="true" />
            <div className="queue-item__body">
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
