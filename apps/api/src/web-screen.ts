import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

import { authConfigPath } from "./auth-config-routes.js";
import type { ApiAuthOptions } from "./request-auth.js";

/**
 * The content security policy for every response. The web screen loads only its own scripts and
 * styles and talks only to this origin, so injected script has nowhere to load from or send to.
 * In sign-in mode it also talks to the identity provider's origin, for its discovery document and
 * token endpoint; the sign-in and sign-out redirects are navigations, which the policy leaves alone.
 */
export function contentSecurityPolicy(auth: ApiAuthOptions = { mode: "owner" }) {
  const connectSrc = auth.mode === "oidc" ? ["'self'", new URL(auth.issuer).origin] : ["'self'"];
  return {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"],
      fontSrc: ["'self'"],
      connectSrc,
      objectSrc: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  };
}

/** The `/v1` routes anyone may call: health, and how the web screen signs in. */
const publicApiRoutes: ReadonlySet<string> = new Set(["/v1/health", authConfigPath]);

/**
 * Whether a request needs no credential: the public `/v1` routes, and the web screen's files. The
 * screen's catch-all route also matches unknown `/v1` paths, so the request's own path decides.
 */
export function isPublicRequest(routeUrl: string | undefined, path: string): boolean {
  if (routeUrl !== undefined && publicApiRoutes.has(routeUrl)) return true;
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
