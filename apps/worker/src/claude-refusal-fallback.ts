import { catalogModelPricing } from "@draft-loop/application";
import {
  type ClaudeRefusalFallbackSetting,
  checkClaudeRefusalFallbackModel,
  type ModelCallSwitchReader,
  readModelCallSwitchReader,
} from "@draft-loop/model-gateway";
import type { ModelPricing } from "@draft-loop/providers";

import { WorkerConfigError } from "./config-error.js";
import type { WorkerModelRoutes } from "./route-config.js";

/** The deployment's Claude refusal fallback (#3275), from `DRAFT_LOOP_CLAUDE_REFUSAL_FALLBACK`. */
export interface ClaudeRefusalFallbackConfig {
  readonly modelId: string;
  readonly pricing: ModelPricing;
}

const name = "DRAFT_LOOP_CLAUDE_REFUSAL_FALLBACK";

/** The catalog's API rates for a Claude model, or undefined when the catalog names none. */
export const catalogClaudePricing = (modelId: string): ModelPricing | undefined =>
  catalogModelPricing({
    company: "anthropic",
    modelId,
    role: "author",
    promptTemplateVersion: "refusal-fallback",
  });

/**
 * Reads `DRAFT_LOOP_CLAUDE_REFUSAL_FALLBACK`. Unset or empty leaves it off. It is refused at
 * startup unless the model is a Claude Haiku or Sonnet model that is an author's allowed fallback,
 * with known rates, and a direct Claude route exists to use it on: the self-hosted `direct`
 * routes, or the Vertex routes' Claude API fallback. Vertex AI itself stays without it.
 */
export function readClaudeRefusalFallback(
  env: NodeJS.ProcessEnv,
  routes: WorkerModelRoutes | undefined,
  pricingOf: (modelId: string) => ModelPricing | undefined = catalogClaudePricing,
): ClaudeRefusalFallbackConfig | undefined {
  const modelId = (env[name] ?? "").trim();
  if (modelId === "") return undefined;
  let pricing: ModelPricing;
  try {
    pricing = checkClaudeRefusalFallbackModel(modelId, pricingOf(modelId));
  } catch (error) {
    throw new WorkerConfigError(`${name}: ${(error as Error).message}`, { cause: error });
  }
  const direct =
    routes?.kind === "direct" ||
    (routes?.kind === "vertex" && routes.gateway.anthropicKeySecret !== undefined);
  if (!direct) {
    throw new WorkerConfigError(
      `${name} needs the direct Claude route: DRAFT_LOOP_MODEL_ROUTES=direct, or DRAFT_LOOP_ANTHROPIC_FALLBACK=true.`,
    );
  }
  return { modelId, pricing };
}

/**
 * Whether the fallback may retry now: the model call switch's `"refusalFallback": "off"` or a
 * paused switch stops it within the switch's one-minute cache.
 */
export function refusalFallbackAllowed(read: ModelCallSwitchReader): () => Promise<boolean> {
  return async () => (await read()).refusalFallback;
}

/**
 * The fallback the worker's routes run with, reading the same switch as the API
 * (`DRAFT_LOOP_MODEL_CALLS_SECRET`). A secret that cannot be read keeps the fallback on, as it
 * keeps calls running in the API, and reports the error.
 */
export function claudeRefusalFallbackSetting(
  config: ClaudeRefusalFallbackConfig | undefined,
  env: NodeJS.ProcessEnv,
  options: Parameters<typeof readModelCallSwitchReader>[1] = {},
): ClaudeRefusalFallbackSetting | undefined {
  if (config === undefined) return undefined;
  let read: ModelCallSwitchReader;
  try {
    read = readModelCallSwitchReader(env, options);
  } catch (error) {
    throw new WorkerConfigError((error as Error).message, { cause: error });
  }
  return { ...config, allowed: refusalFallbackAllowed(read) };
}
