import {
  type ProviderAuthModeConfiguration,
  resolveProviderAuthModes,
} from "./glm-provider-routing.js";

/**
 * Reads how local runs sign in to each provider: `DRAFT_LOOP_ANTHROPIC_AUTH_MODE` and
 * `DRAFT_LOOP_OPENAI_AUTH_MODE`, each `api-key` (the default) or `user-session` (the signed-in
 * claude or codex CLI). An empty value counts as unset; any other value is refused.
 */
export function providerAuthModesFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): ProviderAuthModeConfiguration {
  const value = (name: string) => {
    const raw = environment[name]?.trim();
    return raw === undefined || raw === "" ? undefined : raw;
  };
  return resolveProviderAuthModes(
    undefined,
    value("DRAFT_LOOP_ANTHROPIC_AUTH_MODE"),
    value("DRAFT_LOOP_OPENAI_AUTH_MODE"),
  );
}
