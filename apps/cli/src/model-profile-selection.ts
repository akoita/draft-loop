import type { ModelProfileReferences } from "@draft-loop/application";
import {
  getModelProfilePreset,
  type ModelProfilePreset,
} from "@draft-loop/application/model-profile-catalog";
import {
  defaultModelProfileRegistry,
  type ModelProfileRegistry,
} from "@draft-loop/application/model-profiles";

export interface ModelProfileSelectionOptions {
  readonly modelPreset?: unknown;
  readonly authorProfile?: unknown;
  readonly criticProfile?: unknown;
}

export class ModelProfileSelectionError extends Error {
  constructor(readonly code: "invalid-selection" | "invalid-reference" | "unavailable") {
    const messages = {
      "invalid-selection":
        "Choose one model preset or provide both --author-profile and --critic-profile.",
      "invalid-reference":
        "Model profile references must use <id>@<positive-version> with a safe integer version.",
      unavailable: "The requested model profile is unavailable for that role and version.",
    } as const;
    super(messages[code]);
    this.name = "ModelProfileSelectionError";
  }
}

export function parseModelProfileReference(reference: unknown): {
  readonly id: string;
  readonly version: number;
} {
  if (typeof reference !== "string") {
    throw new ModelProfileSelectionError("invalid-reference");
  }
  const normalized = reference.trim();
  const separator = normalized.lastIndexOf("@");
  if (separator < 0) throw new ModelProfileSelectionError("invalid-reference");

  const id = normalized.slice(0, separator).trim();
  const versionText = normalized.slice(separator + 1);
  if (id === "" || !/^\d+$/u.test(versionText)) {
    throw new ModelProfileSelectionError("invalid-reference");
  }

  const version = Number(versionText);
  if (!Number.isSafeInteger(version) || version <= 0) {
    throw new ModelProfileSelectionError("invalid-reference");
  }
  return { id, version };
}

function resolveReference(
  reference: unknown,
  role: keyof ModelProfileReferences,
  registry: ModelProfileRegistry,
): ModelProfileReferences[keyof ModelProfileReferences] {
  const parsed = parseModelProfileReference(reference);
  try {
    const profile = registry.resolve(parsed.id, parsed.version, role);
    return { id: profile.id, version: profile.version };
  } catch {
    throw new ModelProfileSelectionError("unavailable");
  }
}

function resolvePreset(
  id: string,
  registry: ModelProfileRegistry,
  lookup: (presetId: string) => ModelProfilePreset,
): ModelProfileReferences {
  let preset: ModelProfilePreset;
  try {
    preset = lookup(id);
  } catch {
    throw new ModelProfileSelectionError("unavailable");
  }
  return {
    author: resolveReference(`${preset.author.id}@${preset.author.version}`, "author", registry),
    critic: resolveReference(`${preset.critic.id}@${preset.critic.version}`, "critic", registry),
  };
}

export function resolveModelProfileSelection(
  options: ModelProfileSelectionOptions,
  registry: ModelProfileRegistry = defaultModelProfileRegistry,
  lookupPreset: (presetId: string) => ModelProfilePreset = getModelProfilePreset,
): ModelProfileReferences | undefined {
  const hasPreset = options.modelPreset !== undefined;
  const hasAuthor = options.authorProfile !== undefined;
  const hasCritic = options.criticProfile !== undefined;

  if (hasPreset && (hasAuthor || hasCritic)) {
    throw new ModelProfileSelectionError("invalid-selection");
  }
  if (hasAuthor !== hasCritic) {
    throw new ModelProfileSelectionError("invalid-selection");
  }
  if (!hasPreset && !hasAuthor && !hasCritic) return undefined;

  if (hasPreset) {
    if (typeof options.modelPreset !== "string" || options.modelPreset.trim() === "") {
      throw new ModelProfileSelectionError("unavailable");
    }
    return resolvePreset(options.modelPreset, registry, lookupPreset);
  }

  return {
    author: resolveReference(options.authorProfile, "author", registry),
    critic: resolveReference(options.criticProfile, "critic", registry),
  };
}
