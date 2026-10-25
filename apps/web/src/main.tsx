import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { type ApiSchemas, createApiClient } from "./api-client.js";
import { App } from "./app.js";
import { createOidcSession } from "./oidc-session.js";
import { OidcApp, type ScreenNavigation } from "./oidc-sign-in.js";
import { createTokenStore } from "./session.js";
import { ServiceUnreachable } from "./sign-in.js";
import "./styles.css";
// After the web's own styles, so the shared screens keep the desktop's look.
import "@draft-loop/ui/styles.css";

const element = document.getElementById("root");
if (element === null) throw new Error("The page has no root element.");
const root = createRoot(element);
const createClient = (token: string) => createApiClient({ token });

/** The screen's own address, where the identity provider returns after signing in and out. */
const screenAddress = `${location.origin}/`;

const navigation: ScreenNavigation = {
  search: location.search,
  assign: (url) => location.assign(url),
  clearQuery: () => history.replaceState(null, "", location.pathname),
};

function screenFor(config: ApiSchemas["AuthConfig"]) {
  if (config.mode === "owner")
    return (
      <App tokens={createTokenStore(() => globalThis.sessionStorage)} createClient={createClient} />
    );
  const session = createOidcSession({
    issuer: config.issuer,
    clientId: config.clientId,
    redirectUri: screenAddress,
    fetch: globalThis.fetch.bind(globalThis),
    crypto: globalThis.crypto,
    storage: () => globalThis.sessionStorage,
    now: () => Date.now(),
  });
  return <OidcApp session={session} createClient={createClient} navigation={navigation} />;
}

// The API says how this deployment signs people in: the owner token, or the identity provider.
createApiClient({})
  .call("GET /v1/auth/config", {})
  .then(screenFor, () => <ServiceUnreachable />)
  .then((screen) => root.render(<StrictMode>{screen}</StrictMode>));
