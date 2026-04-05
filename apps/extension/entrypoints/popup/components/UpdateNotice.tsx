import type { ExtensionUpdateState } from "../../../lib/iwatched/update-state";

interface UpdateNoticeProps {
  updateState: ExtensionUpdateState;
  onOpenUpdate: () => void;
}

export function UpdateNotice({ updateState, onOpenUpdate }: UpdateNoticeProps) {
  if (updateState.status !== "update_available") return null;

  return (
    <section className="update-notice" role="status">
      <div>
        <p className="update-notice__eyebrow">Update available</p>
        <strong className="update-notice__title">
          {updateState.latestVersion
            ? `Version ${updateState.latestVersion} is ready`
            : "A newer build is available"}
        </strong>
        <p className="update-notice__copy">
          You are on {updateState.currentVersion}. Install the latest build from iWatched so scrobbling stays in step with the current release.
        </p>
      </div>

      <button
        type="button"
        className="update-notice__button"
        onClick={onOpenUpdate}
      >
        View update
      </button>
    </section>
  );
}
