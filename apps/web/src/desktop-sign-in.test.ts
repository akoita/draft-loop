import { describe, expect, it, vi } from "vitest";

import { desktopSignIn, withDesktopSignIn } from "./desktop-sign-in.js";
import { createTokenStore } from "./session.js";

const token = "synthetic-owner-token-0123456789abcdef";

function desktop(rememberedToken: string | null) {
  return { host: "desktop", signIn: { rememberedToken, remember: vi.fn(), forget: vi.fn() } };
}

describe("desktopSignIn", () => {
  it("is absent in a browser and for anything that is not the desktop's hook", () => {
    expect(desktopSignIn({})).toBeUndefined();
    expect(
      desktopSignIn({ draftLoopDesktop: { host: "other", signIn: desktop(null).signIn } }),
    ).toBeUndefined();
    expect(desktopSignIn({ draftLoopDesktop: { host: "desktop" } })).toBeUndefined();
    expect(
      desktopSignIn({ draftLoopDesktop: { host: "desktop", signIn: { remember: 1 } } }),
    ).toBeUndefined();
  });

  it("reads the desktop's hook", () => {
    expect(desktopSignIn({ draftLoopDesktop: desktop(token) })?.rememberedToken).toBe(token);
    expect(desktopSignIn({ draftLoopDesktop: desktop(null) })?.rememberedToken).toBeNull();
  });
});

describe("withDesktopSignIn", () => {
  it("leaves the tab's store alone in a browser", () => {
    const tokens = createTokenStore(() => undefined);
    expect(withDesktopSignIn(tokens, undefined)).toBe(tokens);
  });

  it("uses, remembers and forgets the desktop's sign-in", () => {
    const host = desktop(token);
    const hook = desktopSignIn({ draftLoopDesktop: host });
    const tokens = withDesktopSignIn(
      createTokenStore(() => undefined),
      hook,
    );
    expect(tokens.read()).toBe(token);
    tokens.write("another-synthetic-owner-token-0123456789");
    expect(host.signIn.remember).toHaveBeenCalledWith("another-synthetic-owner-token-0123456789");
    expect(tokens.read()).toBe("another-synthetic-owner-token-0123456789");
    tokens.clear();
    expect(host.signIn.forget).toHaveBeenCalled();
    expect(tokens.read()).toBeNull();
  });
});
