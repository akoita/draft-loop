import type { FastifyInstance } from "fastify";

/**
 * The service's earlier public host names, such as the one it had before a rename. A page asked
 * for on one of them gets a permanent redirect to the same path on the public origin, so old
 * links and search results land on the current address.
 *
 * Only browser page reads move: the API under `/v1/` and `/.well-known/` stays served on every
 * host, so agents, webhooks and sign-in callbacks set up with an old address keep working.
 */
export function readPreviousHosts(text: string | undefined): readonly string[] {
  if (text === undefined || text.trim() === "") return [];
  return text.split(",").flatMap((entry) => {
    const host = entry.trim().toLowerCase();
    if (host === "") return [];
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(host)) {
      throw new Error(
        `DRAFT_LOOP_PREVIOUS_PUBLIC_HOSTS holds "${entry.trim()}": give host names only, comma separated.`,
      );
    }
    return [host];
  });
}

/** Whether a request to `path` on a previous host should move to the public origin. */
export function movesToPublicOrigin(method: string, path: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  return !(path.startsWith("/v1/") || path === "/v1" || path.startsWith("/.well-known/"));
}

/** Registers the redirect from each previous host to `origin`; does nothing without hosts. */
export function registerPreviousHostRedirect(
  app: FastifyInstance,
  origin: string | undefined,
  hosts: readonly string[],
): void {
  if (origin === undefined || hosts.length === 0) return;
  const previous = new Set(hosts);
  if (previous.has(new URL(origin).hostname)) {
    throw new Error("DRAFT_LOOP_PREVIOUS_PUBLIC_HOSTS must not name the public URL's own host.");
  }
  app.addHook("onRequest", async (request, reply) => {
    const host = request.hostname.toLowerCase().replace(/:\d+$/u, "");
    if (!previous.has(host)) return;
    const path = request.url.split("?")[0] ?? request.url;
    if (!movesToPublicOrigin(request.method, path)) return;
    return reply
      .header("cache-control", "public, max-age=86400")
      .redirect(`${origin}${request.url}`, 301);
  });
}
