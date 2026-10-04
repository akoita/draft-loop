import type { AgentRole } from "@draft-loop/domain";
import type { ModelProfile } from "@draft-loop/domain/model-profile";
import { modelProfileSchema } from "@draft-loop/schemas/model-profile";
import { createGoogleGeminiAuthorProfile } from "./gemini-development-profile.js";
import { createDeepInfraGLMAuthorProfile } from "./glm-development-profile.js";

export type ModelProfileRegistryErrorCode =
  | "invalid-profile"
  | "duplicate-profile"
  | "not-found"
  | "unsupported-role";

export class ModelProfileRegistryError extends Error {
  constructor(readonly code: ModelProfileRegistryErrorCode) {
    const messageByCode: Record<ModelProfileRegistryErrorCode, string> = {
      "invalid-profile": "Model profile data is invalid.",
      "duplicate-profile": "A model profile identity is duplicated.",
      "not-found": "The requested model profile version was not found.",
      "unsupported-role": "The requested model profile does not support that role.",
    };
    super(messageByCode[code]);
    this.name = "ModelProfileRegistryError";
  }
}

export interface ModelProfileRegistry {
  /** Resolves an exact profile ID and version for a supported role. */
  resolve(profileId: string, version: number, role: AgentRole): ModelProfile;
  /** Returns detached snapshots of all registered profiles in insertion order. */
  list(): ModelProfile[];
}

function copyModelProfile(profile: ModelProfile): ModelProfile {
  const thinking =
    profile.runtime.thinking.mode === "budgeted"
      ? { mode: "budgeted" as const, maxTokens: profile.runtime.thinking.maxTokens }
      : { mode: profile.runtime.thinking.mode };

  return {
    id: profile.id,
    version: profile.version,
    provider: profile.provider,
    modelId: profile.modelId,
    tier: profile.tier,
    roles: [...profile.roles],
    runtime: {
      effort: profile.runtime.effort,
      maxOutputTokens: profile.runtime.maxOutputTokens,
      thinking,
    },
    knownLimits: {
      maxOutputTokens: profile.knownLimits.maxOutputTokens,
      ...(profile.knownLimits.contextWindowTokens === undefined
        ? {}
        : { contextWindowTokens: profile.knownLimits.contextWindowTokens }),
    },
  };
}

const knownRoles = new Set<AgentRole>(["author", "critic"]);

export function createModelProfileRegistry(
  profiles: readonly ModelProfile[],
): ModelProfileRegistry {
  if (!Array.isArray(profiles)) {
    throw new ModelProfileRegistryError("invalid-profile");
  }

  const versionsById = new Map<string, Map<number, ModelProfile>>();
  const insertionOrder: ModelProfile[] = [];

  for (const candidate of profiles) {
    const parsed = modelProfileSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new ModelProfileRegistryError("invalid-profile");
    }

    const snapshot = copyModelProfile(parsed.data);
    let versions = versionsById.get(snapshot.id);
    if (versions === undefined) {
      versions = new Map<number, ModelProfile>();
      versionsById.set(snapshot.id, versions);
    }
    if (versions.has(snapshot.version)) {
      throw new ModelProfileRegistryError("duplicate-profile");
    }

    versions.set(snapshot.version, snapshot);
    insertionOrder.push(snapshot);
  }

  return Object.freeze({
    resolve(profileId: string, version: number, role: AgentRole): ModelProfile {
      if (typeof role !== "string" || !knownRoles.has(role as AgentRole)) {
        throw new ModelProfileRegistryError("unsupported-role");
      }

      if (typeof profileId !== "string" || !Number.isSafeInteger(version) || version <= 0) {
        throw new ModelProfileRegistryError("not-found");
      }

      const profile = versionsById.get(profileId)?.get(version);
      if (profile === undefined) {
        throw new ModelProfileRegistryError("not-found");
      }
      if (!profile.roles.includes(role)) {
        throw new ModelProfileRegistryError("unsupported-role");
      }

      return copyModelProfile(profile);
    },
    list(): ModelProfile[] {
      return insertionOrder.map(copyModelProfile);
    },
  });
}

export const defaultModelProfileRegistry = createModelProfileRegistry([
  {
    id: "legacy-anthropic-author",
    version: 1,
    provider: "anthropic",
    modelId: "claude-sonnet-4-5",
    tier: "economy",
    roles: ["author"],
    runtime: {
      effort: "provider-default",
      maxOutputTokens: 32768,
      thinking: { mode: "budgeted", maxTokens: 16384 },
    },
    knownLimits: { maxOutputTokens: 64000, contextWindowTokens: 200000 },
  },
  {
    id: "legacy-openai-critic",
    version: 1,
    provider: "openai",
    modelId: "gpt-5.6-luna",
    tier: "economy",
    roles: ["critic"],
    runtime: {
      effort: "provider-default",
      maxOutputTokens: 16384,
      thinking: { mode: "provider-default" },
    },
    knownLimits: { maxOutputTokens: 128000, contextWindowTokens: 1050000 },
  },
  {
    id: "standard-anthropic-author",
    version: 1,
    provider: "anthropic",
    modelId: "claude-opus-5-5",
    tier: "standard",
    roles: ["author"],
    runtime: {
      effort: "medium",
      maxOutputTokens: 32768,
      thinking: { mode: "provider-default" },
    },
    knownLimits: { maxOutputTokens: 128000, contextWindowTokens: 1000000 },
  },
  {
    id: "standard-openai-critic",
    version: 1,
    provider: "openai",
    modelId: "gpt-6-sol",
    tier: "standard",
    roles: ["critic"],
    runtime: {
      effort: "low",
      maxOutputTokens: 16384,
      thinking: { mode: "provider-default" },
    },
    knownLimits: { maxOutputTokens: 128000, contextWindowTokens: 1050000 },
  },
  {
    id: "premium-anthropic-author",
    version: 1,
    provider: "anthropic",
    modelId: "claude-fable-5-1",
    tier: "premium",
    roles: ["author"],
    runtime: {
      effort: "high",
      maxOutputTokens: 32768,
      thinking: { mode: "provider-default" },
    },
    knownLimits: { maxOutputTokens: 128000, contextWindowTokens: 1000000 },
  },
  {
    id: "premium-openai-critic",
    version: 1,
    provider: "openai",
    modelId: "gpt-6-astra",
    tier: "premium",
    roles: ["critic"],
    runtime: {
      effort: "medium",
      maxOutputTokens: 16384,
      thinking: { mode: "provider-default" },
    },
    knownLimits: { maxOutputTokens: 128000, contextWindowTokens: 1050000 },
  },
  {
    id: "economy-openai-critic",
    version: 1,
    provider: "openai",
    modelId: "gpt-6-luna",
    tier: "economy",
    roles: ["critic"],
    runtime: {
      effort: "low",
      maxOutputTokens: 16384,
      thinking: { mode: "provider-default" },
    },
    knownLimits: { maxOutputTokens: 128000, contextWindowTokens: 1050000 },
  },
  {
    id: "economy-anthropic-author",
    version: 1,
    provider: "anthropic",
    modelId: "claude-sonnet-5-5",
    tier: "economy",
    roles: ["author"],
    runtime: {
      effort: "medium",
      maxOutputTokens: 32768,
      thinking: { mode: "provider-default" },
    },
    knownLimits: { maxOutputTokens: 128000, contextWindowTokens: 1000000 },
  },
  {
    id: "standard-openai-critic",
    version: 2,
    provider: "openai",
    modelId: "gpt-6.1-sol",
    tier: "standard",
    roles: ["critic"],
    runtime: {
      effort: "low",
      maxOutputTokens: 16384,
      thinking: { mode: "provider-default" },
    },
    knownLimits: { maxOutputTokens: 128000, contextWindowTokens: 1050000 },
  },
  createDeepInfraGLMAuthorProfile(),
  createGoogleGeminiAuthorProfile(),
]);
