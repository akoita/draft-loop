import { describe, expect, it } from "vitest";

import { decideNavigation } from "./navigation.js";

const scope = { serverOrigin: "https://draftloop.example" };

describe("decideNavigation", () => {
  it("stays on the server", () => {
    expect(decideNavigation("https://draftloop.example/applications/1", scope)).toBe("allow");
  });

  it("allows the sign-in issuer only when the server names one", () => {
    const issuer = "https://id.example/realms/draftloop/protocol/openid-connect/auth";
    expect(decideNavigation(issuer, scope)).toBe("external");
    expect(decideNavigation(issuer, { ...scope, issuerOrigin: "https://id.example" })).toBe(
      "allow",
    );
  });

  it("sends other web and mail links to the system", () => {
    expect(decideNavigation("https://docs.example/help", scope)).toBe("external");
    expect(decideNavigation("http://draftloop.example/", scope)).toBe("external");
    expect(decideNavigation("mailto:someone@example.com", scope)).toBe("external");
  });

  it("refuses everything else", () => {
    for (const target of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/html,<p>hi</p>",
      "about:blank",
      "draftloop://open",
      "https://user:pw@docs.example/",
      "not a url",
    ]) {
      expect(decideNavigation(target, scope), target).toBe("block");
    }
  });
});
