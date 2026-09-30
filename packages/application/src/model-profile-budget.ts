import type { ModelProfile } from "@draft-loop/domain/model-profile";
import { listModelProfileCatalog, type ModelProfileCatalogEntry } from "./model-profile-catalog.js";
import type { ModelProfileReferences } from "./model-profile-selection.js";
import { defaultModelProfileRegistry } from "./model-profiles.js";
import type { RunProviderAuthModeConfiguration } from "./run-model-profiles.js";

export interface ModelProfileTokenScenario {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly calls: number;
}

export interface ModelProfileApiScenarioInput {
  readonly profiles: ModelProfileReferences;
  readonly authModes?: RunProviderAuthModeConfiguration;
  readonly author: ModelProfileTokenScenario;
  readonly critic: ModelProfileTokenScenario;
}

export type ModelProfileApiScenarioUnavailableReason =
  | "unknown-profile"
  | "authentication-unavailable"
  | "subscription-billing"
  | "invalid-scenario"
  | "unsupported-pricing-scope"
  | "unsupported-pricing-limit";

export type ModelProfileApiScenarioEstimate =
  | {
      readonly status: "available";
      readonly authorUsd: number;
      readonly criticUsd: number;
      readonly totalUsd: number;
    }
  | {
      readonly status: "unavailable";
      readonly reason: ModelProfileApiScenarioUnavailableReason;
    };

const supportedPricingScope = "standard-uncached-text-api";
const maximumCallsPerRole = 1000;
const dollarsPerMillionTokens = 1_000_000;
const unavailable = (reason: ModelProfileApiScenarioUnavailableReason) => ({
  status: "unavailable" as const,
  reason,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validInput(value: unknown): value is ModelProfileApiScenarioInput {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.includes("profiles") &&
    keys.includes("author") &&
    keys.includes("critic") &&
    keys.every((key) => ["profiles", "authModes", "author", "critic"].includes(key))
  );
}

function validTokenScenario(value: unknown): value is ModelProfileTokenScenario {
  if (!isRecord(value)) return false;
  const scenario = value;
  return (
    Object.keys(scenario).length === 3 &&
    Object.keys(scenario).every((key) => ["inputTokens", "outputTokens", "calls"].includes(key)) &&
    Number.isSafeInteger(scenario.inputTokens) &&
    (scenario.inputTokens as number) >= 0 &&
    Number.isSafeInteger(scenario.outputTokens) &&
    (scenario.outputTokens as number) >= 0 &&
    Number.isSafeInteger(scenario.calls) &&
    (scenario.calls as number) >= 0 &&
    (scenario.calls as number) <= maximumCallsPerRole
  );
}

function usableAuthModes(
  authModes: RunProviderAuthModeConfiguration | undefined,
): ModelProfileApiScenarioUnavailableReason | null {
  if (!isRecord(authModes)) return "authentication-unavailable";
  const modes = authModes as unknown as Record<string, unknown>;
  if (
    Object.keys(modes).length !== 2 ||
    Object.keys(modes).some((key) => key !== "anthropic" && key !== "openai") ||
    (modes.anthropic !== "api-key" && modes.anthropic !== "user-session") ||
    (modes.openai !== "api-key" && modes.openai !== "user-session")
  ) {
    return "authentication-unavailable";
  }
  if (modes.anthropic === "user-session" || modes.openai === "user-session") {
    return "subscription-billing";
  }
  return null;
}

function resolveCatalogEntry(
  reference: unknown,
  role: "author" | "critic",
  entries: readonly ModelProfileCatalogEntry[],
): { profile: ModelProfile; entry: ModelProfileCatalogEntry } | null {
  if (
    !isRecord(reference) ||
    Object.keys(reference).length !== 2 ||
    Object.keys(reference).some((key) => key !== "id" && key !== "version") ||
    typeof reference.id !== "string" ||
    !Number.isSafeInteger(reference.version) ||
    (reference.version as number) <= 0
  ) {
    return null;
  }
  try {
    const profile = defaultModelProfileRegistry.resolve(
      reference.id,
      reference.version as number,
      role,
    );
    const entry = entries.find(
      ({ profile: candidate }) =>
        candidate.id === profile.id &&
        candidate.version === profile.version &&
        candidate.roles.includes(role),
    );
    return entry === undefined ? null : { profile, entry };
  } catch {
    return null;
  }
}

function validatePricingMetadata(
  entry: ModelProfileCatalogEntry,
): ModelProfileApiScenarioUnavailableReason | null {
  const pricing = entry.apiPricing;
  if (
    pricing.scope !== supportedPricingScope ||
    !Number.isSafeInteger(pricing.maxInputTokens) ||
    pricing.maxInputTokens <= 0 ||
    !Number.isFinite(pricing.inputUsdPerMillion) ||
    pricing.inputUsdPerMillion < 0 ||
    !Number.isFinite(pricing.outputUsdPerMillion) ||
    pricing.outputUsdPerMillion < 0
  ) {
    return "unsupported-pricing-scope";
  }
  if (
    !Number.isSafeInteger(entry.profile.knownLimits.contextWindowTokens) ||
    (entry.profile.knownLimits.contextWindowTokens ?? 0) <= 0 ||
    !Number.isSafeInteger(entry.profile.knownLimits.maxOutputTokens) ||
    entry.profile.knownLimits.maxOutputTokens <= 0 ||
    !Number.isSafeInteger(entry.profile.runtime.maxOutputTokens) ||
    entry.profile.runtime.maxOutputTokens <= 0
  ) {
    return "unsupported-pricing-limit";
  }
  return null;
}

function validateTokenBounds(
  scenario: ModelProfileTokenScenario,
  entry: ModelProfileCatalogEntry,
): boolean {
  const contextWindowTokens = entry.profile.knownLimits.contextWindowTokens;
  if (contextWindowTokens === undefined) return false;
  const outputLimit = Math.min(
    entry.profile.runtime.maxOutputTokens,
    entry.profile.knownLimits.maxOutputTokens,
  );
  return (
    scenario.inputTokens <= entry.apiPricing.maxInputTokens &&
    scenario.outputTokens <= outputLimit &&
    scenario.inputTokens + scenario.outputTokens <= contextWindowTokens
  );
}

function estimateRole(
  scenario: ModelProfileTokenScenario,
  entry: ModelProfileCatalogEntry,
): number {
  return (
    (scenario.calls *
      (scenario.inputTokens * entry.apiPricing.inputUsdPerMillion +
        scenario.outputTokens * entry.apiPricing.outputUsdPerMillion)) /
    dollarsPerMillionTokens
  );
}

/** Estimates public standard uncached API rates for one explicit token/call scenario. */
export function estimateModelProfileApiScenario(
  input: ModelProfileApiScenarioInput,
): ModelProfileApiScenarioEstimate {
  if (!validInput(input)) return unavailable("invalid-scenario");
  const authError = usableAuthModes(input.authModes);
  if (authError !== null) return unavailable(authError);

  if (!validTokenScenario(input.author) || !validTokenScenario(input.critic)) {
    return unavailable("invalid-scenario");
  }

  const entries = listModelProfileCatalog();
  if (
    !isRecord(input.profiles) ||
    Object.keys(input.profiles).length !== 2 ||
    Object.keys(input.profiles).some((key) => key !== "author" && key !== "critic")
  ) {
    return unavailable("unknown-profile");
  }
  const author = resolveCatalogEntry(input.profiles.author, "author", entries);
  const critic = resolveCatalogEntry(input.profiles.critic, "critic", entries);
  if (author === null || critic === null) return unavailable("unknown-profile");

  const authorMetadataIssue = validatePricingMetadata(author.entry);
  const criticMetadataIssue = validatePricingMetadata(critic.entry);
  if (authorMetadataIssue !== null || criticMetadataIssue !== null) {
    return unavailable(authorMetadataIssue ?? criticMetadataIssue ?? "unsupported-pricing-scope");
  }
  if (
    !validateTokenBounds(input.author, author.entry) ||
    !validateTokenBounds(input.critic, critic.entry)
  ) {
    return unavailable("unsupported-pricing-limit");
  }

  const authorUsd = estimateRole(input.author, author.entry);
  const criticUsd = estimateRole(input.critic, critic.entry);
  const totalUsd = authorUsd + criticUsd;
  if (![authorUsd, criticUsd, totalUsd].every(Number.isFinite)) {
    return unavailable("unsupported-pricing-scope");
  }
  return { status: "available", authorUsd, criticUsd, totalUsd };
}
