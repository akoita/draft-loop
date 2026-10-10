import {
  type RecentWorkspacesActions,
  RecentWorkspacesView,
  type RecentWorkspacesViewProps,
  useRecentWorkspaces,
} from "./recent-workspaces-ui.js";
import {
  WorkspaceAlternatives,
  WorkspaceCreationForm,
  type WorkspaceCreationFormProps,
} from "./workspace-creation.js";

interface WorkspaceStartLayoutProps {
  readonly busy: boolean;
  /** Absent when the host offers no way to create, open, or try the demo. */
  readonly form?: WorkspaceCreationFormProps;
  /** Null when the host has no recent-workspace history. */
  readonly recent: RecentWorkspacesViewProps | null;
}

/**
 * Most people keep working in one workspace, so once there is history the
 * page leads with reopening it and keeps creation one click away. With no
 * history, creating a workspace is the first thing to do.
 */
export function WorkspaceStartLayout({ busy, form, recent }: WorkspaceStartLayoutProps) {
  const reopenFirst =
    recent !== null &&
    (recent.loadState === "loading" ||
      (recent.workspaces.length > 0 && recent.errorMessage === null));
  if (!reopenFirst) {
    return (
      <>
        {form === undefined ? null : <WorkspaceCreationForm {...form} />}
        {recent === null ? null : <RecentWorkspacesView {...recent} />}
      </>
    );
  }
  return (
    <>
      <RecentWorkspacesView {...recent} highlightFirst />
      {form === undefined ? null : (
        <>
          <div className="approval-actions workspace-start-alternatives">
            <WorkspaceAlternatives
              busy={busy || recent.openingId !== null}
              onCreateDemo={form.onCreateDemo}
              onOpen={form.onOpen}
            />
          </div>
          <details className="workspace-create-section">
            <summary>Create a new workspace</summary>
            <WorkspaceCreationForm {...form} showAlternatives={false} />
          </details>
        </>
      )}
    </>
  );
}

function WorkspaceStartWithRecent({
  busy,
  form,
  recentActions,
}: {
  readonly busy: boolean;
  readonly form?: WorkspaceCreationFormProps;
  readonly recentActions: RecentWorkspacesActions;
}) {
  const recent = useRecentWorkspaces(recentActions);
  return (
    <WorkspaceStartLayout busy={busy} {...(form === undefined ? {} : { form })} recent={recent} />
  );
}

export function WorkspaceStart({
  busy,
  form,
  recentActions,
}: {
  readonly busy: boolean;
  readonly form?: WorkspaceCreationFormProps;
  readonly recentActions?: RecentWorkspacesActions;
}) {
  const formProps = form === undefined ? {} : { form };
  return recentActions === undefined ? (
    <WorkspaceStartLayout busy={busy} {...formProps} recent={null} />
  ) : (
    <WorkspaceStartWithRecent busy={busy} {...formProps} recentActions={recentActions} />
  );
}
