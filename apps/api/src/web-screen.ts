import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

import { authConfigPath } from "./auth-config-routes.js";
import { waitlistConfirmPath, waitlistPath } from "./beta-waitlist-routes.js";
import { clientErrorsPath } from "./client-error-routes.js";
import { ownerTokenProofPath } from "./owner-token-proof-routes.js";
import { paymentEventsPath } from "./payment-checkout.js";
import type { ApiAuthOptions } from "./request-auth.js";
import { serviceNoticePath } from "./service-notice.js";

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
      // The speech worker compiles the ONNX runtime's WebAssembly (#2200); this allows only that,
      // never string evaluation.
      scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"],
      // The live interview plays each spoken question from an object URL (#2362).
      mediaSrc: ["'self'", "blob:"],
      fontSrc: ["'self'"],
      connectSrc,
      objectSrc: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  };
}

/**
 * The `/v1` routes anyone may call: health, how the web screen signs in, the token proof, the
 * screen's crash reports, and the waitlist's join and confirmation.
 */
const publicApiRoutes: ReadonlySet<string> = new Set([
  "/v1/health",
  authConfigPath,
  clientErrorsPath,
  serviceNoticePath,
  ownerTokenProofPath,
  waitlistPath,
  // A confirmation link's token is the proof; the route limits attempts per address.
  waitlistConfirmPath,
  // The payment provider's events carry no credential; their signature is checked by the route.
  paymentEventsPath,
]);

/**
 * Whether a request needs no credential: the public `/v1` routes, and the web screen's files. The
 * screen's catch-all route also matches unknown `/v1` paths, so the request's own path decides.
 */
export function isPublicRequest(routeUrl: string | undefined, path: string): boolean {
  if (routeUrl !== undefined && publicApiRoutes.has(routeUrl)) return true;
  return routeUrl !== undefined && path !== "/v1" && !path.startsWith("/v1/");
}

/**
 * Vite names assets by their content hash, so they never change. Pages must be revalidated, and
 * the public pages' images and styles may change with a release, so they keep for an hour.
 */
export function cacheControl(path: string): string {
  if (path.includes("/assets/")) return "public, max-age=31536000, immutable";
  if (/\.(?:webp|png|svg|ico|css|js)$/u.test(path)) return "public, max-age=3600";
  return "no-cache";
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
    // The build writes a Brotli and a gzip copy beside each large asset; others go uncompressed.
    preCompressed: true,
    setHeaders(reply, path) {
      reply.header("cache-control", cacheControl(path));
    },
  });
}
