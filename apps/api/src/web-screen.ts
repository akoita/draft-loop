import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

/**
 * The content security policy for every response. The web screen loads only its own scripts and
 * styles and talks only to this origin, so injected script has nowhere to load from or send to.
 */
export const contentSecurityPolicy = {
  useDefaults: false,
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'"],
    imgSrc: ["'self'", "data:", "blob:"],
    fontSrc: ["'self'"],
    connectSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'none'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
  },
} as const;

/**
 * Whether a request needs no owner token: health, and the web screen's files. The screen's
 * catch-all route also matches unknown `/v1` paths, so the request's own path decides.
 */
export function isPublicRequest(routeUrl: string | undefined, path: string): boolean {
  if (routeUrl === "/v1/health") return true;
  return routeUrl !== undefined && path !== "/v1" && !path.startsWith("/v1/");
}

/**
 * Serves the built web screen (`apps/web`) at `/`, on the same origin as the API (ADR 0011, D9).
 * Its files hold no data; everything the owner sees comes from `/v1` with the owner token.
 */
export async function registerWebScreen(app: FastifyInstance, root: string): Promise<void> {
  await app.register(fastifyStatic, {
    root,
    prefix: "/",
    index: ["index.html"],
    setHeaders(reply, path) {
      // Vite names assets by their content hash, so only the page itself must be revalidated.
      reply.header(
        "cache-control",
        path.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
      );
    },
  });
}
