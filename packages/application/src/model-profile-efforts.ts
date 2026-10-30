import type { ModelProfile, ModelProfileEffort } from "@draft-loop/domain/model-profile";

/** The reasoning levels a person may choose; `provider-default` stays a profile-only setting. */
export const choosableModelProfileEfforts = ["low", "medium", "high", "xhigh", "max"] as const;
export type ChoosableModelProfileEffort = (typeof choosableModelProfileEfforts)[number];

const claudeEffortPage = "https://platform.claude.com/docs/en/build-with-claude/effort";

function openAIModelPage(modelId: string): string {
  return `https://developers.openai.com/api/docs/models/${modelId}`;
}

interface EffortMetadata {
  readonly levels: readonly ChoosableModelProfileEffort[];
  readonly source: string;
}

const allLevels = choosableModelProfileEfforts;

/**
 * Levels per exact current profile version, read from each provider's page on 2026-10-28. OpenAI
 * also offers `none` on some models; it is left out because no profile can express it. A profile
 * missing here keeps only its own fixed level.
 */
const effortMetadata: Readonly<Record<string, EffortMetadata>> = {
  "economy-anthropic-author@2": {
    levels: allLevels,
    source: claudeEffortPage,
  },
  "economy-anthropic-author@1": {
    levels: allLevels,
    source: claudeEffortPage,
  },
  "standard-anthropic-author@1": {
    levels: allLevels,
    source: claudeEffortPage,
  },
  "standard-anthropic-author@2": {
    levels: allLevels,
    source: claudeEffortPage,
  },
  "balanced-anthropic-critic@1": {
    levels: allLevels,
    source: claudeEffortPage,
  },
  "standard-anthropic-critic@1": {
    levels: allLevels,
    source: claudeEffortPage,
  },
  "economy-openai-critic@1": {
    levels: allLevels,
    source: openAIModelPage("gpt-6-luna"),
  },
  "balanced-openai-critic@1": {
    levels: allLevels,
    source: openAIModelPage("gpt-6.1-terra"),
  },
  "standard-openai-critic@2": {
    levels: allLevels,
    source: openAIModelPage("gpt-6.1-sol"),
  },
};

/** The levels a run may use with this profile; always includes the profile's own level. */
export function allowedModelProfileEfforts(
  profile: Pick<ModelProfile, "id" | "version" | "runtime">,
): readonly ModelProfileEffort[] {
  const metadata = effortMetadata[`${profile.id}@${profile.version}`];
  if (metadata === undefined) return [profile.runtime.effort];
  return metadata.levels.includes(profile.runtime.effort as ChoosableModelProfileEffort)
    ? [...metadata.levels]
    : [profile.runtime.effort, ...metadata.levels];
}

/** The page the levels were read from, or undefined for a profile with only its fixed level. */
export function modelProfileEffortSource(
  profile: Pick<ModelProfile, "id" | "version">,
): string | undefined {
  return effortMetadata[`${profile.id}@${profile.version}`]?.source;
}

/**
 * The profile a run uses at the chosen level: the profile itself when no level is chosen, a copy
 * with that level when the profile allows it, and undefined when it does not.
 */
export function applyModelProfileEffort(
  profile: ModelProfile,
  effort: unknown,
): ModelProfile | undefined {
  if (effort === undefined) return profile;
  if (!isChoosableModelProfileEffort(effort)) return undefined;
  if (!allowedModelProfileEfforts(profile).includes(effort)) return undefined;
  return { ...profile, runtime: { ...profile.runtime, effort } };
}

export function isChoosableModelProfileEffort(
  value: unknown,
): value is ChoosableModelProfileEffort {
  return (
    typeof value === "string" && (choosableModelProfileEfforts as readonly string[]).includes(value)
  );
}
