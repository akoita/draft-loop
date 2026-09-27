import type { AgentRole, ModelCompany } from "./index.js";

export const modelProfileTiers = ["premium", "standard", "economy"] as const;
export type ModelProfileTier = (typeof modelProfileTiers)[number];

export const modelProfileEfforts = ["low", "medium", "high", "xhigh", "max"] as const;
export type ModelProfileEffort = (typeof modelProfileEfforts)[number];

export const modelProfileThinkingModes = ["provider-default", "disabled", "budgeted"] as const;
export type ModelProfileThinkingMode = (typeof modelProfileThinkingModes)[number];

export interface ProviderDefaultThinking {
  readonly mode: Extract<ModelProfileThinkingMode, "provider-default">;
}

export interface DisabledThinking {
  readonly mode: Extract<ModelProfileThinkingMode, "disabled">;
}

export interface BudgetedThinking {
  readonly mode: Extract<ModelProfileThinkingMode, "budgeted">;
  readonly maxTokens: number;
}

export type ModelProfileThinking = ProviderDefaultThinking | DisabledThinking | BudgetedThinking;

export interface ModelProfileRuntime {
  readonly effort: ModelProfileEffort;
  readonly maxOutputTokens: number;
  readonly thinking: ModelProfileThinking;
}

export interface ModelProfileKnownLimits {
  readonly maxOutputTokens: number;
  readonly contextWindowTokens?: number | undefined;
}

/** A versioned description of a provider model and its declared runtime limits. */
export interface ModelProfile {
  readonly id: string;
  readonly version: number;
  readonly provider: ModelCompany;
  readonly modelId: string;
  readonly tier: ModelProfileTier;
  readonly roles: readonly AgentRole[];
  readonly runtime: ModelProfileRuntime;
  readonly knownLimits: ModelProfileKnownLimits;
}
