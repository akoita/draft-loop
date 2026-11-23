import {
  ModelCallSwitchConfigError,
  parseModelCallSwitchState,
  readModelCallSwitchReader,
  type SecretModelCallSwitchOptions,
  secretModelCallSwitchReader,
} from "@draft-loop/model-gateway";
import type { FastifyInstance } from "fastify";

import type { BriefExtractionAllowance } from "./brief-extraction-allowance.js";
import { ApiConfigError } from "./config.js";
import { modelCallPathOf } from "./model-call-registry.js";

/**
 * The global model call switch (#3112): one value stops every metered model call the registry
 * lists, without a deploy. Its stored form and its reader live in `@draft-loop/model-gateway`, so
 * the worker, which reads the same secret for Claude's refusal fallback (#3275), agrees with the
 * API. `{"modelCalls":"paused"}` pauses calls; `{}` or `{"modelCalls":"on"}` lets them through.
 */

/** Whether metered model calls are paused right now. */
export type ModelCallSwitch = () => Promise<boolean>;

export const modelCallsRunning: ModelCallSwitch = async () => false;

/** Parses the stored text. Text that is not a valid object throws. */
export function parseModelCallSwitch(text: string | undefined): boolean {
  return parseModelCallSwitchState(text).paused;
}

/**
 * Reads the switch from Secret Manager. A failed or invalid read keeps calls running: the switch
 * is for the operator to stop spending, and an unreadable secret must not take the service down.
 */
export function secretModelCallSwitch(options: SecretModelCallSwitchOptions): ModelCallSwitch {
  const read = secretModelCallSwitchReader(options);
  return async () => (await read()).paused;
}

/**
 * The deployment's switch: `DRAFT_LOOP_MODEL_CALLS_SECRET` names a Secret Manager version, and
 * `DRAFT_LOOP_MODEL_CALLS=paused` pauses calls where there is none.
 */
export function readModelCallSwitch(
  env: NodeJS.ProcessEnv,
  options: Omit<SecretModelCallSwitchOptions, "secret"> = {},
): ModelCallSwitch {
  try {
    const read = readModelCallSwitchReader(env, options);
    return async () => (await read()).paused;
  } catch (error) {
    if (error instanceof ModelCallSwitchConfigError) throw new ApiConfigError(error.message);
    throw error;
  }
}

/**
 * Refuses every registered model-calling route with 503 `model_calls_paused` while the switch is
 * paused, before the route or any model call runs. It runs before every route's own checks, so a
 * refused call is not counted. Routes whose path is `skipped` while paused still run.
 */
export function registerModelCallSwitch(app: FastifyInstance, paused: ModelCallSwitch): void {
  // Before validation, so a paused route answers the same whatever its body; after sign-in.
  app.addHook("preValidation", async (request, reply) => {
    const path = modelCallPathOf(request);
    if (path === undefined || path.whilePaused !== "refused") return;
    if (!(await paused())) return;
    request.log.warn({ event: "model_calls_paused", path: path.id }, "model call paused");
    await reply
      .code(503)
      .header("retry-after", "600")
      .send({
        error: {
          code: "model_calls_paused",
          message: "AI features are paused for a short while. Your work is saved; try again later.",
        },
      });
  });
}

/** Leaves the brief for the person, as a spent allowance does, while calls are paused. */
export function pausableBriefExtraction(
  allowance: BriefExtractionAllowance | undefined,
  paused: ModelCallSwitch,
): BriefExtractionAllowance {
  return {
    take: async (request) => {
      if (await paused()) {
        request.log.warn(
          { event: "model_calls_paused", path: "brief-extraction" },
          "model call paused",
        );
        return false;
      }
      return (await allowance?.take(request)) ?? true;
    },
    spent: async (request) => (await paused()) || ((await allowance?.spent(request)) ?? false),
  };
}
