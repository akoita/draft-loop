import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ApiClient } from "./api-client.js";
import { App, Shell } from "./app.js";
import type { OidcSession } from "./oidc-session.js";
import { OidcApp, OidcSignIn, type ScreenNavigation } from "./oidc-sign-in.js";
import { createTokenStore } from "./session.js";
import { ServiceUnreachable, SignIn } from "./sign-in.js";

const unusedClient: ApiClient = {
  call: async () => {
    throw new Error("not called while rendering");
  },
};

describe("web screen", () => {
  it("asks for the owner token when no session exists", () => {
    const html = renderToStaticMarkup(
      <App tokens={createTokenStore(() => undefined)} createClient={() => unusedClient} />,
    );

    expect(html).toContain('<label for="owner-token">Owner token</label>');
    expect(html).toContain('type="password"');
  });

  it("opens the shell for a stored token", () => {
    const tokens = createTokenStore(() => undefined);
    tokens.write("synthetic-owner-token-0123456789abcdef");

    const html = renderToStaticMarkup(<App tokens={tokens} createClient={() => unusedClient} />);

    expect(html).toContain("Checking the service");
    expect(html).toContain("Sign out");
  });

  it("says why the last session ended", () => {
    const html = renderToStaticMarkup(
      <SignIn notice="The API refused the owner token. Sign in again." onSignIn={() => {}} />,
    );

    expect(html).toContain('role="status">The API refused the owner token. Sign in again.</p>');
  });

  it("renders the shell header", () => {
    const html = renderToStaticMarkup(<Shell client={unusedClient} onSignOut={() => {}} />);

    expect(html).toContain("<h1>DraftLoop</h1>");
  });

  it("keeps the owner token's single workspace, with no record picker", () => {
    const html = renderToStaticMarkup(<Shell client={unusedClient} onSignOut={() => {}} />);

    expect(html).toContain("Reading your workspace…");
    expect(html).not.toContain("candidate records");
  });

  it("reads the caller's candidate records first in sign-in mode", () => {
    const html = renderToStaticMarkup(
      <Shell mode="sign-in" client={unusedClient} onSignOut={() => {}} />,
    );

    expect(html).toContain("Reading your candidate records…");
    expect(html).not.toContain("Reading your workspace…");
  });

  it("says when the service cannot say how to sign in", () => {
    const html = renderToStaticMarkup(<ServiceUnreachable />);

    expect(html).toContain('role="alert">The service cannot be reached.');
  });
});

function stubSession(overrides: Partial<OidcSession> = {}): OidcSession {
  const unused = async () => {
    throw new Error("not called while rendering");
  };
  return {
    isSignedIn: () => false,
    begin: unused,
    complete: unused,
    accessToken: unused,
    refresh: unused,
    signOut: unused,
    clear: () => {},
    takeNotice: () => undefined,
    ...overrides,
  };
}

const navigation = (search = ""): ScreenNavigation => ({
  search,
  assign: () => {},
  clearQuery: () => {},
});

describe("web screen in sign-in mode", () => {
  it("offers sign-in through the provider, with no token field", () => {
    const html = renderToStaticMarkup(
      <OidcApp
        session={stubSession()}
        createClient={() => unusedClient}
        navigation={navigation()}
      />,
    );

    expect(html).toContain("Sign in with your organisation account.");
    expect(html).toContain('<button type="button">Sign in</button>');
    expect(html).not.toContain("owner-token");
  });

  it("shows the notice a previous page left, such as an account with no organisation", () => {
    const notice =
      "This account is not a member of an organisation yet. Ask your organisation's owner for an invite.";
    const html = renderToStaticMarkup(
      <OidcApp
        session={stubSession({ takeNotice: () => notice })}
        createClient={() => unusedClient}
        navigation={navigation()}
      />,
    );

    expect(html).toContain(`role="status">${notice.replace("'", "&#x27;")}</p>`);
  });

  it("waits while it finishes a sign-in the provider answered", () => {
    const html = renderToStaticMarkup(
      <OidcApp
        session={stubSession()}
        createClient={() => unusedClient}
        navigation={navigation("?code=abc&state=s1")}
      />,
    );

    expect(html).toContain('<button type="button" disabled="">Signing in</button>');
  });

  it("opens the shell, with sign-out, for a stored sign-in", () => {
    const html = renderToStaticMarkup(
      <OidcApp
        session={stubSession({ isSignedIn: () => true })}
        createClient={() => unusedClient}
        navigation={navigation()}
      />,
    );

    expect(html).toContain("Checking the service");
    expect(html).toContain("Sign out");
  });

  it("renders the sign-in screen on its own", () => {
    const html = renderToStaticMarkup(<OidcSignIn notice="Signed out." onSignIn={() => {}} />);

    expect(html).toContain('role="status">Signed out.</p>');
  });
});
