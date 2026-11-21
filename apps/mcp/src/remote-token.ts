import { createRemoteJWKSet, errors, type JWTVerifyGetKey, jwtVerify } from "jose";

/**
 * The remote server's own check of a sign-in token (#3221). The MCP authorization spec requires
 * a server to accept only tokens issued for it (RFC 8707) and never to pass on one it has not
 * checked. So before any tool runs, the token must be signed by the identity provider, name this
 * server's MCP URL in its audience and be current. The API then checks the same token for its
 * own audience, which the provider adds alongside, and decides what it may do.
 */

/** Asymmetric signatures only, as the API accepts: never `none`, and never a shared secret. */
export const remoteTokenAlgorithms = ["RS256", "ES256", "PS256"] as const;

/** How far apart the provider's clock and this server's may drift, in seconds. */
export const remoteTokenClockToleranceSeconds = 30;

const providerTimeoutMs = 5_000;

export type RemoteTokenCheck =
  | {
      readonly status: "accepted";
      /** The token's `scope` claim, split: what the person granted this connection. */
      readonly scopes: readonly string[];
    }
  /** `reason` is `jose`'s error code, safe to log: it never quotes the token. */
  | { readonly status: "refused"; readonly reason: string };

export type CheckRemoteToken = (token: string) => Promise<RemoteTokenCheck>;

/** The provider's keys could not be had, so no token can be checked for now. */
export class IssuerUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super("The identity provider could not be reached.", options);
    this.name = "IssuerUnavailableError";
  }
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

interface Discovery {
  readonly issuer?: unknown;
  readonly jwks_uri?: unknown;
}

/** The key address from the issuer's OpenID Connect discovery document, for that issuer only. */
async function discoverJwksUrl(issuer: string): Promise<URL> {
  const response = await fetch(`${issuer.replace(/\/+$/u, "")}/.well-known/openid-configuration`, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(providerTimeoutMs),
  });
  if (!response.ok) throw new Error(`Discovery answered ${response.status}.`);
  const document = (await response.json()) as Discovery;
  // A document for another issuer would let its keys sign for this one.
  if (document.issuer !== issuer) throw new Error("Discovery names another issuer.");
  if (typeof document.jwks_uri !== "string" || !/^https:\/\/[^\s#]+$/u.test(document.jwks_uri)) {
    throw new Error("Discovery names a key address this server does not fetch.");
  }
  return new URL(document.jwks_uri);
}

/**
 * The issuer's published keys, found when first needed and refreshed by `jose`: a token signed by
 * an unknown key refetches them at most every 30 seconds, and they expire after 10 minutes.
 */
export function issuerKeys(issuer: string): JWTVerifyGetKey {
  let keys: Promise<JWTVerifyGetKey> | undefined;
  return async (header, token) => {
    if (keys === undefined) {
      const pending = discoverJwksUrl(issuer).then((url) =>
        createRemoteJWKSet(url, {
          timeoutDuration: providerTimeoutMs,
          cooldownDuration: 30_000,
          cacheMaxAge: 600_000,
        }),
      );
      keys = pending;
      // A failed discovery is retried by the next request rather than remembered.
      pending.catch(() => {
        if (keys === pending) keys = undefined;
      });
    }
    return (await keys)(header, token);
  };
}

/**
 * Checks a token for this server: an allowed signature by one of the issuer's keys, the
 * configured issuer, this server's MCP URL among its audiences, a subject, and not expired.
 * Throws {@link IssuerUnavailableError} when the issuer's keys cannot be had.
 */
export function remoteTokenChecker(
  oauth: { readonly resource: string; readonly issuer: string },
  keys: JWTVerifyGetKey = issuerKeys(oauth.issuer),
): CheckRemoteToken {
  return async (token) => {
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(token, keys, {
        issuer: oauth.issuer,
        audience: oauth.resource,
        algorithms: [...remoteTokenAlgorithms],
        clockTolerance: remoteTokenClockToleranceSeconds,
        requiredClaims: ["sub", "exp"],
      }));
    } catch (error) {
      if (error instanceof errors.JOSEError && refusedTokenCodes.has(error.code)) {
        return { status: "refused", reason: error.code };
      }
      throw new IssuerUnavailableError({ cause: error });
    }
    if (typeof payload.sub !== "string" || payload.sub === "") {
      return { status: "refused", reason: "subject" };
    }
    return {
      status: "accepted",
      scopes: typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : [],
    };
  };
}
