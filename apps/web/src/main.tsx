import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createApiClient } from "./api-client.js";
import { App } from "./app.js";
import { createTokenStore } from "./session.js";
import "./styles.css";

const tokens = createTokenStore(() => globalThis.sessionStorage);
const root = document.getElementById("root");
if (root === null) throw new Error("The page has no root element.");

createRoot(root).render(
  <StrictMode>
    <App tokens={tokens} createClient={(token) => createApiClient({ token })} />
  </StrictMode>,
);
