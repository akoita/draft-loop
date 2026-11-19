import type { AgentTokenStore } from "@draft-loop/storage/agent-tokens";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { JWTVerifyGetKey } from "jose";
import { type AgentGrant, admitAgentGrant, agentGrantId, agentGrantOf } from "./agent-grant.js";
import { admitAgentBody, admitAgentRoute } from "./agent-route-scopes.js";
import {
  type AgentAuthentication,
  agentTokenTenant,
  authenticateAgentToken,
  isAgentTokenShape,
} from "./agent-token-auth.js";
import { apiError } from "./errors.js";
import {
  IdentityProviderUnavailableError,
  type OidcSettings,
  type ResolveSignIn,
  remoteSignInKeys,
  type SignedInMember,
  type SignInIdentity,
  type SignInVerification,
  signInTokenVerifier,
  type VerifySignInToken,
} from "./oidc-sign-in.js";
import { isOwnerAuthorization } from "./owner-access.js";
import { isPublicRequest } from "./web-screen.js";

/** Who made a request: the owner, by the owner token, or a signed-in organisation member. */
export type Caller =
  | { readonly kind: "owner" }
  | ({
      readonly kind: "member";
      /** Whether this sign-in would also pass on operator routes (#2953), for the screen. */
      readonly operator?: true;
      /** Whether the sign-in carries the operator role, with or without a second factor. */
      readonly holdsOperatorRole?: true;
      /** Whether the person used a second factor (`amr`) for this sign-in (#2952). */
      readonly secondFactor?: true;
    } & SignedInMember);

declare module "fastify" {
  interface FastifyRequest {
    /** Who made the request; unset on public requests, such as health and the web screen. */
    caller: Caller | undefined;
    /**
     * A verified sign-in with no membership, set only on the sign-up route (#2502), which may
     * create the person's account from an invite code.
     */
    signUpIdentity: SignInIdentity | undefined;
    /**
     * The person's own verified sign-in, set when a member signed in themselves (never through an
     * agent token or an assistant's grant), for the routes that act on the account itself (#3033).
     */
    signInIdentity: SignInIdentity | undefined;
  }
}

/** The one route a verified sign-in without a membership reaches. */
export const signUpRoute = "/v1/sign-up";

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
  | {
      readonly outcome: "authenticated";
      readonly caller: Caller;
      readonly grant?: AgentGrant;
      readonly identity?: SignInIdentity;
    }
  | { readonly outcome: "unauthenticated"; readonly reason?: string }
  | { readonly outcome: "forbidden"; readonly identity?: SignInIdentity };

type Authenticator = (authorization: string | undefined) => Promise<Authentication>;

/**
 * Sign-in mode's agent tokens (#2784): a token a member issued names its tenant, whose store
 * holds its hash, and acts as that member while they stay an active member.
 */
export interface MemberAgentTokens {
  readonly tokensFor: (tenantId: string) => AgentTokenStore | undefined;
  /** The member as they are now; undefined once they left the organisation or are not active. */
  readonly memberOf: (tenantId: string, memberId: string) => Promise<SignedInMember | undefined>;
}

/** A presented token as an accepted agent, with the caller it acts as, or the refusal. */
async function agentTokenCaller(
  token: string,
  ownerTokens: AgentTokenStore | undefined,
  memberTokens: MemberAgentTokens | undefined,
): Promise<
  | {
      readonly outcome: "agent";
      readonly agent: AgentAuthentication & { outcome: "agent" };
      readonly caller: Caller;
    }
  | { readonly outcome: "unauthenticated"; readonly reason: string }
  | undefined
> {
  if (!isAgentTokenShape(token)) return undefined;
  const tenantId = agentTokenTenant(token);
  if (tenantId === undefined) {
    if (ownerTokens === undefined) return undefined;
    const agent = await authenticateAgentToken(ownerTokens, token);
    // It acts in the owner's tenant, on the routes its scopes admit only.
    return agent.outcome === "agent"
      ? { outcome: "agent", agent, caller: { kind: "owner" } }
      : agent;
  }
  const store = memberTokens?.tokensFor(tenantId);
  if (memberTokens === undefined || store === undefined) return undefined;
  const agent = await authenticateAgentToken(store, token);
  if (agent.outcome !== "agent") return agent;
  if (agent.memberId === undefined) {
    return { outcome: "unauthenticated", reason: "agent token without a member" };
  }
  const member = await memberTokens.memberOf(tenantId, agent.memberId);
  if (member === undefined || member.tenantId !== tenantId) {
    return { outcome: "unauthenticated", reason: "agent token of an inactive member" };
  }
  return { outcome: "agent", agent, caller: { kind: "member", ...member } };
}

/**
 * The request's credential. A browser cannot set headers on a WebSocket, so the live interview
 * sends its bearer token as the `bearer.<token>` subprotocol; only an upgrade may use it.
 */
export function requestAuthorization(headers: FastifyRequest["headers"]): string | undefined {
  if (headers.authorization !== undefined) return headers.authorization;
  if (headers.upgrade?.toLowerCase() !== "websocket") return undefined;
  const protocols = String(headers["sec-websocket-protocol"] ?? "").split(",");
  const token = protocols.map((protocol) => protocol.trim()).find((p) => p.startsWith("bearer."));
  return token === undefined ? undefined : `Bearer ${token.slice("bearer.".length)}`;
}

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
function signInAuthenticator(
  verify: VerifySignInToken,
  resolve: ResolveSignIn,
  webClientId: string,
  memberClientIds: readonly string[],
): Authenticator {
  return async (authorization) => {
    const token = bearerToken(authorization);
    if (token === undefined) return { outcome: "unauthenticated" };
    const verification = await verify(token);
    if (verification.status === "refused") {
      return { outcome: "unauthenticated", reason: verification.reason };
    }
    const grant = agentGrantOf(verification, webClientId, memberClientIds);
    const member = await resolve(verification.identity);
    // Only the web screen's own sign-in may go on to create an account (#2646).
    if (member === undefined) {
      const memberClient =
        verification.clientId !== undefined && memberClientIds.includes(verification.clientId);
      return grant === undefined && !memberClient
        ? { outcome: "forbidden", identity: verification.identity }
        : { outcome: "forbidden" };
    }
    return {
      outcome: "authenticated",
      ...(grant === undefined ? { identity: verification.identity } : { grant }),
      caller: {
        kind: "member",
        tenantId: member.tenantId,
        memberId: member.memberId,
        role: member.role,
        ...(operatorRefusal(verification, webClientId) === undefined
          ? { operator: true as const }
          : {}),
        ...(verification.roles.includes(operatorRole) ? { holdsOperatorRole: true as const } : {}),
        ...(verification.methods.some((method) => secondFactorMethods.has(method))
          ? { secondFactor: true as const }
          : {}),
      },
    };
  };
}

/** The realm role that lets a person act as the operator (#2953). */
export const operatorRole = "draft-loop-operator";

/**
 * `amr` values that mean a second factor: a one-time code, a hardware or software key, or the
 * provider's own multi-factor marker. A password alone (`pwd`) never counts.
 */
export const secondFactorMethods: ReadonlySet<string> = new Set(["otp", "mfa", "hwk", "swk"]);

/** The person a sign-in names as the operator, for the request's log lines. */
export interface OperatorSignIn {
  readonly subject: string;
  readonly methods: readonly string[];
}

type OperatorAuthentication = Authentication & { readonly operator?: OperatorSignIn };

type OperatorAuthenticator = (authorization: string | undefined) => Promise<OperatorAuthentication>;

/**
 * Operator routes: the owner token, in both modes, or in sign-in mode a named person (#2953). That
 * person signed in through the web screen's own client, holds the realm's operator role, and used
 * a second factor. They act as the owner on operator routes only; a membership is not needed.
 */
function operatorAuthenticator(
  ownerToken: string,
  verify: VerifySignInToken | undefined,
  webClientId: string | undefined,
): OperatorAuthenticator {
  return async (authorization) => {
    if (isOwnerAuthorization(authorization, ownerToken)) {
      return { outcome: "authenticated", caller: { kind: "owner" } };
    }
    const token = bearerToken(authorization);
    if (verify === undefined || token === undefined) return { outcome: "unauthenticated" };
    const verification = await verify(token);
    if (verification.status === "refused") {
      return { outcome: "unauthenticated", reason: verification.reason };
    }
    const refusal = operatorRefusal(verification, webClientId);
    if (refusal !== undefined) return { outcome: "unauthenticated", reason: refusal };
    return {
      outcome: "authenticated",
      caller: { kind: "owner" },
      operator: { subject: verification.identity.subject, methods: verification.methods },
    };
  };
}

/** Why a verified sign-in may not act as the operator, or undefined when it may. */
function operatorRefusal(
  verification: SignInVerification & { readonly status: "verified" },
  webClientId: string | undefined,
): string | undefined {
  // Neither an assistant's grant nor a deployment's smoke client acts as the operator.
  if (verification.clientId === undefined || verification.clientId !== webClientId) {
    return "operator sign-in from another client";
  }
  if (!verification.roles.includes(operatorRole)) return "sign-in without the operator role";
  if (!verification.methods.some((method) => secondFactorMethods.has(method))) {
    return "operator sign-in without a second factor";
  }
  return undefined;
}

function signInVerifierFor(auth: ApiAuthOptions): VerifySignInToken | undefined {
  return auth.mode === "oidc"
    ? signInTokenVerifier(auth, auth.keys ?? remoteSignInKeys(auth))
    : undefined;
}

function authenticatorFor(
  ownerToken: string,
  auth: ApiAuthOptions,
  verify: VerifySignInToken | undefined,
): Authenticator {
  if (auth.mode === "owner" || verify === undefined) return ownerAuthenticator(ownerToken);
  return signInAuthenticator(
    verify,
    auth.resolveSignIn,
    auth.webClientId,
    auth.memberClientIds ?? [],
  );
}

const unauthorizedMessage: Readonly<Record<ApiAuthOptions["mode"] | "operator", string>> = {
  owner: "A valid owner token is required.",
  oidc: "A valid sign-in token is required.",
  operator: "The operator's token, or an operator's sign-in with a second factor, is required.",
};

async function refuse(
  reply: FastifyReply,
  credential: ApiAuthOptions["mode"] | "operator",
): Promise<void> {
  await reply
    .code(401)
    .header("www-authenticate", "Bearer")
    .send(apiError("unauthorized", unauthorizedMessage[credential]));
}

/**
 * Operator routes, such as creating an organisation, take only the operator's credential: the
 * deployment's owner token, in both modes, never a member's sign-in. Both the matched route and
 * the raw path are checked, so no spelling of the path reaches them with a sign-in token.
 */
export function isOperatorRequest(routeUrl: string | undefined, path: string): boolean {
  const operator = (url: string) => url === "/v1/operator" || url.startsWith("/v1/operator/");
  return (routeUrl !== undefined && operator(routeUrl)) || operator(path);
}

/**
 * Authenticates every request but health and the web screen's files, and records its caller on
 * `request.caller`, from which `registerTenantApplications` picks the tenant the request acts in.
 */
export function registerRequestAuthentication(
  app: FastifyInstance,
  ownerToken: string,
  auth: ApiAuthOptions = { mode: "owner" },
  /** The owner tenant's agent tokens (#2159); owner mode accepts them on their scopes' routes. */
  agentTokens?: AgentTokenStore,
  /** Whether connection caps are kept (#2656); without them a grant never reaches a spend. */
  grantSpendCaps = false,
  /** Sign-in mode's members' agent tokens (#2784); without them sign-in mode refuses tokens. */
  memberTokens?: MemberAgentTokens,
): void {
  const verify = signInVerifierFor(auth);
  const authenticate = authenticatorFor(ownerToken, auth, verify);
  const authenticateOperator = operatorAuthenticator(
    ownerToken,
    verify,
    auth.mode === "oidc" ? auth.webClientId : undefined,
  );
  const agents = auth.mode === "owner" ? agentTokens : undefined;
  const members = auth.mode === "oidc" ? memberTokens : undefined;
  app.decorateRequest("caller", undefined);
  app.decorateRequest("agentToken", undefined);
  app.decorateRequest("signUpIdentity", undefined);
  app.decorateRequest("signInIdentity", undefined);
  app.addHook("onRequest", async (request: FastifyRequest, reply) => {
    if (isPublicRequest(request.routeOptions.url, request.url)) return;
    const operator = isOperatorRequest(request.routeOptions.url, request.url);
    let authentication: OperatorAuthentication;
    try {
      authentication = await (operator ? authenticateOperator : authenticate)(
        requestAuthorization(request.headers),
      );
    } catch (error) {
      if (!(error instanceof IdentityProviderUnavailableError)) throw error;
      request.log.warn({ err: error.cause ?? error }, "identity provider unavailable");
      await reply
        .code(503)
        .send(apiError("identity_provider_unavailable", "Sign-in is unavailable; retry later."));
      return;
    }
    const presented = bearerToken(requestAuthorization(request.headers));
    if (authentication.outcome === "unauthenticated" && !operator && presented !== undefined) {
      const found = await agentTokenCaller(presented, agents, members);
      if (found?.outcome === "agent") {
        const { agent } = found;
        const admission = admitAgentRoute(request, agent);
        if (admission.outcome === "refused") {
          request.log.info({ agentTokenId: agent.id }, "agent token refused on this route");
          await reply.code(403).send(apiError("forbidden", admission.message));
          return;
        }
        // On the routes its scopes admit only. The line ties each accepted request to the
        // token, so a leaked token's use can be traced.
        request.log.info(
          {
            agentTokenId: agent.id,
            method: request.method,
            route: request.routeOptions.url,
            scope: admission.scope,
          },
          "agent token accepted",
        );
        request.caller = found.caller;
        request.agentToken = { id: agent.id, workspaceId: agent.workspaceId, scopes: agent.scopes };
        return;
      }
      // The reason (unknown, revoked, expired or inactive) is logged below; the answer stays 401.
      if (found !== undefined) authentication = found;
    }
    if (authentication.outcome === "authenticated") {
      const { grant } = authentication;
      if (grant !== undefined) {
        // An assistant's sign-in (#2646): the member, on the agent routes its scopes admit only.
        const admission = admitAgentGrant(request, grant, { spendCaps: grantSpendCaps });
        if (admission.outcome === "refused") {
          request.log.info({ agentClientId: grant.clientId }, "agent grant refused on this route");
          await reply.code(403).send(apiError("forbidden", admission.message));
          return;
        }
        request.log.info(
          {
            agentClientId: grant.clientId,
            method: request.method,
            route: request.routeOptions.url,
            scope: admission.scope,
          },
          "agent grant accepted",
        );
        if (admission.workspaceId !== undefined) {
          request.agentToken = {
            id: agentGrantId(grant),
            workspaceId: admission.workspaceId,
            scopes: grant.scopes,
            clientId: grant.clientId,
          };
        }
      }
      const { operator: signedInOperator } = authentication;
      if (signedInOperator !== undefined) {
        // Every line of the request names the person acting as the operator, so each operator
        // read or change can be traced to them (#2953).
        request.log = request.log.child({ operatorSubject: signedInOperator.subject });
        request.log.info(
          {
            method: request.method,
            route: request.routeOptions.url,
            methods: signedInOperator.methods,
          },
          "operator sign-in accepted",
        );
      }
      request.caller = authentication.caller;
      request.signInIdentity = authentication.identity;
      return;
    }
    if (authentication.outcome === "forbidden") {
      if (
        authentication.identity !== undefined &&
        request.method === "POST" &&
        request.routeOptions.url === signUpRoute
      ) {
        request.signUpIdentity = authentication.identity;
        return;
      }
      await reply
        .code(403)
        .send(apiError("no_account", "The signed-in account is not a member of an organisation."));
      return;
    }
    if (authentication.reason !== undefined) {
      request.log.info({ reason: authentication.reason }, "sign-in token refused");
    }
    await refuse(reply, operator ? "operator" : auth.mode);
  });
  // A body rule (such as pasted job text only) is checked once Fastify has parsed the body.
  app.addHook("preHandler", async (request: FastifyRequest, reply) => {
    if (request.agentToken === undefined) return;
    const admission = admitAgentBody(request);
    if (admission?.outcome !== "refused") return;
    request.log.info({ agentTokenId: request.agentToken.id }, "agent token refused on this body");
    await reply.code(403).send(apiError("forbidden", admission.message));
  });
}
