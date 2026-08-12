import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import type { DesktopReviewPort, DesktopReviewState, ReviewAction } from "./model.js";
import { createDesktopReviewPort } from "./native.js";
import { ReviewWorkspace } from "./review.js";
import "./styles.css";

export function App({ port = createDesktopReviewPort() }: { readonly port?: DesktopReviewPort }) {
  const [state, setState] = useState<DesktopReviewState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void port
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
  }, [port]);

  const onAction = (action: ReviewAction) => {
    if (state === null) return;
    void port
      .dispatch(state, action)
      .then(setState)
      .catch((reason: unknown) => {
        setError(
          reason instanceof Error ? reason.message : "The review action could not be completed.",
        );
      });
  };

  if (error !== null) {
    return (
      <main className="app-shell">
        <section className="panel">
          <h1>Review workspace unavailable</h1>
          <p>{error}</p>
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
