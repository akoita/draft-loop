import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ApiClient } from "./api-client.js";
import { App, Shell } from "./app.js";
import { createTokenStore } from "./session.js";
import { SignIn } from "./sign-in.js";

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
});
