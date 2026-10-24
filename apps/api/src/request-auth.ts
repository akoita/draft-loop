import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { JWTVerifyGetKey } from "jose";

import { apiError } from "./errors.js";
import {
  IdentityProviderUnavailableError,
  type OidcSettings,
  type ResolveSignIn,
  remoteSignInKeys,
  type SignedInMember,
  signInTokenVerifier,
  type VerifySignInToken,
} from "./oidc-sign-in.js";
import { isOwnerAuthorization } from "./owner-access.js";
import { isPublicRequest } from "./web-screen.js";

/** Who made a request: the owner, by the owner token, or a signed-in organisation member. */
export type Caller = { readonly kind: "owner" } | ({ readonly kind: "member" } & SignedInMember);

declare module "fastify" {
  interface FastifyRequest {
    /** Who made the request; unset on public requests, such as health and the web screen. */
    caller: Caller | undefined;
  }
}

/** How the API authenticates requests, from `DRAFT_LOOP_AUTH_MODE`. */
export type ApiAuthOptions =
  | { readonly mode: "owner" }
  | (OidcSettings & {
      readonly mode: "oidc";
      /** The tenant directory's sign-in lookup. */
      readonly resolveSignIn: ResolveSignIn;
      /** The provider's keys; fetched from its published key set when unset. */
      readonly keys?: JWTVerifyGetKey;
    });

type Authentication =
  | { readonly outcome: "authenticated"; readonly caller: Caller }
  | { readonly outcome: "unauthenticated"; readonly reason?: string }
  | { readonly outcome: "forbidden" };

type Authenticator = (authorization: string | undefined) => Promise<Authentication>;

function bearerToken(header: string | undefined): string | undefined {
  return header === undefined ? undefined : /^Bearer ([^\s]+)$/u.exec(header)?.[1];
}

/** Phase 1: the owner's token is the only credential. */
function ownerAuthenticator(ownerToken: string): Authenticator {
  return async (authorization) =>
    isOwnerAuthorization(authorization, ownerToken)
      ? { outcome: "authenticated", caller: { kind: "owner" } }
      : { outcome: "unauthenticated" };
}

/**
 * Sign-in: the provider's access token, whose person must hold an active membership. The owner
 * token is not accepted here; it is kept as the operator's credential for operator-only routes.
 */
function signInAuthenticator(verify: VerifySignInToken, resolve: ResolveSignIn): Authenticator {
  return async (authorization) => {
    const token = bearerToken(authorization);
    if (token === undefined) return { outcome: "unauthenticated" };
    const verification = await verify(token);
    if (verification.status === "refused") {
      return { outcome: "unauthenticated", reason: verification.reason };
    }
    const member = await resolve(verification.identity);
    if (member === undefined) return { outcome: "forbidden" };
    return {
      outcome: "authenticated",
      caller: {
        kind: "member",
        tenantId: member.tenantId,
        memberId: member.memberId,
        role: member.role,
      },
    };
  };
}

function authenticatorFor(ownerToken: string, auth: ApiAuthOptions): Authenticator {
  if (auth.mode === "owner") return ownerAuthenticator(ownerToken);
  return signInAuthenticator(
    signInTokenVerifier(auth, auth.keys ?? remoteSignInKeys(auth)),
    auth.resolveSignIn,
  );
}

const unauthorizedMessage: Readonly<Record<ApiAuthOptions["mode"], string>> = {
  owner: "A valid owner token is required.",
  oidc: "A valid sign-in token is required.",
};

async function refuse(reply: FastifyReply, mode: ApiAuthOptions["mode"]): Promise<void> {
  await reply
    .code(401)
    .header("www-authenticate", "Bearer")
    .send(apiError("unauthorized", unauthorizedMessage[mode]));
}

/**
 * Authenticates every request but health and the web screen's files, and records its caller on
 * `request.caller`, from which `registerTenantApplications` picks the tenant the request acts in.
 */
export function registerRequestAuthentication(
  app: FastifyInstance,
  ownerToken: string,
  auth: ApiAuthOptions = { mode: "owner" },
): void {
  const authenticate = authenticatorFor(ownerToken, auth);
  app.decorateRequest("caller", undefined);
  app.addHook("onRequest", async (request: FastifyRequest, reply) => {
    if (isPublicRequest(request.routeOptions.url, request.url)) return;
    let authentication: Authentication;
    try {
      authentication = await authenticate(request.headers.authorization);
    } catch (error) {
      if (!(error instanceof IdentityProviderUnavailableError)) throw error;
      request.log.warn({ err: error.cause ?? error }, "identity provider unavailable");
      await reply
        .code(503)
        .send(apiError("identity_provider_unavailable", "Sign-in is unavailable; retry later."));
      return;
    }
    if (authentication.outcome === "authenticated") {
      request.caller = authentication.caller;
      return;
    }
    if (authentication.outcome === "forbidden") {
      await reply
        .code(403)
        .send(apiError("forbidden", "The signed-in account is not a member of an organisation."));
      return;
    }
    if (authentication.reason !== undefined) {
      request.log.info({ reason: authentication.reason }, "sign-in token refused");
    }
    await refuse(reply, auth.mode);
  });
}
