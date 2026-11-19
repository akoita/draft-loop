import { t } from "@lingui/core/macro";

/** Provider sign-in readiness as the application screen's start checklist reads it. */
export type ProviderSignInState = "ready" | "missing" | "unknown";

export interface ProviderSignInReadiness {
  readonly state: ProviderSignInState;
  /** The checklist's one-line summary. */
  readonly summary: string | null;
}

/**
 * The server holds the provider keys (#2866): there is nothing for the person to sign in to, so
 * the start checklist reads it as ready.
 */
export function serverHeldProviderSignIn(): ProviderSignInReadiness {
  return { state: "ready", summary: t`The service provides the models` };
}
