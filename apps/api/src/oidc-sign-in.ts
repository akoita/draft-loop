import { createRemoteJWKSet, errors, type JWTVerifyGetKey, jwtVerify } from "jose";
import { z } from "zod";

/**
 * Sign-in through the identity provider (ADR 0011, D6): the web screen signs a person in with
 * OpenID Connect, and the API accepts the provider's access tokens, verified against its published
 * keys. A verified token names a person; the tenant directory says which organisation they belong
 * to and with which role.
 */

export type MemberRole = "owner" | "admin" | "member";

/** Who the identity provider says signed in; the email counts only when it is verified. */
export interface SignInIdentity {
  readonly issuer: string;
  readonly subject: string;
  readonly email?: string;
  readonly emailVerified: boolean;
}

/** An active membership of one organisation, the tenant. */
export interface SignedInMember {
  readonly tenantId: string;
  readonly memberId: string;
  readonly role: MemberRole;
}

/** Finds the signed-in person's active membership, as the tenant directory's `resolveSignIn`. */
export type ResolveSignIn = (identity: SignInIdentity) => Promise<SignedInMember | undefined>;

/** The identity provider the API trusts, from `DRAFT_LOOP_OIDC_*`. */
export interface OidcSettings {
  /** The provider's issuer, compared exactly with each token's `iss`. */
  readonly issuer: string;
  /** The API's audience, compared exactly with each token's `aud`. */
  readonly audience: string;
  /** The web screen's public client id, which the screen signs in with. */
  readonly webClientId: string;
  /** Where the provider publishes its keys; discovered from the issuer when unset. */
  readonly jwksUrl?: string;
  /** Whether plain-http provider addresses are accepted, for the local stack only. */
  readonly allowHttp: boolean;
}

/** Asymmetric signatures only: never `none`, and never a shared secret. */
export const signInAlgorithms = ["RS256", "ES256", "PS256"] as const;

/** How far apart the provider's clock and the API's may drift, in seconds. */
export const signInClockToleranceSeconds = 30;

const providerTimeoutMs = 5_000;

/** The provider could not be reached or answered with something unusable. */
export class IdentityProviderUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super("The identity provider could not be reached.", options);
    this.name = "IdentityProviderUnavailableError";
  }
}

/** Whether a provider address is one the API may fetch keys from. */
export function isProviderUrl(text: string, allowHttp: boolean): boolean {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) return false;
  return url.username === "" && url.password === "" && url.hash === "";
}

const discoverySchema = z.object({ issuer: z.string(), jwks_uri: z.string() });

/** Reads the provider's key address from its OpenID Connect discovery document. */
async function discoverJwksUrl(settings: OidcSettings): Promise<URL> {
  const discovery = `${settings.issuer.replace(/\/+$/u, "")}/.well-known/openid-configuration`;
  const response = await fetch(discovery, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(providerTimeoutMs),
  });
  if (!response.ok) throw new Error(`Discovery answered ${response.status}.`);
  const document = discoverySchema.parse(await response.json());
  // A document for another issuer would let its keys sign for this one.
  if (document.issuer !== settings.issuer) throw new Error("Discovery names another issuer.");
  if (!isProviderUrl(document.jwks_uri, settings.allowHttp)) {
    throw new Error("Discovery names a key address the API does not fetch.");
  }
  return new URL(document.jwks_uri);
}

/**
 * The provider's published keys, fetched when first needed and refreshed by `jose`: a token signed
 * by an unknown key refetches them at most every 30 seconds, and they expire after 10 minutes.
 */
export function remoteSignInKeys(settings: OidcSettings): JWTVerifyGetKey {
  let keys: Promise<JWTVerifyGetKey> | undefined;
  const load = async (): Promise<JWTVerifyGetKey> =>
    createRemoteJWKSet(
      settings.jwksUrl === undefined ? await discoverJwksUrl(settings) : new URL(settings.jwksUrl),
      { timeoutDuration: providerTimeoutMs, cooldownDuration: 30_000, cacheMaxAge: 600_000 },
    );
  return async (header, token) => {
    if (keys === undefined) {
      const pending = load();
      keys = pending;
      // A failed discovery is retried by the next request rather than remembered.
      pending.catch(() => {
        if (keys === pending) keys = undefined;
      });
    }
    return (await keys)(header, token);
  };
}

/** `jose` refusals that mean the token is not acceptable, rather than the provider unreachable. */
const refusedTokenCodes: ReadonlySet<string> = new Set([
  errors.JWTExpired.code,
  errors.JWTClaimValidationFailed.code,
  errors.JWTInvalid.code,
  errors.JWSInvalid.code,
  errors.JWSSignatureVerificationFailed.code,
  errors.JOSEAlgNotAllowed.code,
  errors.JOSENotSupported.code,
  errors.JWKSNoMatchingKey.code,
  errors.JWKSMultipleMatchingKeys.code,
]);

export type SignInVerification =
  | { readonly status: "verified"; readonly identity: SignInIdentity }
  /** `reason` is `jose`'s error code, safe to log: it never quotes the token. */
  | { readonly status: "refused"; readonly reason: string };

export type VerifySignInToken = (token: string) => Promise<SignInVerification>;

/**
 * Verifies an access token: signed by one of the provider's keys with an allowed algorithm, from
 * the configured issuer for the API's audience, current, and naming its subject. Throws
 * {@link IdentityProviderUnavailableError} when the provider's keys cannot be had.
 */
export function signInTokenVerifier(
  settings: Pick<OidcSettings, "issuer" | "audience">,
  keys: JWTVerifyGetKey,
): VerifySignInToken {
  return async (token) => {
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(token, keys, {
        issuer: settings.issuer,
        audience: settings.audience,
        algorithms: [...signInAlgorithms],
        clockTolerance: signInClockToleranceSeconds,
        requiredClaims: ["sub", "exp"],
      }));
    } catch (error) {
      if (error instanceof errors.JOSEError && refusedTokenCodes.has(error.code)) {
        return { status: "refused", reason: error.code };
      }
      throw new IdentityProviderUnavailableError({ cause: error });
    }
    const { sub, email, email_verified: emailVerified } = payload;
    if (typeof sub !== "string" || sub === "") return { status: "refused", reason: "subject" };
    return {
      status: "verified",
      identity: {
        issuer: settings.issuer,
        subject: sub,
        ...(typeof email === "string" && email !== "" ? { email } : {}),
        emailVerified: emailVerified === true,
      },
    };
  };
}
