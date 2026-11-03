/**
 * The rules for a server address the client may open (ADR 0011, D9). Only the address's origin
 * is kept: the client always opens the server's own web screen at its root. Plain `http` is
 * allowed only for this computer, so a token never crosses a network unencrypted.
 */

/** The self-hosted server's default address (`deploy/local/compose.yaml`). */
export const thisComputerOrigin = "http://127.0.0.1:8080";

const loopbackHosts: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "[::1]"]);

export type ServerAddress =
  | { readonly ok: true; readonly origin: string }
  | { readonly ok: false; readonly reason: string };

/** Whether a URL's host is this computer. */
export function isLoopbackHost(hostname: string): boolean {
  return loopbackHosts.has(hostname.toLowerCase());
}

function withScheme(input: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(input)) return input;
  const host = input.split(/[/:]/u, 1)[0] ?? "";
  return `${isLoopbackHost(host) || input.startsWith("[::1]") ? "http" : "https"}://${input}`;
}

/** Reads what a person typed, or what the client saved, as a server origin. */
export function parseServerAddress(input: string): ServerAddress {
  const text = input.trim();
  if (text === "") return { ok: false, reason: "Enter the server's address." };
  let url: URL;
  try {
    url = new URL(withScheme(text));
  } catch {
    return { ok: false, reason: "That is not a web address." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "The address must start with https://." };
  }
  if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
    return { ok: false, reason: "Use https:// for a server on another computer." };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "Leave the user name and password out of the address." };
  }
  if ((url.pathname !== "/" && url.pathname !== "") || url.search !== "" || url.hash !== "") {
    return { ok: false, reason: "Give the server's address without a path." };
  }
  return { ok: true, origin: url.origin };
}
