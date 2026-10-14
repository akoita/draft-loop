import type { ProviderAuthModeConfiguration } from "@draft-loop/application";
import { defaultUserSessionTimeoutMs } from "@draft-loop/providers";

/**
 * The time limit each provider call has on the route the executing step uses, or `null` when the
 * route sets none of its own.
 *
 * Only the local subscription-session route caps each call. The desktop does not override the
 * session timeout, so the effective limit is the provider package default. Fixture runs make no
 * provider call, and the API route has no per-call limit configured here.
 */
export function executionCallLimitMs(
  company: string,
  fixtureMode: boolean,
  providerAuthModeConfiguration: ProviderAuthModeConfiguration,
): number | null {
  if (fixtureMode) return null;
  const provider = company.trim().toLowerCase();
  if (provider !== "anthropic" && provider !== "openai") return null;
  return providerAuthModeConfiguration[provider] === "user-session"
    ? defaultUserSessionTimeoutMs
    : null;
}
