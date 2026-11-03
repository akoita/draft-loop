/**
 * Where the window may go. It stays on its server and, in sign-in mode, on that server's
 * identity provider; any other web link opens in the system browser, and every other scheme
 * is refused (ADR 0011, D9).
 */

export interface NavigationScope {
  readonly serverOrigin: string;
  /** The sign-in issuer's origin, when the server uses sign-in mode. */
  readonly issuerOrigin?: string | undefined;
}

export type NavigationDecision = "allow" | "external" | "block";

export function decideNavigation(target: string, scope: NavigationScope): NavigationDecision {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return "block";
  }
  if (url.protocol === "http:" || url.protocol === "https:") {
    if (url.origin === scope.serverOrigin) return "allow";
    if (scope.issuerOrigin !== undefined && url.origin === scope.issuerOrigin) return "allow";
    if (url.username !== "" || url.password !== "") return "block";
    return "external";
  }
  if (url.protocol === "mailto:") return "external";
  return "block";
}
