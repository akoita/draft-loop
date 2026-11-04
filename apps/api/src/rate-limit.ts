import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { apiError } from "./errors.js";

/**
 * Request limits per source address (threat model S-010, #2145), counted in one-minute windows in
 * this API instance's memory. A refused credential counts against a much smaller budget: once an
 * address has spent it, every request from that address waits for the next window.
 */
export interface RateLimits {
  /** Requests one address may make in a window. */
  readonly requestsPerWindow: number;
  /** Answers of 401 one address may receive in a window before it is refused outright. */
  readonly refusedPerWindow: number;
  readonly windowMs?: number;
  readonly now?: () => number;
}

export const defaultRateLimits: RateLimits = { requestsPerWindow: 1200, refusedPerWindow: 30 };

const defaultWindowMs = 60_000;

/** The routes no limit applies to: health, which Cloud Run and Compose probe. */
const unlimitedRoutes: ReadonlySet<string> = new Set(["/v1/health"]);

interface Window {
  readonly start: number;
  requests: number;
  refused: number;
}

/** Registers the limits; call it before request authentication so refused requests count too. */
export function registerRateLimit(app: FastifyInstance, limits: RateLimits): void {
  const windowMs = limits.windowMs ?? defaultWindowMs;
  const now = limits.now ?? Date.now;
  const windows = new Map<string, Window>();
  let lastSweep = now();

  const windowFor = (address: string, at: number): Window => {
    if (at - lastSweep >= windowMs) {
      for (const [key, window] of windows) {
        if (at - window.start >= windowMs) windows.delete(key);
      }
      lastSweep = at;
    }
    const current = windows.get(address);
    if (current !== undefined && at - current.start < windowMs) return current;
    const fresh: Window = { start: at, requests: 0, refused: 0 };
    windows.set(address, fresh);
    return fresh;
  };

  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    if (unlimitedRoutes.has(request.routeOptions.url ?? "")) return;
    const at = now();
    const window = windowFor(request.ip, at);
    window.requests += 1;
    const scope =
      window.refused >= limits.refusedPerWindow
        ? "refused_credentials"
        : window.requests > limits.requestsPerWindow
          ? "requests"
          : undefined;
    if (scope === undefined) return;
    // Content-free: which budget ran out, never the address, path or credential.
    request.log.warn({ event: "rate_limited", scope }, "request rate limited");
    await reply
      .code(429)
      .header("retry-after", String(Math.max(1, Math.ceil((window.start + windowMs - at) / 1000))))
      .send(apiError("rate_limited", "Too many requests; retry later."));
  });

  app.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => {
    if (reply.statusCode !== 401) return;
    windowFor(request.ip, now()).refused += 1;
  });
}
