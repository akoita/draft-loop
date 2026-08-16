import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import type { DesktopReviewPort, DesktopReviewState, ReviewAction } from "./model.js";
import { createDesktopReviewPort } from "./native.js";
import { BrandMark, ReviewWorkspace } from "./review.js";
import { createReviewActionDispatcher, type PendingReviewAction } from "./review-dispatch.js";
import "./styles.css";

const runRefreshIntervalMs = 750;

export function App({ port }: { readonly port?: DesktopReviewPort }) {
  const activePort = useMemo(() => port ?? createDesktopReviewPort(), [port]);
  const [state, setState] = useState<DesktopReviewState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingReviewAction, setPendingReviewAction] = useState<PendingReviewAction | null>(null);
  const [reviewActionDispatcher] = useState(() =>
    createReviewActionDispatcher(setPendingReviewAction),
  );
  const activeExecutionStatus = state?.execution.status;
  const nativeActions = useMemo(
    () => ({
      open: activePort.openWorkspace,
      create: activePort.createWorkspace,
      createDemo: activePort.createDemoWorkspace,
    }),
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

  useEffect(() => {
    if (activeExecutionStatus !== "running") return;
    let active = true;
    let loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const loaded = await activePort.load();
        if (active) {
          setState(loaded);
          setImportError(null);
        }
      } catch (reason: unknown) {
        if (active) {
          setImportError(
            reason instanceof Error ? reason.message : "Review progress could not be refreshed.",
          );
        }
      } finally {
        loading = false;
      }
    };
    const interval = window.setInterval(() => void refresh(), runRefreshIntervalMs);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [activePort, activeExecutionStatus]);

  const onAction = (action: ReviewAction) => {
    if (state === null) return;
    setImportError(null);
    reviewActionDispatcher.dispatch(action, async () => {
      try {
        setState(await activePort.dispatch(state, action));
      } catch (reason: unknown) {
        setImportError(
          reason instanceof Error ? reason.message : "The review action could not be completed.",
        );
      }
    });
  };

  useEffect(() => {
    if (pendingReviewAction === null) return;
    const interval = window.setInterval(reviewActionDispatcher.updateElapsed, 1_000);
    return () => window.clearInterval(interval);
  }, [pendingReviewAction, reviewActionDispatcher]);

  const setup = async (action: (() => Promise<DesktopReviewState>) | undefined) => {
    if (action === undefined) return;
    setBusy(true);
    setError(null);
    setImportError(null);
    try {
      setState(await action());
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "The workspace could not be opened.");
    } finally {
      setBusy(false);
    }
  };

  if (error !== null) {
    const openWorkspace = nativeActions.open;
    const createWorkspace = nativeActions.create;
    const createDemoWorkspace = nativeActions.createDemo;
    return (
      <main className="app-shell">
        <section className="panel boot-panel">
          <div className="boot-brand">
            <BrandMark />
            <span className="brand-name">DraftLoop</span>
          </div>
          <p className="eyebrow">First run</p>
          <h1>Set up a review workspace</h1>
          <p>{error}</p>
          {openWorkspace === undefined &&
          createWorkspace === undefined &&
          createDemoWorkspace === undefined ? null : (
            <div className="approval-actions">
              <button
                className="button button-primary"
                type="button"
                disabled={busy || createWorkspace === undefined}
                onClick={() =>
                  void setup(
                    createWorkspace === undefined
                      ? undefined
                      : () => createWorkspace("draft-loop-workspace"),
                  )
                }
              >
                Create workspace
              </button>
              <button
                className="button button-quiet"
                type="button"
                disabled={busy || createDemoWorkspace === undefined}
                onClick={() =>
                  void setup(
                    createDemoWorkspace === undefined
                      ? undefined
                      : () => createDemoWorkspace("draft-loop-demo"),
                  )
                }
              >
                Try demo workspace
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
        <section className="panel boot-panel">
          <div className="boot-brand">
            <BrandMark />
            <span className="brand-name">DraftLoop</span>
          </div>
          <p className="boot-loading" role="status" aria-live="polite">
            Loading local review workspace…
          </p>
        </section>
      </main>
    );
  }

  return (
    <ReviewWorkspace
      state={state}
      onAction={onAction}
      errorMessage={importError}
      pendingReviewAction={pendingReviewAction}
      {...(activePort.selectFiles === undefined
        ? {}
        : {
            onSelectFiles: (target: "evidence" | "job-description") => {
              setImportError(null);
              void activePort
                .selectFiles?.(target)
                .then(setState)
                .catch((reason: unknown) => {
                  setImportError(
                    reason instanceof Error ? reason.message : "The files could not be imported.",
                  );
                });
            },
          })}
      {...(activePort.addUrl === undefined
        ? {}
        : {
            onAddUrl: (target: "evidence" | "job-description", url: string) => {
              setImportError(null);
              void activePort
                .addUrl?.(target, url)
                .then(setState)
                .catch((reason: unknown) => {
                  setImportError(
                    reason instanceof Error ? reason.message : "The URL could not be imported.",
                  );
                });
            },
          })}
      {...(activePort.getCredentialStatus === undefined
        ? {}
        : { getCredentialStatus: activePort.getCredentialStatus })}
      {...(activePort.setCredential === undefined
        ? {}
        : {
            onSetCredential: async (provider: "anthropic" | "openai", apiKey: string) => {
              await activePort.setCredential?.(provider, apiKey);
            },
          })}
      {...(activePort.removeCredential === undefined
        ? {}
        : {
            onRemoveCredential: async (provider: "anthropic" | "openai") => {
              await activePort.removeCredential?.(provider);
            },
          })}
    />
  );
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
