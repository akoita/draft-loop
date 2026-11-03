import { describe, expect, it, vi } from "vitest";

import type { NavigationScope } from "./navigation.js";
import { denyPermissions, type GuardedContents, guardContents } from "./window-security.js";

type Listener = (event: { preventDefault(): void; url: string }) => void;

function fakeContents() {
  const listeners = new Map<string, Listener>();
  let openHandler: ((details: { url: string }) => { action: "deny" }) | undefined;
  const contents: GuardedContents = {
    setWindowOpenHandler: (handler) => {
      openHandler = handler;
    },
    on: (event, listener) => {
      listeners.set(event, listener);
    },
  };
  const navigate = (event: "will-navigate" | "will-redirect", url: string) => {
    const preventDefault = vi.fn();
    listeners.get(event)?.({ url, preventDefault });
    return preventDefault.mock.calls.length > 0;
  };
  return { contents, navigate, open: (url: string) => openHandler?.({ url }) };
}

describe("guardContents", () => {
  it("lets the server navigate and sends other links outside", () => {
    const { contents, navigate } = fakeContents();
    const openExternal = vi.fn();
    guardContents(contents, () => ({ serverOrigin: "https://draftloop.example" }), openExternal);
    expect(navigate("will-navigate", "https://draftloop.example/home")).toBe(false);
    expect(navigate("will-navigate", "https://docs.example/")).toBe(true);
    expect(navigate("will-redirect", "file:///etc/passwd")).toBe(true);
    expect(openExternal.mock.calls).toEqual([["https://docs.example/"]]);
  });

  it("never opens a new window, and reads the scope at each navigation", () => {
    const { contents, navigate, open } = fakeContents();
    const openExternal = vi.fn();
    let scope: NavigationScope = { serverOrigin: "https://draftloop.example" };
    guardContents(contents, () => scope, openExternal);
    expect(open("https://draftloop.example/x")).toEqual({ action: "deny" });
    expect(open("javascript:alert(1)")).toEqual({ action: "deny" });
    expect(openExternal.mock.calls).toEqual([["https://draftloop.example/x"]]);
    expect(navigate("will-navigate", "https://id.example/auth")).toBe(true);
    scope = { ...scope, issuerOrigin: "https://id.example" };
    expect(navigate("will-navigate", "https://id.example/auth")).toBe(false);
  });
});

describe("denyPermissions", () => {
  it("refuses every permission request and check", () => {
    let request: ((c: unknown, p: string, cb: (granted: boolean) => void) => void) | undefined;
    let check: (() => boolean) | undefined;
    denyPermissions({
      setPermissionRequestHandler: (handler) => {
        request = handler;
      },
      setPermissionCheckHandler: (handler) => {
        check = handler;
      },
    });
    const callback = vi.fn();
    request?.(undefined, "media", callback);
    expect(callback).toHaveBeenCalledWith(false);
    expect(check?.()).toBe(false);
  });
});
