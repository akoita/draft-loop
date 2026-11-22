/**
 * Deleting a person's account at the identity provider once the service has erased everything it
 * held about them (#3033). The API holds only a narrow client of the provider's admin interface:
 * it may delete users of the sign-in realm, and nothing in any other realm.
 */
export interface IdentityAccounts {
  /** Deletes the account the sign-in names; an account already gone counts as deleted. */
  readonly deleteAccount: (subject: string) => Promise<void>;
  /**
   * Makes sure an invited email has a sign-in account, since the realm lets nobody register
   * (#3082). A new account, or one without a password yet, gets the provider's own email with a
   * link to choose a password: `password-email`. That email is the invite itself, worded by the
   * realm's Redakloop theme (deploy/keycloak). An account that has a password gets nothing:
   * `exists`.
   */
  readonly prepareInvitedAccount: (input: {
    readonly email: string;
    readonly locale?: "en" | "fr";
  }) => Promise<InvitedAccount>;
}

export type InvitedAccount = "password-email" | "exists";

/**
 * Where the choose-a-password link returns: the web screen, told by `#welcome` to go straight on
 * to sign-in, after which the invite is found by the verified email.
 */
export const welcomeFragment = "#welcome";

/** How long the provider's choose-a-password link works: 7 days, then Forgot password serves. */
export const passwordLinkLifespanSeconds = 7 * 24 * 60 * 60;

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
  /**
   * The web screen's client and address: the choose-a-password link returns there. Without them
   * the API cannot prepare an invited person's sign-in.
   */
  readonly webClientId?: string;
  readonly screenUrl?: string;
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
const emailPattern = /^[^@\s]{1,200}@[^@\s]{1,200}$/u;

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

  const admin = `${base}/admin/realms/${realmName}`;

  async function adminCall(
    token: string,
    path: string,
    init: { readonly method?: string; readonly body?: unknown } = {},
  ): Promise<Response> {
    return call(`${admin}${path}`, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: signal(),
    });
  }

  function refused(what: string, response: Response): IdentityAccountsError {
    return new IdentityAccountsError(`The identity provider did not ${what} (${response.status}).`);
  }

  /** The id of the account whose email is exactly `email`, or undefined. */
  async function accountIdFor(token: string, email: string): Promise<string | undefined> {
    const response = await adminCall(
      token,
      `/users?exact=true&briefRepresentation=true&email=${encodeURIComponent(email)}`,
    );
    if (!response.ok) throw refused("find the account", response);
    const users: unknown = await response.json();
    if (!Array.isArray(users)) return undefined;
    const match = users.find(
      (user: unknown) =>
        typeof user === "object" &&
        user !== null &&
        String((user as { email?: unknown }).email ?? "").toLowerCase() === email,
    ) as { id?: unknown } | undefined;
    return typeof match?.id === "string" ? match.id : undefined;
  }

  return {
    prepareInvitedAccount: async ({ email: given, locale }) => {
      const email = given.trim().toLowerCase();
      if (!emailPattern.test(email)) {
        throw new IdentityAccountsError("An invited account needs an email address.");
      }
      if (options.webClientId === undefined || options.screenUrl === undefined) {
        throw new IdentityAccountsError("The web screen's client and address are not set.");
      }
      const token = await accessToken();
      // Only the emailed link sets the password, so whoever signs in has opened this mailbox:
      // the address counts as verified from the start.
      const created = await adminCall(token, "/users", {
        method: "POST",
        body: {
          username: email,
          email,
          enabled: true,
          emailVerified: true,
          ...(locale === undefined ? {} : { attributes: { locale: [locale] } }),
        },
      });
      if (!created.ok && created.status !== 409) throw refused("create the account", created);
      const id = await accountIdFor(token, email);
      if (id === undefined || !subjectPattern.test(id)) {
        throw new IdentityAccountsError("The identity provider has no account for that email.");
      }
      if (created.status === 409) {
        const credentials = await adminCall(token, `/users/${id}/credentials`);
        if (!credentials.ok) throw refused("list the account's credentials", credentials);
        const list: unknown = await credentials.json();
        const hasPassword =
          Array.isArray(list) &&
          list.some(
            (item: unknown) =>
              typeof item === "object" &&
              item !== null &&
              (item as { type?: unknown }).type === "password",
          );
        if (hasPassword) return "exists";
      }
      const query = new URLSearchParams({
        client_id: options.webClientId,
        redirect_uri: `${options.screenUrl}${welcomeFragment}`,
        lifespan: String(passwordLinkLifespanSeconds),
      });
      const sent = await adminCall(token, `/users/${id}/execute-actions-email?${query}`, {
        method: "PUT",
        body: ["UPDATE_PASSWORD"],
      });
      if (!sent.ok) throw refused("send the password email", sent);
      return "password-email";
    },

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
