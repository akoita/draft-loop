import { ScreensI18nProvider } from "@draft-loop/ui/i18n";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { type ApiClient, ApiRequestError } from "./api-client.js";
import { App, ownerClient, Shell } from "./app.js";
import { BetaSignUpView } from "./beta-sign-up.js";
import type { OidcSession } from "./oidc-session.js";
import { OidcApp, OidcSignIn, type ScreenNavigation } from "./oidc-sign-in.js";
import { createTokenStore } from "./session.js";
import { ServiceUnreachable, SignIn } from "./sign-in.js";

const unusedClient: ApiClient = {
  call: async () => {
    throw new Error("not called while rendering");
  },
};

describe("the owner client", () => {
  it("keeps the socket the live interview opens and ends the session on a refused token", async () => {
    const socket = {} as WebSocket;
    const opened: string[] = [];
    let refused = 0;
    const client = ownerClient(
      {
        call: async () => {
          throw new ApiRequestError(401, "unauthorized", "Refused.");
        },
        openSocket: (path) => {
          opened.push(path);
          return socket;
        },
      },
      () => {
        refused += 1;
      },
    );
    expect(client.openSocket?.("/live", {} as never, "draft-loop.live")).toBe(socket);
    expect(opened).toEqual(["/live"]);
    await expect(client.call("GET /v1/health" as never, {} as never)).rejects.toThrow("Refused.");
    expect(refused).toBe(1);
  });
});

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

  it("puts the service status and sign-out in the page's actions, with no bar of its own", () => {
    const html = renderToStaticMarkup(<Shell client={unusedClient} onSignOut={() => {}} />);

    expect(html).not.toContain("<h1>Redakloop</h1>");
    expect(html).toMatch(
      /<div class="page-actions">(?:<button[^>]*header-theme-toggle[\s\S]*?<\/button>)?<span class="service-status service-checking" role="status">/u,
    );
    expect(html).toContain("Sign out</button></div>");
  });

  it("keeps the owner token's single workspace, with no record picker", () => {
    const html = renderToStaticMarkup(<Shell client={unusedClient} onSignOut={() => {}} />);

    expect(html).toContain("Opening your documents…");
    expect(html).not.toContain("candidate records");
  });

  it("has one flow, with no step navigation or consent-and-rules button", () => {
    for (const mode of ["owner", "sign-in"] as const) {
      const html = renderToStaticMarkup(
        <Shell mode={mode} client={unusedClient} onSignOut={() => {}} />,
      );

      expect(html).not.toContain("Consent, rules");
      expect(html).not.toContain('aria-label="Steps"');
      for (const tab of ["Workspace", "Sources", "Job brief", "Run"])
        expect(html).not.toContain(`>${tab}</button>`);
    }
  });

  it("reads the caller's candidate records first in sign-in mode", () => {
    const html = renderToStaticMarkup(
      <Shell mode="sign-in" client={unusedClient} onSignOut={() => {}} />,
    );

    expect(html).toContain("Opening Redakloop…");
    expect(html).not.toContain("Opening your documents…");
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
    canResume: () => false,
    prepare: () => {},
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

    expect(html).toContain("Sign in with the email address your invitation was sent to.");
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

  it("skips the landing page for a browser still signed in at the provider", () => {
    const html = renderToStaticMarkup(
      <OidcApp
        session={stubSession({ canResume: () => true })}
        createClient={() => unusedClient}
        navigation={navigation()}
        waitlist
      />,
    );

    expect(html).toContain('<button type="button" disabled="">Signing in</button>');
    expect(html).not.toContain("waitlist");
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

  it("skips the landing page on the return from an invite's password page", () => {
    const html = renderToStaticMarkup(
      <OidcApp
        session={stubSession()}
        createClient={() => unusedClient}
        navigation={navigation()}
        waitlist
        welcome
      />,
    );

    expect(html).toContain("Sign in with the email address your invitation was sent to.");
    expect(html).not.toContain("waitlist");
  });

  it("renders the sign-in screen on its own", () => {
    const html = renderToStaticMarkup(<OidcSignIn notice="Signed out." onSignIn={() => {}} />);

    expect(html).toContain('role="status">Signed out.</p>');
  });
});

/** Renders a screen the way the page does, with a screen language the person can change. */
function withLanguageChoice(screen: ReactNode): string {
  return renderToStaticMarkup(
    <ScreensI18nProvider locale="en" onChoose={() => {}}>
      {screen}
    </ScreensI18nProvider>,
  );
}

describe("screen language and theme before any record (#2772)", () => {
  it("offers the language and the theme on every page before sign-in", () => {
    const pages = [
      <SignIn key="owner" onSignIn={() => {}} />,
      <ServiceUnreachable key="down" />,
      <OidcSignIn key="oidc" onSignIn={() => {}} />,
      <OidcSignIn key="landing" waitlist onSignIn={() => {}} />,
      <BetaSignUpView
        key="beta"
        code=""
        accepted={false}
        busy={false}
        onCodeChange={() => {}}
        onAcceptedChange={() => {}}
        onSubmit={() => {}}
        onSignOut={() => {}}
      />,
    ];
    for (const page of pages) {
      const html = withLanguageChoice(page);
      expect(html).toContain('class="page-actions preferences-bar"');
      expect(html).toContain('<span class="sr-only">Screen language</span>');
      expect(html).toContain('<option value="fr" lang="fr">Français</option>');
      expect(html).toContain("header-theme-toggle");
    }
  });

  it("keeps the language in the shell's actions, so the record list and every header have it", () => {
    for (const mode of ["owner", "sign-in"] as const) {
      const html = withLanguageChoice(
        <Shell mode={mode} client={unusedClient} onSignOut={() => {}} />,
      );
      expect(html).toMatch(/service-status[\s\S]*screen-language-menu[\s\S]*Sign out<\/button>/u);
    }
  });

  it("shows no language control when the host offers no choice", () => {
    const html = renderToStaticMarkup(<SignIn onSignIn={() => {}} />);
    expect(html).not.toContain("screen-language-menu");
  });
});
