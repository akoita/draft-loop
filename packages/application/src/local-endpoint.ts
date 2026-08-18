/**
 * Endpoint safety for the `local` provider company.
 *
 * `local` is a promise about where candidate material goes: nowhere off this
 * machine. Nothing downstream re-checks that promise. The desktop transmission
 * preflight, the run audit trail, and every label in the UI repeat the
 * configured company, so a workspace pointed at a remote host would keep
 * saying "local" while shipping the candidate's documents to a stranger. This
 * predicate is the only place the promise is enforced, which is why it is
 * deliberately narrow: an address we cannot prove is loopback is refused.
 */

/**
 * The endpoint the local adapter falls back to when a workspace configures
 * none: Ollama's default.
 *
 * The adapter still owns that fallback; this constant exists so surfaces that
 * must *name* the address before a request is made -- the desktop transmission
 * preflight above all -- do not each invent their own guess. A test in
 * `local.test.ts` observes the adapter's real default and fails if the two
 * drift apart.
 */
export const defaultLocalModelEndpoint = "http://127.0.0.1:11434/v1";

const loopbackIpv4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u;

function isLoopbackHostname(hostname: string): boolean {
  // `URL` lowercases hosts and wraps IPv6 literals in brackets.
  if (hostname === "localhost") return true;
  if (hostname === "[::1]") return true;
  if (!loopbackIpv4.test(hostname)) return false;
  const octets = hostname.split(".").map(Number);
  return octets.every((octet) => octet <= 255) && octets[0] === 127;
}

/**
 * Reports whether an endpoint is reachable only on this machine.
 *
 * Accepted: `http`/`https` URLs whose host is `localhost`, `::1`, or an
 * address in `127.0.0.0/8`. Everything else is refused, including hosts that
 * merely resolve to a loopback address (we cannot verify that here) and URLs
 * carrying embedded credentials, which are both unnecessary for a local server
 * and the classic way to make a remote host read as a local one.
 */
export function isLoopbackEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  return isLoopbackHostname(url.hostname.toLowerCase());
}
