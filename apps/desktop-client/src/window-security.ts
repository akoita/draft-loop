import { decideNavigation, type NavigationScope } from "./navigation.js";

/** The part of Electron's `WebContents` the rules need, so tests can drive them without Electron. */
export interface GuardedContents {
  setWindowOpenHandler(handler: (details: { url: string }) => { action: "deny" }): void;
  on(
    event: "will-navigate" | "will-redirect",
    listener: (event: { preventDefault(): void; url: string }) => void,
  ): void;
}

/** The part of Electron's `Session` the rules need. */
export interface GuardedSession {
  setPermissionRequestHandler(
    handler: (contents: unknown, permission: string, callback: (granted: boolean) => void) => void,
  ): void;
  setPermissionCheckHandler(handler: () => boolean): void;
}

/**
 * Keeps a server window on its server (and its sign-in issuer). New windows are never opened:
 * web links go to the system browser, and anything else is dropped. `scope` is read on every
 * navigation, so the issuer can be learnt after the window opens.
 */
export function guardContents(
  contents: GuardedContents,
  scope: () => NavigationScope,
  openExternal: (url: string) => void,
): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (decideNavigation(url, scope()) !== "block") openExternal(url);
    return { action: "deny" };
  });
  const guard = (event: { preventDefault(): void; url: string }) => {
    const decision = decideNavigation(event.url, scope());
    if (decision === "allow") return;
    event.preventDefault();
    if (decision === "external") openExternal(event.url);
  };
  contents.on("will-navigate", guard);
  contents.on("will-redirect", guard);
}

/** The server's pages get no device permissions: no camera, microphone, location or notifications. */
export function denyPermissions(session: GuardedSession): void {
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
}
