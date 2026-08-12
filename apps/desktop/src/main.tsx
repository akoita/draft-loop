import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import type { DesktopReviewPort, DesktopReviewState, ReviewAction } from "./model.js";
import { createDesktopReviewPort } from "./native.js";
import { ReviewWorkspace } from "./review.js";
import "./styles.css";

export function App({ port }: { readonly port?: DesktopReviewPort }) {
  const activePort = useMemo(() => port ?? createDesktopReviewPort(), [port]);
  const [state, setState] = useState<DesktopReviewState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nativeActions = useMemo(
    () => ({ open: activePort.openWorkspace, create: activePort.createWorkspace }),
    [activePort],
  );

  useEffect(() => {
    let active = true;
    void activePort
      .load()
      .then((loaded) => {
        if (active) setState(loaded);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error ? reason.message : "The review workspace could not load.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [activePort]);

  const onAction = (action: ReviewAction) => {
    if (state === null) return;
    void activePort
      .dispatch(state, action)
      .then(setState)
      .catch((reason: unknown) => {
        setError(
          reason instanceof Error ? reason.message : "The review action could not be completed.",
        );
      });
  };

  if (error !== null) {
    const openWorkspace = nativeActions.open;
    const createWorkspace = nativeActions.create;
    const setup = async (action: (() => Promise<DesktopReviewState>) | undefined) => {
      if (action === undefined) return;
      setBusy(true);
      setError(null);
      try {
        setState(await action());
      } catch (reason: unknown) {
        setError(reason instanceof Error ? reason.message : "The workspace could not be opened.");
      } finally {
        setBusy(false);
      }
    };
    return (
      <main className="app-shell">
        <section className="panel">
          <h1>Review workspace unavailable</h1>
          <p>{error}</p>
          {openWorkspace === undefined && createWorkspace === undefined ? null : (
            <div className="approval-actions">
              <button
                className="button button-primary"
                type="button"
                disabled={busy || createWorkspace === undefined}
                onClick={() =>
                  void setup(
                    createWorkspace === undefined
                      ? undefined
                      : () => createWorkspace("draft-loop-offline"),
                  )
                }
              >
                Create offline workspace
              </button>
              <button
                className="button button-quiet"
                type="button"
                disabled={busy || openWorkspace === undefined}
                onClick={() => void setup(openWorkspace)}
              >
                Open workspace
              </button>
            </div>
          )}
        </section>
      </main>
    );
  }
  if (state === null) {
    return (
      <main className="app-shell">
        <section className="panel">
          <p>Loading local review workspace…</p>
        </section>
      </main>
    );
  }

  return <ReviewWorkspace state={state} onAction={onAction} />;
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Draft Loop root element is missing.");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
