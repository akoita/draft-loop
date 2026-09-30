import type { ModelProfile } from "@draft-loop/domain/model-profile";
import { defaultModelProfileRegistry } from "./model-profiles.js";

export interface ModelProfileCatalogPricing {
  readonly inputUsdPerMillion: number;
  readonly outputUsdPerMillion: number;
  readonly maxInputTokens: 200000;
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

export type ModelProfilePresetId = "economy" | "standard";

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
}

const anthropicOverview = "https://platform.claude.com/docs/en/models/overview";
const anthropicSonnet55Overview = "https://platform.claude.com/docs/en/models/sonnet-5-5/overview";

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
  "standard-openai-critic@2": {
    sources: [openAIModelPage("gpt-6.1-sol")],
    apiPricing: { inputUsdPerMillion: 2, outputUsdPerMillion: 10 },
  },
};

const pricingScope = {
  maxInputTokens: 200000,
  scope: "standard-uncached-text-api",
} as const;

const presetDefinitions: readonly ModelProfilePreset[] = [
  {
    id: "economy",
    label: "Economy — unvalidated",
    tier: "economy",
    author: { id: "economy-anthropic-author", version: 1 },
    critic: { id: "economy-openai-critic", version: 1 },
  },
  {
    id: "standard",
    label: "Standard — unvalidated",
    tier: "standard",
    author: { id: "standard-anthropic-author", version: 1 },
    critic: { id: "standard-openai-critic", version: 2 },
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
  return activeReferences.map(({ id, version, role }) => {
    const profile = defaultModelProfileRegistry.resolve(id, version, role);
    const metadata = catalogMetadata[`${profile.id}@${profile.version}`];
    if (metadata === undefined) throw new ModelProfileCatalogError("missing-metadata");
    return {
      profile,
      reviewedAt: "2026-09-30",
      sources: [...metadata.sources],
      qualityStatus: "unvalidated",
      availabilityStatus: "not-checked",
      apiPricing: {
        ...metadata.apiPricing,
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
