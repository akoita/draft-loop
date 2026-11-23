import type { ModelSelection } from "@draft-loop/domain";
import type { AnthropicRefusalFallback, ModelPricing } from "@draft-loop/providers";

/**
 * The model each Claude author may retry a refused call on (#3275). A call on a model not listed
 * here never falls back: Haiku 5.5 has no smaller model to fall back to, and Opus 5.5 none yet.
 */
export const claudeRefusalFallbackModels: Readonly<Record<string, string>> = Object.freeze({
  "claude-sonnet-5-5": "claude-sonnet-5",
});

/** The model a refused call on `modelId` may retry on, or undefined when it has none. */
export function claudeRefusalFallbackModel(modelId: string): string | undefined {
  return Object.hasOwn(claudeRefusalFallbackModels, modelId)
    ? claudeRefusalFallbackModels[modelId]
    : undefined;
}

/**
 * The deployment's refusal fallback: the model from `DRAFT_LOOP_CLAUDE_REFUSAL_FALLBACK`, its
 * rates, so the retry counts in the run's cost, and the switch read before each retry.
 */
export interface ClaudeRefusalFallbackSetting {
  readonly modelId: string;
  readonly pricing: ModelPricing;
  /** Read before each retry; the model call switch's `refusalFallback`, off while paused. */
  readonly allowed?: () => boolean | Promise<boolean>;
}

export class ClaudeRefusalFallbackError extends Error {
  override readonly name = "ClaudeRefusalFallbackError";
}

const haikuOrSonnet = /^claude-(?:haiku|sonnet)-[a-z0-9-]{1,40}$/u;

/**
 * Checks a deployment's fallback model at startup: a Claude Haiku or Sonnet model that is some
 * author's allowed fallback and has known rates. Anything else throws, naming what is wrong.
 */
export function checkClaudeRefusalFallbackModel(
  modelId: string,
  pricing: ModelPricing | undefined,
): ModelPricing {
  if (!haikuOrSonnet.test(modelId)) {
    throw new ClaudeRefusalFallbackError(`${modelId} is not a Claude Haiku or Sonnet model.`);
  }
  if (!Object.values(claudeRefusalFallbackModels).includes(modelId)) {
    const allowed = Object.entries(claudeRefusalFallbackModels)
      .map(([author, fallback]) => `${author} falls back to ${fallback}`)
      .join("; ");
    throw new ClaudeRefusalFallbackError(
      `${modelId} is no author's allowed fallback (${allowed}).`,
    );
  }
  if (pricing === undefined) {
    throw new ClaudeRefusalFallbackError(
      `${modelId} has no known rates, so its calls could not count in a run's cost.`,
    );
  }
  return pricing;
}

/**
 * The adapter's fallback for one call: the setting when the call's model may fall back to it,
 * otherwise none, so a run on any other author keeps failing a refused step as before.
 */
export function claudeRefusalFallbackFor(
  setting: ClaudeRefusalFallbackSetting | undefined,
  configuredModel: ModelSelection,
): AnthropicRefusalFallback | undefined {
  if (setting === undefined || configuredModel.company !== "anthropic") return undefined;
  if (claudeRefusalFallbackModel(configuredModel.modelId) !== setting.modelId) return undefined;
  return {
    modelId: setting.modelId,
    pricing: setting.pricing,
    ...(setting.allowed === undefined ? {} : { allowed: setting.allowed }),
  };
}
