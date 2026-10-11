import {
  type ProfileGenerationActivity,
  ProfileGenerationSummary,
} from "./profile-generation-progress.js";

/** A long workspace operation that keeps running while the person moves between pages. */
export type WorkspaceActivity =
  | { readonly kind: "profile-generation"; readonly generation: ProfileGenerationActivity }
  | { readonly kind: "review-run"; readonly applicationName: string };

/**
 * The bar pinned to the bottom of the window while a long operation runs, on every page, so the
 * person always sees what is running and has one click back to it. The action is absent on the
 * page that already shows the operation.
 */
export function WorkspaceActivityBar({
  activity,
  onOpen,
}: {
  readonly activity: WorkspaceActivity;
  readonly onOpen?: () => void;
}) {
  return (
    <aside className="workspace-activity" aria-label="Workspace activity">
      <div className="workspace-activity-status" role="status">
        {activity.kind === "profile-generation" ? (
          <ProfileGenerationSummary
            activity={activity.generation}
            label="Generating your career profile…"
          />
        ) : (
          <p className="profile-generation-progress-row home-profile-progress">
            <span className="profile-generation-spinner" aria-hidden="true" />
            <strong>Review running</strong>
            <span>{activity.applicationName}</span>
          </p>
        )}
      </div>
      {onOpen === undefined ? null : (
        <button className="button button-outline" type="button" onClick={onOpen}>
          {activity.kind === "profile-generation" ? "View progress" : "Open review"}
        </button>
      )}
    </aside>
  );
}
