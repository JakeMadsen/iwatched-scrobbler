import { RatingComposer } from "../components/RatingComposer";
import type { PopupSessionState } from "../hooks/useIWatchedSession";
import type { ReviewQueueItem } from "../../../lib/iwatched/review-queue";

interface QueueViewProps {
  session: PopupSessionState;
  onRequireSignIn: () => void | Promise<void>;
  items: ReviewQueueItem[];
  isLoading: boolean;
  onDismiss: (id: string) => void | Promise<void>;
}

export function QueueView({
  session,
  onRequireSignIn,
  items,
  isLoading,
  onDismiss
}: QueueViewProps) {
  return (
    <section className="panel panel--main">
      <div className="panel__header">
        <div>
          <p className="panel__eyebrow">Queue</p>
          <h1 className="panel__title">Recently watched titles</h1>
        </div>
      </div>

      <p className="panel__body-copy">
        Titles you add to your iWatched timeline from this extension show up here, newest first, so you can rate or review them without crowding the live detection screen.
      </p>

      {isLoading ? (
        <div className="queue-empty">
          <strong>Loading recently watched titles</strong>
          <p>Checking the extension queue now.</p>
        </div>
      ) : !items.length ? (
        <div className="queue-empty">
          <strong>No recently watched titles yet</strong>
          <p>Add something to your timeline from the Status tab and it will appear here for rating and review.</p>
        </div>
      ) : (
        <div className="queue-review-list">
          {items.map((item) => (
            <RatingComposer
              key={item.id}
              item={item}
              session={session}
              onRequireSignIn={onRequireSignIn}
              onDismiss={onDismiss}
            />
          ))}
        </div>
      )}
    </section>
  );
}
