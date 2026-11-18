/**
 * Deleting a person's account at the identity provider once the service has erased everything it
 * held about them (#3033). The API holds only a narrow client of the provider's admin interface:
 * it may delete users of the sign-in realm, and nothing in any other realm.
 */
export interface IdentityAccounts {
  /** Deletes the account the sign-in names; an account already gone counts as deleted. */
  readonly deleteAccount: (subject: string) => Promise<void>;
}

export class IdentityAccountsError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "IdentityAccountsError";
  }
}

export interface KeycloakAccountsOptions {
  /** The realm's issuer, `https://host/realms/<realm>`, as sign-in verifies it. */
  readonly issuer: string;
  /** The realm's confidential client whose service account holds `manage-users` only. */
  readonly clientId: string;
  readonly clientSecret: string;
  /**
   * Where the API reaches Keycloak, such as its internal address when the issuer is a public host
   * the API cannot reach; the issuer's own host when unset.
   */
  readonly baseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
  /** Each call's limit; 10 seconds when unset. */
  readonly timeoutMs?: number;
}

const realmPath = /^(?<base>.+)\/realms\/(?<realm>[^/]+)\/?$/u;

/** The admin base and realm an issuer names, or undefined for an issuer of another shape. */
export function keycloakRealmOf(
  issuer: string,
): { readonly base: string; readonly realm: string } | undefined {
  const match = realmPath.exec(issuer);
  const base = match?.groups?.base;
  const realm = match?.groups?.realm;
  return base === undefined || realm === undefined ? undefined : { base, realm };
}

const subjectPattern = /^[A-Za-z0-9-]{1,64}$/u;

/**
 * Keycloak's admin interface: a client-credentials token from the realm's own token endpoint, then
 * `DELETE /admin/realms/<realm>/users/<subject>`. A 404 means the account is already gone.
 */
export function keycloakAccounts(options: KeycloakAccountsOptions): IdentityAccounts {
  const realm = keycloakRealmOf(options.issuer);
  if (realm === undefined) {
    throw new IdentityAccountsError("The sign-in issuer does not name a Keycloak realm.");
  }
  const call = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const signal = () => AbortSignal.timeout(timeoutMs);
  const base = (options.baseUrl ?? realm.base).replace(/\/$/u, "");
  const realmName = encodeURIComponent(realm.realm);
  const tokenUrl = `${base}/realms/${realmName}/protocol/openid-connect/token`;

  async function accessToken(): Promise<string> {
    const response = await call(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: options.clientId,
        client_secret: options.clientSecret,
      }),
      signal: signal(),
    });
    if (!response.ok) {
      throw new IdentityAccountsError(
        `The identity provider refused the client (${response.status}).`,
      );
    }
    const body: unknown = await response.json();
    const token =
      typeof body === "object" && body !== null
        ? (body as { access_token?: unknown }).access_token
        : undefined;
    if (typeof token !== "string" || token === "") {
      throw new IdentityAccountsError("The identity provider returned no access token.");
    }
    return token;
  }

  return {
    deleteAccount: async (subject) => {
      if (!subjectPattern.test(subject)) {
        throw new IdentityAccountsError("The sign-in subject is not a Keycloak user id.");
      }
      const token = await accessToken();
      const response = await call(`${base}/admin/realms/${realmName}/users/${subject}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
        signal: signal(),
      });
      if (response.ok || response.status === 404) return;
      throw new IdentityAccountsError(
        `The identity provider did not delete the account (${response.status}).`,
      );
    },
  };
}

/**
 * The account client from `DRAFT_LOOP_IDENTITY_ADMIN_CLIENT_ID` and
 * `DRAFT_LOOP_IDENTITY_ADMIN_CLIENT_SECRET`, both or neither, and where to reach Keycloak from
 * `DRAFT_LOOP_IDENTITY_ADMIN_URL`, an origin, when the issuer's host is not reachable. Without them accounts are erased
 * at the service and the identity stays, which the answer and a log line say.
 */
export function identityAdminClientFromEnv(
  env: NodeJS.ProcessEnv,
):
  | { readonly clientId: string; readonly clientSecret: string; readonly baseUrl?: string }
  | undefined {
  const clientId = env.DRAFT_LOOP_IDENTITY_ADMIN_CLIENT_ID ?? "";
  const clientSecret = env.DRAFT_LOOP_IDENTITY_ADMIN_CLIENT_SECRET ?? "";
  if (clientId === "" && clientSecret === "") return undefined;
  if (clientId === "" || clientSecret === "") {
    throw new IdentityAccountsError(
      "Set both DRAFT_LOOP_IDENTITY_ADMIN_CLIENT_ID and DRAFT_LOOP_IDENTITY_ADMIN_CLIENT_SECRET, or neither.",
    );
  }
  const baseUrl = env.DRAFT_LOOP_IDENTITY_ADMIN_URL ?? "";
  if (baseUrl !== "" && !/^https?:\/\/[^/?#]+\/?$/u.test(baseUrl)) {
    throw new IdentityAccountsError(
      "DRAFT_LOOP_IDENTITY_ADMIN_URL must be an origin, such as https://id.example.",
    );
  }
  return { clientId, clientSecret, ...(baseUrl === "" ? {} : { baseUrl }) };
}
