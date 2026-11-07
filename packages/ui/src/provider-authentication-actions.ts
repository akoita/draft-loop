import { t } from "@lingui/core/macro";
import type {
  CredentialProvider,
  ProviderAuthMode,
  ProviderAuthModeProvider,
  ProviderAuthModeStatus,
} from "./bridge.js";

export const credentialProviderLabels = (): Readonly<Record<CredentialProvider, string>> => ({
  anthropic: t`Anthropic`,
  openai: "OpenAI",
  deepinfra: "DeepInfra",
  google: t`Google Gemini`,
  mistral: t`Mistral`,
});

export const providerAuthModeLabels = (): Readonly<Record<ProviderAuthMode, string>> => ({
  "api-key": t`Provider API key`,
  "user-session": t`Authenticated Codex / ChatGPT subscription`,
});

export interface ProviderAuthenticationCallbacks {
  readonly onSetCredential?:
    | ((provider: CredentialProvider, apiKey: string) => Promise<void>)
    | undefined;
  readonly onRemoveCredential?: ((provider: CredentialProvider) => Promise<void>) | undefined;
  readonly onSetProviderAuthMode?:
    | ((
        provider: ProviderAuthModeProvider,
        mode: ProviderAuthMode,
      ) => Promise<ProviderAuthModeStatus>)
    | undefined;
}

/** What a credential action reports back to the dialog: one line of feedback, never the key. */
export interface ProviderAuthenticationOutcome {
  readonly ok: boolean;
  readonly feedback: string;
}

/** Saves a trimmed API key through the host. Returns null when there is nothing to save. */
export async function saveProviderCredential(
  callbacks: Pick<ProviderAuthenticationCallbacks, "onSetCredential">,
  provider: CredentialProvider,
  key: string,
): Promise<ProviderAuthenticationOutcome | null> {
  const { onSetCredential } = callbacks;
  if (onSetCredential === undefined || key.trim() === "") return null;
  try {
    await onSetCredential(provider, key.trim());
    return {
      ok: true,
      feedback: t`${credentialProviderLabels()[provider]} API key saved in app storage. Review the protection status below.`,
    };
  } catch (error: unknown) {
    return {
      ok: false,
      feedback: error instanceof Error ? error.message : t`Failed to save API key.`,
    };
  }
}

/** Removes the key the app stores for a provider. Returns null when the host cannot remove it. */
export async function removeProviderCredential(
  callbacks: Pick<ProviderAuthenticationCallbacks, "onRemoveCredential">,
  provider: CredentialProvider,
): Promise<ProviderAuthenticationOutcome | null> {
  const { onRemoveCredential } = callbacks;
  if (onRemoveCredential === undefined) return null;
  try {
    await onRemoveCredential(provider);
    return {
      ok: true,
      feedback: t`${credentialProviderLabels()[provider]} API key removed from app storage.`,
    };
  } catch {
    return { ok: false, feedback: t`Failed to remove API key.` };
  }
}

export interface ProviderAuthModeOutcome extends ProviderAuthenticationOutcome {
  readonly status?: ProviderAuthModeStatus;
}

/** Saves the OpenAI authentication mode preference. Returns null when the host cannot save it. */
export async function saveOpenAiAuthMode(
  callbacks: Pick<ProviderAuthenticationCallbacks, "onSetProviderAuthMode">,
  mode: ProviderAuthMode,
): Promise<ProviderAuthModeOutcome | null> {
  const { onSetProviderAuthMode } = callbacks;
  if (onSetProviderAuthMode === undefined) return null;
  try {
    const status = await onSetProviderAuthMode("openai", mode);
    return {
      ok: true,
      status,
      feedback: status.restartRequired
        ? t`${providerAuthModeLabels()[mode]} selected for OpenAI. Close and reopen DraftLoop to apply it.`
        : t`${providerAuthModeLabels()[mode]} is active for OpenAI.`,
    };
  } catch (error: unknown) {
    return {
      ok: false,
      feedback:
        error instanceof Error ? error.message : t`Failed to save provider authentication mode.`,
    };
  }
}
