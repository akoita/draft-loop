import "@draft-loop/ui/styles.css";

import { App } from "@draft-loop/ui/app";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

/** The renderer entry: the shared screens over the host bridge the Electron preload installs. */
function mount(): void {
  const root = document.getElementById("root");
  if (!root) {
    throw new Error("Draft Loop root element is missing.");
  }
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

mount();
