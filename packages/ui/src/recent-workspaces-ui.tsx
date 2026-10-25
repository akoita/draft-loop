import { useEffect, useState } from "react";
import {
  parseRecentWorkspacesListResult,
  type RecentWorkspaceSummary,
} from "./recent-workspaces.js";

export type RecentWorkspacesLoadState = "loading" | "ready";

export interface RecentWorkspacesViewProps {
  readonly workspaces: readonly RecentWorkspaceSummary[];
  readonly busy: boolean;
  readonly loadState: RecentWorkspacesLoadState;
  readonly errorMessage: string | null;
  readonly statusMessage: string | null;
  readonly openingId: string | null;
  readonly onOpen: (id: string) => void;
  /** Present only when the host can forget a single entry. */
  readonly onRemove?: (id: string) => void;
  readonly onClear: () => void;
  /** Presents the most recent entry as the page's primary action. */
  readonly highlightFirst?: boolean;
}

export function RecentWorkspacesView({
  workspaces,
  busy,
  loadState,
  errorMessage,
  statusMessage,
  openingId,
  onOpen,
  onRemove,
  onClear,
  highlightFirst = false,
}: RecentWorkspacesViewProps) {
  return (
    <section className="panel recent-workspaces" aria-labelledby="recent-workspaces-heading">
      <div className="recent-workspaces-intro">
        <h2 id="recent-workspaces-heading">Recent workspaces</h2>
        <p>
          {highlightFirst
            ? "Continue where you left off, or pick another workspace. "
            : "Open a local workspace again. "}
          Removing entries from this list never deletes workspace files.
        </p>
        {statusMessage === null ? null : <p role="status">{statusMessage}</p>}
        {loadState === "loading" ? (
          <p role="status">Loading recent workspaces…</p>
        ) : errorMessage === null ? null : (
          <p className="setup-blocker" role="alert">
            {errorMessage}
          </p>
        )}
        {loadState === "ready" && errorMessage === null && workspaces.length === 0 ? (
          <p>No recent workspaces yet.</p>
        ) : null}
      </div>
      {workspaces.length === 0 ? null : (
        <ul className="recent-workspace-list">
          {workspaces.map((workspace, index) => (
            <li key={workspace.id}>
              <button
                className={
                  highlightFirst && index === 0
                    ? "button button-quiet recent-workspace-open recent-workspace-open-primary"
                    : "button button-quiet recent-workspace-open"
                }
                type="button"
                disabled={busy || openingId !== null}
                onClick={() => onOpen(workspace.id)}
              >
                <span className="recent-workspace-name">
                  {workspace.name}
                  {highlightFirst && index === 0 ? (
                    <span className="recent-workspace-badge">Last used</span>
                  ) : null}
                </span>
                <span className="recent-workspace-meta">
                  {workspace.location === undefined ? null : (
                    <span className="recent-workspace-location">in {workspace.location}</span>
                  )}
                  <time dateTime={workspace.lastOpenedAt}>
                    Last opened {new Date(workspace.lastOpenedAt).toLocaleString()}
                  </time>
                </span>
              </button>
              {onRemove === undefined ? null : (
                <button
                  className="button button-quiet recent-workspace-remove"
                  type="button"
                  aria-label={`Remove ${workspace.name} from recent workspaces`}
                  title="Remove from this list. Workspace files are kept."
                  disabled={busy || openingId !== null}
                  onClick={() => onRemove(workspace.id)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <button
        className="button button-quiet"
        type="button"
        disabled={busy || openingId !== null || workspaces.length === 0}
        onClick={onClear}
      >
        Clear recent workspaces
      </button>
    </section>
  );
}

export interface RecentWorkspacesActions {
  readonly busy: boolean;
  readonly listRecentWorkspaces: () => Promise<readonly RecentWorkspaceSummary[]>;
  readonly openRecentWorkspace: (id: string) => Promise<boolean>;
  readonly removeRecentWorkspace?: (id: string) => Promise<void>;
  readonly clearRecentWorkspaces: () => Promise<void>;
}

/** Loads the recent list and owns its open, remove, and clear flows. */
export function useRecentWorkspaces({
  busy,
  listRecentWorkspaces,
  openRecentWorkspace,
  removeRecentWorkspace,
  clearRecentWorkspaces,
}: RecentWorkspacesActions): RecentWorkspacesViewProps {
  const [workspaces, setWorkspaces] = useState<readonly RecentWorkspaceSummary[]>([]);
  const [loadState, setLoadState] = useState<RecentWorkspacesLoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [updatingList, setUpdatingList] = useState(false);

  useEffect(() => {
    let current = true;
    void listRecentWorkspaces()
      .then((result) => {
        const parsed = parseRecentWorkspacesListResult({ workspaces: result });
        if (!current) return;
        setWorkspaces(parsed.workspaces);
        setLoadState("ready");
      })
      .catch(() => {
        if (!current) return;
        setErrorMessage("Recent workspaces could not be loaded.");
        setLoadState("ready");
      });
    return () => {
      current = false;
    };
  }, [listRecentWorkspaces]);

  const open = async (id: string) => {
    if (busy || openingId !== null || updatingList) return;
    setOpeningId(id);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      if (!(await openRecentWorkspace(id))) {
        setErrorMessage("This recent workspace could not be opened. Choose a folder to open it.");
      }
    } catch {
      setErrorMessage("This recent workspace could not be opened. Choose a folder to open it.");
    } finally {
      setOpeningId(null);
    }
  };

  const remove = async (id: string) => {
    if (busy || openingId !== null || updatingList || removeRecentWorkspace === undefined) return;
    const name = workspaces.find((workspace) => workspace.id === id)?.name ?? "The workspace";
    setUpdatingList(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await removeRecentWorkspace(id);
      setWorkspaces((current) => current.filter((workspace) => workspace.id !== id));
      setStatusMessage(`${name} was removed from recent workspaces. Its files are unchanged.`);
    } catch {
      setErrorMessage("This recent workspace could not be removed from the list.");
    } finally {
      setUpdatingList(false);
    }
  };

  const clear = async () => {
    if (busy || openingId !== null || updatingList) return;
    setUpdatingList(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await clearRecentWorkspaces();
      setWorkspaces([]);
      setStatusMessage("Recent workspace history cleared. Workspace files are unchanged.");
    } catch {
      setErrorMessage("Recent workspace history could not be cleared.");
    } finally {
      setUpdatingList(false);
    }
  };

  return {
    workspaces,
    busy: busy || updatingList,
    loadState,
    errorMessage,
    statusMessage,
    openingId,
    onOpen: (id) => void open(id),
    ...(removeRecentWorkspace === undefined ? {} : { onRemove: (id: string) => void remove(id) }),
    onClear: () => void clear(),
  };
}
