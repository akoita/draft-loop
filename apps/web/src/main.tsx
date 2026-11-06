import { type ScreenLocale, ScreensI18nProvider } from "@draft-loop/ui/i18n";
import { type ReactNode, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { type ApiSchemas, createApiClient } from "./api-client.js";
import { App } from "./app.js";
import { desktopSignIn, withDesktopSignIn } from "./desktop-sign-in.js";
import { NewReleaseWatch } from "./new-release.js";
import { createOidcSession } from "./oidc-session.js";
import { OidcApp, type ScreenNavigation } from "./oidc-sign-in.js";
import {
  desktopScreenLanguage,
  initialScreenLocale,
  saveScreenLanguage,
} from "./screen-language-choice.js";
import { createTokenStore } from "./session.js";
import { ServiceUnreachable } from "./sign-in.js";
import "./styles.css";
// After the web's own styles, so the shared screens keep the desktop's look.
import "@draft-loop/ui/styles.css";

const element = document.getElementById("root");
if (element === null) throw new Error("The page has no root element.");
const root = createRoot(element);
const createClient = (token: string) => createApiClient({ token });
const localStorage = () => globalThis.localStorage;
// The saved screen language, else the browser's (the desktop client's window passes its own);
// development builds also take `?locale=pseudo` from the address.
const desktopLanguage = desktopScreenLanguage();
const firstScreenLocale = initialScreenLocale({
  storage: localStorage,
  desktop: desktopLanguage,
  languages: navigator.languages,
  search: location.search,
  development: import.meta.env.DEV,
});

/** The screens in the chosen language; Workspace settings changes it and it is saved here. */
function Screens({ children }: { readonly children: ReactNode }) {
  const [locale, setLocale] = useState<ScreenLocale>(firstScreenLocale);
  return (
    <ScreensI18nProvider
      locale={locale}
      onChoose={(language) => {
        saveScreenLanguage(localStorage, language, desktopLanguage);
        setLocale(language);
      }}
    >
      {children}
    </ScreensI18nProvider>
  );
}

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
      <App
        tokens={withDesktopSignIn(
          createTokenStore(() => globalThis.sessionStorage),
          desktopSignIn(),
        )}
        createClient={createClient}
      />
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
  .then((screen) =>
    root.render(
      <StrictMode>
        <Screens>
          <NewReleaseWatch />
          {screen}
        </Screens>
      </StrictMode>,
    ),
  );
