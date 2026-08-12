import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { createFixtureReviewState, type ReviewAction, reduceReviewState } from "./model.js";
import { ReviewWorkspace } from "./review.js";
import "./styles.css";

function App() {
  const [state, setState] = useState(createFixtureReviewState);
  const onAction = (action: ReviewAction) => {
    setState((current) => reduceReviewState(current, action));
  };

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
