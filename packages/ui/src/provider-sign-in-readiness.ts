import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CredentialProvider,
  CredentialStatus,
  ModelCompany,
  ProviderAuthMode,
  ProviderAuthModeProvider,
  ProviderAuthModeStatus,
} from "./bridge.js";
import { providerAuthenticationForPair } from "./provider-authentication-summary.js";

/**
 * Provider sign-in readiness as the host's status reads report it, shared by Home's provider
 * authentication card and the application screen's start checklist.
 *
 * What a read confirms: for an API-key route, `configured` means a key is stored in the app or
 * set in the environment, not that the provider accepts it. For a Claude or Codex session route
 * (`source: "user-session"`), the host runs the CLI's own login-status command, so `configured`
 * means the CLI is installed and reports a signed-in session; it does not prove the subscription
 * can run the chosen model.
 */

export type CredentialMap<T> = Readonly<Record<CredentialProvider, T>>;

export const credentialProviderIds: readonly CredentialProvider[] = [
  "anthropic",
  "openai",
  "deepinfra",
  "google",
  "mistral",
];

export function emptyCredentialStatus(provider: CredentialProvider): CredentialStatus {
  return { provider, configured: false, source: "none", protection: "none" };
}

export function emptyAuthModeStatus(provider: ProviderAuthModeProvider): ProviderAuthModeStatus {
  return {
    provider,
    activeMode: "api-key",
    preferredMode: "api-key",
    restartRequired: false,
    environmentOverride: false,
  };
}

export function mapProviders<T>(make: (provider: CredentialProvider) => T): CredentialMap<T> {
  return {
    anthropic: make("anthropic"),
    openai: make("openai"),
    deepinfra: make("deepinfra"),
    google: make("google"),
    mistral: make("mistral"),
  };
}

/** `unknown` covers a read still pending, a failed read and a host without status reads. */
export type ProviderSignInState = "ready" | "missing" | "unknown";

export interface ProviderSignInReadiness {
  readonly state: ProviderSignInState;
  /** Home's one-line summary, such as "Anthropic API key & OpenAI Codex session configured". */
  readonly summary: string | null;
}

export const unknownProviderSignIn: ProviderSignInReadiness = { state: "unknown", summary: null };

function credentialProviderForCompany(company: ModelCompany): CredentialProvider | null {
  switch (company) {
    case "anthropic":
    case "openai":
    case "google":
    case "mistral":
      return company;
    case "zai":
      return "deepinfra";
    default:
      return null;
  }
}

/** The credentials a run with this pair would use; both default providers without a pair. */
export function credentialProvidersForRoute(
  authorCompany: ModelCompany | undefined,
  criticCompany: ModelCompany | undefined,
): readonly CredentialProvider[] {
  if (authorCompany === undefined || criticCompany === undefined) return ["anthropic", "openai"];
  const providers = [authorCompany, criticCompany]
    .map(credentialProviderForCompany)
    .filter((provider): provider is CredentialProvider => provider !== null);
  return credentialProviderIds.filter((provider) => providers.includes(provider));
}

export type ReadOutcome = "pending" | "read" | "failed";

export interface ProviderSignInReadinessInput {
  /** The first round of credential reads has answered, successfully or not. */
  readonly loaded: boolean;
  readonly fixtureMode: boolean;
  readonly statuses: CredentialMap<CredentialStatus>;
  readonly outcomes: CredentialMap<ReadOutcome>;
  readonly anthropicMode: ProviderAuthMode;
  readonly openaiMode: ProviderAuthMode;
  readonly authorCompany?: ModelCompany | undefined;
  readonly criticCompany?: ModelCompany | undefined;
}

/**
 * The pair's readiness from the statuses read so far. It is `ready` or `missing` only when every
 * credential the pair uses was read; a pending or failed read leaves it `unknown`.
 */
export function providerSignInReadiness({
  loaded,
  fixtureMode,
  statuses,
  outcomes,
  anthropicMode,
  openaiMode,
  authorCompany,
  criticCompany,
}: ProviderSignInReadinessInput): ProviderSignInReadiness {
  if (!loaded && !fixtureMode) return unknownProviderSignIn;
  const pair = providerAuthenticationForPair({
    fixtureMode,
    anthropicConfigured: statuses.anthropic.configured,
    openaiConfigured: statuses.openai.configured,
    deepinfraConfigured: statuses.deepinfra.configured,
    googleConfigured: statuses.google.configured,
    mistralConfigured: statuses.mistral.configured,
    anthropicMode,
    openaiMode,
    ...(authorCompany === undefined ? {} : { authorCompany }),
    ...(criticCompany === undefined ? {} : { criticCompany }),
  });
  if (fixtureMode) return { state: "ready", summary: pair.summary };
  const routeRead = credentialProvidersForRoute(authorCompany, criticCompany).every(
    (provider) => outcomes[provider] === "read",
  );
  return {
    state: !routeRead ? "unknown" : pair.ready ? "ready" : "missing",
    summary: pair.summary,
  };
}

export interface ProviderSignInReadinessOptions {
  readonly getCredentialStatus?:
    | ((provider: CredentialProvider) => Promise<CredentialStatus>)
    | undefined;
  readonly getProviderAuthModeStatus?:
    | ((provider: ProviderAuthModeProvider) => Promise<ProviderAuthModeStatus>)
    | undefined;
  readonly fixtureMode?: boolean;
  readonly authorCompany?: ModelCompany | undefined;
  readonly criticCompany?: ModelCompany | undefined;
  /** The credentials to read; every provider by default, as Home's dialog shows them all. */
  readonly providers?: readonly CredentialProvider[];
  /** While false nothing is read; turning it on again reads afresh. Defaults to true. */
  readonly enabled?: boolean;
  /** A change, such as another workspace or application, reads afresh. Nothing polls. */
  readonly refreshKey?: string;
}

export interface ProviderSignInReadinessResult {
  readonly readiness: ProviderSignInReadiness;
  readonly statuses: CredentialMap<CredentialStatus>;
  readonly openaiAuthMode: ProviderAuthModeStatus;
  readonly setOpenaiAuthMode: (status: ProviderAuthModeStatus) => void;
  readonly refresh: () => void;
}

/**
 * Reads the credential and auth-mode statuses and derives the pair's sign-in readiness. A later
 * read replaces an earlier one; a stale answer never overwrites it.
 */
export function useProviderSignInReadiness({
  getCredentialStatus,
  getProviderAuthModeStatus,
  fixtureMode = false,
  authorCompany,
  criticCompany,
  providers = credentialProviderIds,
  enabled = true,
  refreshKey = "",
}: ProviderSignInReadinessOptions): ProviderSignInReadinessResult {
  const [loaded, setLoaded] = useState(false);
  const [statuses, setStatuses] = useState<CredentialMap<CredentialStatus>>(() =>
    mapProviders(emptyCredentialStatus),
  );
  const [outcomes, setOutcomes] = useState<CredentialMap<ReadOutcome>>(() =>
    mapProviders(() => "pending"),
  );
  const [anthropicAuthMode, setAnthropicAuthMode] = useState(() =>
    emptyAuthModeStatus("anthropic"),
  );
  const [openaiAuthMode, setOpenaiAuthMode] = useState(() => emptyAuthModeStatus("openai"));
  const refreshRun = useRef(0);
  const providersKey = providers.join(",");

  // biome-ignore lint/correctness/useExhaustiveDependencies: providersKey stands for providers.
  const refresh = useCallback(() => {
    if (getCredentialStatus === undefined) return;
    const run = ++refreshRun.current;
    const isCurrent = () => refreshRun.current === run;
    void Promise.all(
      providers.map((provider) =>
        getCredentialStatus(provider)
          .then((status) => {
            if (!isCurrent()) return;
            setStatuses((current) => ({ ...current, [provider]: status }));
            setOutcomes((current) => ({ ...current, [provider]: "read" }));
          })
          .catch(() => {
            if (isCurrent()) setOutcomes((current) => ({ ...current, [provider]: "failed" }));
          }),
      ),
    ).then(() => {
      if (isCurrent()) setLoaded(true);
    });
    if (getProviderAuthModeStatus === undefined) return;
    void getProviderAuthModeStatus("anthropic")
      .then((status) => isCurrent() && setAnthropicAuthMode(status))
      .catch(() => undefined);
    void getProviderAuthModeStatus("openai")
      .then((status) => isCurrent() && setOpenaiAuthMode(status))
      .catch(() => undefined);
  }, [getCredentialStatus, getProviderAuthModeStatus, providersKey]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey asks for a fresh read.
  useEffect(() => {
    if (!enabled) return;
    refresh();
    return () => {
      refreshRun.current += 1;
    };
  }, [refresh, enabled, refreshKey]);

  const readiness = providerSignInReadiness({
    loaded,
    fixtureMode,
    statuses,
    outcomes,
    anthropicMode: anthropicAuthMode.activeMode,
    openaiMode: openaiAuthMode.activeMode,
    authorCompany,
    criticCompany,
  });

  return { readiness, statuses, openaiAuthMode, setOpenaiAuthMode, refresh };
}
