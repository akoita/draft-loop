import type { ModelProfile } from "@draft-loop/domain/model-profile";
import { defaultModelProfileRegistry } from "./model-profiles.js";

export interface ModelProfileCatalogPricing {
  readonly inputUsdPerMillion: number;
  readonly outputUsdPerMillion: number;
  readonly maxInputTokens: number;
  readonly scope: "standard-uncached-text-api";
}

export interface ModelProfileCatalogEntry {
  readonly profile: ModelProfile;
  readonly reviewedAt: string;
  readonly sources: readonly string[];
  readonly qualityStatus: "unvalidated";
  readonly availabilityStatus: "not-checked";
  readonly apiPricing: ModelProfileCatalogPricing;
}

export type ModelProfilePresetId =
  | "economy"
  | "balanced"
  | "standard"
  | "development-glm"
  | "development-gemini"
  | "development-mistral";

export interface ModelProfilePreset {
  readonly id: ModelProfilePresetId;
  readonly label: string;
  readonly tier: ModelProfile["tier"];
  readonly author: { readonly id: string; readonly version: number };
  readonly critic: { readonly id: string; readonly version: number };
}

export type ModelProfileCatalogErrorCode = "missing-metadata" | "unknown-preset";

export class ModelProfileCatalogError extends Error {
  constructor(readonly code: ModelProfileCatalogErrorCode) {
    const message =
      code === "missing-metadata"
        ? "A registered model profile is missing catalog metadata."
        : "The requested model profile preset is unknown.";
    super(message);
    this.name = "ModelProfileCatalogError";
  }
}

interface CatalogMetadata {
  readonly sources: readonly string[];
  readonly apiPricing: Omit<ModelProfileCatalogPricing, "scope" | "maxInputTokens">;
  /** Overrides the default input-token cap when a lower-priced rate card ends earlier. */
  readonly maxInputTokens?: number;
  readonly reviewedAt?: string;
}

const anthropicOverview = "https://platform.claude.com/docs/en/models/overview";
const anthropicModelsOverview = "https://platform.claude.com/docs/en/about-claude/models/overview";
const anthropicSonnet55Overview = "https://platform.claude.com/docs/en/models/sonnet-5-5/overview";
const deepInfraGlmModelApi = "https://deepinfra.com/zai-org/GLM-5.3-Flash/api";
const deepInfraGlmOverview = "https://deepinfra.com/blog/glm-5-3-flash-deepinfra";

const googleGeminiPricing = "https://ai.google.dev/gemini-api/docs/pricing";
const googleGeminiModels = "https://ai.google.dev/gemini-api/docs/models";

const mistralLarge4Model = "https://docs.mistral.ai/models/mistral-large-4";

function openAIModelPage(modelId: string): string {
  return `https://developers.openai.com/api/docs/models/${modelId}`;
}

/** Metadata is pinned to exact profile versions; model IDs are not catalog keys. */
const catalogMetadata: Readonly<Record<string, CatalogMetadata>> = {
  "standard-anthropic-author@1": {
    sources: [anthropicOverview],
    apiPricing: { inputUsdPerMillion: 4, outputUsdPerMillion: 20 },
  },
  "economy-openai-critic@1": {
    sources: [openAIModelPage("gpt-6-luna")],
    apiPricing: { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.5 },
  },
  "economy-anthropic-author@1": {
    sources: [anthropicSonnet55Overview],
    apiPricing: { inputUsdPerMillion: 2, outputUsdPerMillion: 10 },
  },
  "economy-anthropic-author@2": {
    sources: [anthropicModelsOverview],
    apiPricing: { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.5 },
    // Haiku 5.5 bills prompts above 100K tokens at a higher rate card that is not modeled.
    maxInputTokens: 100000,
    reviewedAt: "2026-10-07",
  },
  "standard-openai-critic@2": {
    sources: [openAIModelPage("gpt-6.1-sol")],
    apiPricing: { inputUsdPerMillion: 2, outputUsdPerMillion: 10 },
  },
  "dev-deepinfra-glm-author@1": {
    sources: [deepInfraGlmModelApi, deepInfraGlmOverview],
    apiPricing: { inputUsdPerMillion: 0.15, outputUsdPerMillion: 0.5 },
    reviewedAt: "2026-10-02",
  },
  "dev-google-gemini-author@2": {
    sources: [googleGeminiPricing, googleGeminiModels],
    apiPricing: { inputUsdPerMillion: 0.75, outputUsdPerMillion: 3.75 },
    reviewedAt: "2026-10-04",
  },
  // Standard list rates; the temporary launch discount on the same page is not modeled.
  "dev-mistral-author@1": {
    sources: [mistralLarge4Model],
    apiPricing: { inputUsdPerMillion: 1.36, outputUsdPerMillion: 4.18 },
    reviewedAt: "2026-10-08",
  },
};

const defaultMaxInputTokens = 200000;
const pricingScope = {
  scope: "standard-uncached-text-api",
} as const;

const presetDefinitions: readonly ModelProfilePreset[] = [
  {
    id: "economy",
    label: "Economy — unvalidated",
    tier: "economy",
    author: { id: "economy-anthropic-author", version: 2 },
    critic: { id: "economy-openai-critic", version: 1 },
  },
  {
    id: "balanced",
    label: "Balanced — unvalidated",
    tier: "standard",
    author: { id: "economy-anthropic-author", version: 1 },
    critic: { id: "standard-openai-critic", version: 2 },
  },
  {
    id: "standard",
    label: "Standard — unvalidated",
    tier: "standard",
    author: { id: "standard-anthropic-author", version: 1 },
    critic: { id: "standard-openai-critic", version: 2 },
  },
  {
    id: "development-glm",
    label: "Development — GLM Flash — unvalidated",
    tier: "economy",
    author: { id: "dev-deepinfra-glm-author", version: 1 },
    critic: { id: "economy-openai-critic", version: 1 },
  },
  {
    id: "development-gemini",
    label: "Development — Gemini Flash — unvalidated",
    tier: "economy",
    author: { id: "dev-google-gemini-author", version: 2 },
    critic: { id: "economy-openai-critic", version: 1 },
  },
  {
    id: "development-mistral",
    label: "Development — Mistral Large 4 (preview) — unvalidated",
    tier: "economy",
    author: { id: "dev-mistral-author", version: 1 },
    critic: { id: "economy-openai-critic", version: 1 },
  },
];

function detachedPreset(preset: ModelProfilePreset): ModelProfilePreset {
  defaultModelProfileRegistry.resolve(preset.author.id, preset.author.version, "author");
  defaultModelProfileRegistry.resolve(preset.critic.id, preset.critic.version, "critic");
  return {
    id: preset.id,
    label: preset.label,
    tier: preset.tier,
    author: { ...preset.author },
    critic: { ...preset.critic },
  };
}

export function listModelProfileCatalog(): ModelProfileCatalogEntry[] {
  const activeReferences = presetDefinitions.flatMap((preset) => [
    { ...preset.author, role: "author" as const },
    { ...preset.critic, role: "critic" as const },
  ]);
  const uniqueReferences = new Map(
    activeReferences.map((reference) => [`${reference.id}@${reference.version}`, reference]),
  );
  return [...uniqueReferences.values()].map(({ id, version, role }) => {
    const profile = defaultModelProfileRegistry.resolve(id, version, role);
    const metadata = catalogMetadata[`${profile.id}@${profile.version}`];
    if (metadata === undefined) throw new ModelProfileCatalogError("missing-metadata");
    return {
      profile,
      reviewedAt: metadata.reviewedAt ?? "2026-09-30",
      sources: [...metadata.sources],
      qualityStatus: "unvalidated",
      availabilityStatus: "not-checked",
      apiPricing: {
        ...metadata.apiPricing,
        maxInputTokens: metadata.maxInputTokens ?? defaultMaxInputTokens,
        ...pricingScope,
      },
    };
  });
}

export function listModelProfilePresets(): ModelProfilePreset[] {
  return presetDefinitions.map(detachedPreset);
}

export function getModelProfilePreset(id: string): ModelProfilePreset {
  const preset = presetDefinitions.find((candidate) => candidate.id === id);
  if (preset === undefined) throw new ModelProfileCatalogError("unknown-preset");
  return detachedPreset(preset);
}
