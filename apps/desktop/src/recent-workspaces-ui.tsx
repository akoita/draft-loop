import { useEffect, useState } from "react";
import {
  parseRecentWorkspacesListResult,
  type RecentWorkspaceSummary,
} from "./recent-workspaces.js";

type LoadState = "loading" | "ready";

interface RecentWorkspacesViewProps {
  readonly workspaces: readonly RecentWorkspaceSummary[];
  readonly busy: boolean;
  readonly loadState: LoadState;
  readonly errorMessage: string | null;
  readonly statusMessage: string | null;
  readonly openingId: string | null;
  readonly onOpen: (id: string) => void;
  readonly onClear: () => void;
}

export function RecentWorkspacesView({
  workspaces,
  busy,
  loadState,
  errorMessage,
  statusMessage,
  openingId,
  onOpen,
  onClear,
}: RecentWorkspacesViewProps) {
  return (
    <section className="panel recent-workspaces" aria-labelledby="recent-workspaces-heading">
      <h2 id="recent-workspaces-heading">Recent workspaces</h2>
      <p>Open a local workspace again, or clear this list without deleting workspace files.</p>
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
      {workspaces.length === 0 ? null : (
        <ul className="recent-workspace-list">
          {workspaces.map((workspace) => (
            <li key={workspace.id}>
              <button
                className="button button-quiet recent-workspace-open"
                type="button"
                disabled={busy || openingId !== null}
                onClick={() => onOpen(workspace.id)}
              >
                <span>{workspace.name}</span>
                <time dateTime={workspace.lastOpenedAt}>
                  Last opened {new Date(workspace.lastOpenedAt).toLocaleString()}
                </time>
              </button>
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

interface RecentWorkspacesProps {
  readonly busy: boolean;
  readonly listRecentWorkspaces: () => Promise<readonly RecentWorkspaceSummary[]>;
  readonly openRecentWorkspace: (id: string) => Promise<boolean>;
  readonly clearRecentWorkspaces: () => Promise<void>;
}

export function RecentWorkspaces({
  busy,
  listRecentWorkspaces,
  openRecentWorkspace,
  clearRecentWorkspaces,
}: RecentWorkspacesProps) {
  const [workspaces, setWorkspaces] = useState<readonly RecentWorkspaceSummary[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

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
    if (busy || openingId !== null || clearing) return;
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

  const clear = async () => {
    if (busy || openingId !== null || clearing) return;
    setClearing(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await clearRecentWorkspaces();
      setWorkspaces([]);
      setStatusMessage("Recent workspace history cleared. Workspace files are unchanged.");
    } catch {
      setErrorMessage("Recent workspace history could not be cleared.");
    } finally {
      setClearing(false);
    }
  };

  return (
    <RecentWorkspacesView
      workspaces={workspaces}
      busy={busy || clearing}
      loadState={loadState}
      errorMessage={errorMessage}
      statusMessage={statusMessage}
      openingId={openingId}
      onOpen={(id) => void open(id)}
      onClear={() => void clear()}
    />
  );
}
