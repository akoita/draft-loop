/**
 * Checks a server before the client opens it: is it a DraftLoop server that answers, and how
 * does it sign people in? Both routes are public (`apps/api/src/web-screen.ts`), so the check
 * sends no credential.
 */

export type ServerCheck =
  | { readonly reachable: true; readonly signIn: "owner" }
  | { readonly reachable: true; readonly signIn: "oidc"; readonly issuerOrigin: string }
  | { readonly reachable: false; readonly reason: string };

export type CheckFetch = (
  url: string,
  init: { signal: AbortSignal; redirect: "error" },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}>;

export const serverCheckTimeoutMs = 5_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issuerOrigin(issuer: unknown): string | undefined {
  if (typeof issuer !== "string") return undefined;
  try {
    const url = new URL(issuer);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

export async function checkServer(
  origin: string,
  fetchImpl: CheckFetch,
  timeoutMs: number = serverCheckTimeoutMs,
): Promise<ServerCheck> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const init = { signal: controller.signal, redirect: "error" } as const;
  try {
    const health = await fetchImpl(`${origin}/v1/health`, init);
    if (!health.ok) return { reachable: false, reason: `The server answered ${health.status}.` };
    const config = await fetchImpl(`${origin}/v1/auth/config`, init);
    if (!config.ok)
      return { reachable: false, reason: "This does not look like a DraftLoop server." };
    const body: unknown = await config.json();
    if (isRecord(body) && body.mode === "owner") return { reachable: true, signIn: "owner" };
    if (isRecord(body) && body.mode === "oidc") {
      const issuer = issuerOrigin(body.issuer);
      if (issuer !== undefined) return { reachable: true, signIn: "oidc", issuerOrigin: issuer };
    }
    return { reachable: false, reason: "This does not look like a DraftLoop server." };
  } catch {
    return {
      reachable: false,
      reason: controller.signal.aborted
        ? "The server did not answer in time."
        : "The server cannot be reached.",
    };
  } finally {
    clearTimeout(timer);
  }
}
