import {
  getModelProfilePreset,
  listModelProfileCatalog,
  listModelProfilePresets,
  type ModelProfileCatalogEntry,
  type ModelProfilePreset,
  type ModelProfilePresetId,
} from "@draft-loop/application/model-profile-catalog";
import { isVertexClaudeModel } from "@draft-loop/model-gateway";

/**
 * The preset a hosted workspace gets when its request names no model: Claude Sonnet as the author
 * and an OpenAI critic. The desktop keeps the cheaper economy preset as its own default.
 */
export const hostedDefaultPresetId: ModelProfilePresetId = "balanced";

/**
 * Whether the model gateway routes a profile: Claude only through its Vertex AI allowlist, and
 * OpenAI through its EU endpoint. Other companies and local models are desktop-only.
 */
export function servedByGateway(profile: ModelProfileCatalogEntry["profile"]): boolean {
  if (profile.provider === "anthropic") return isVertexClaudeModel(profile.modelId);
  return profile.provider === "openai";
}

export interface HostedModelCatalog {
  readonly models: readonly ModelProfileCatalogEntry[];
  readonly presets: readonly ModelProfilePreset[];
  readonly defaultPresetId: ModelProfilePresetId;
}

/** The catalog's profiles the gateway serves, and the presets whose author and critic both are. */
export function hostedModelCatalog(): HostedModelCatalog {
  const models = listModelProfileCatalog().filter((entry) => servedByGateway(entry.profile));
  const served = new Set(models.map(({ profile }) => `${profile.id}@${profile.version}`));
  const presets = listModelProfilePresets().filter(
    ({ author, critic }) =>
      served.has(`${author.id}@${author.version}`) && served.has(`${critic.id}@${critic.version}`),
  );
  return { models, presets, defaultPresetId: hostedDefaultPresetId };
}

export type HostedCompany = "anthropic" | "openai";

export function isHostedCompany(company: string): company is HostedCompany {
  return company === "anthropic" || company === "openai";
}

export interface HostedModelPair {
  readonly author: { readonly company: HostedCompany; readonly model: string };
  readonly critic: { readonly company: HostedCompany; readonly model: string };
}

/** The company and model of each side of the hosted default preset. */
export function hostedDefaultModelPair(): HostedModelPair {
  const preset = getModelProfilePreset(hostedDefaultPresetId);
  const byReference = new Map(
    hostedModelCatalog().models.map(({ profile }) => [`${profile.id}@${profile.version}`, profile]),
  );
  const side = (reference: ModelProfilePreset["author"]) => {
    const profile = byReference.get(`${reference.id}@${reference.version}`);
    const company: string | undefined = profile?.provider;
    if (profile === undefined || company === undefined || !isHostedCompany(company))
      throw new Error("The hosted default preset names a model the gateway does not serve.");
    return { company, model: profile.modelId };
  };
  return { author: side(preset.author), critic: side(preset.critic) };
}
