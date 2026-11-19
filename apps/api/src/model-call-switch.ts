import type { SecretVersionReader } from "@draft-loop/model-gateway";
import { createSecretManagerCredentialResolver } from "@draft-loop/model-gateway";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { BriefExtractionAllowance } from "./brief-extraction-allowance.js";
import { ApiConfigError } from "./config.js";
import { modelCallPathOf } from "./model-call-registry.js";

/**
 * The global model call switch (#3112): one value stops every metered model call the registry
 * lists, without a deploy. The operator stores `{"modelCalls":"paused"}` in a Secret Manager
 * version, read within a minute like the support limits; `{}` or `{"modelCalls":"on"}` lets calls
 * through. A self-hosted server without Secret Manager sets `DRAFT_LOOP_MODEL_CALLS=paused`.
 */
const storedSwitchSchema = z.strictObject({
  modelCalls: z.enum(["on", "paused"]).optional(),
});

/** Whether metered model calls are paused right now. */
export type ModelCallSwitch = () => Promise<boolean>;

export const modelCallsRunning: ModelCallSwitch = async () => false;

/** Parses the stored text. Text that is not a valid object throws. */
export function parseModelCallSwitch(text: string | undefined): boolean {
  const trimmed = text?.trim() ?? "";
  if (trimmed === "") return false;
  return storedSwitchSchema.parse(JSON.parse(trimmed)).modelCalls === "paused";
}

export interface SecretModelCallSwitchOptions {
  /** `projects/<project>/secrets/<name>/versions/latest`, from the deployment. */
  readonly secret: string;
  readonly client?: SecretVersionReader;
  /** How long a read stays in memory; a change applies within it. One minute. */
  readonly ttlMs?: number;
  readonly onReadError?: (error: unknown) => void;
}

/**
 * Reads the switch from Secret Manager. A failed or invalid read keeps calls running: the switch
 * is for the operator to stop spending, and an unreadable secret must not take the service down.
 */
export function secretModelCallSwitch(options: SecretModelCallSwitchOptions): ModelCallSwitch {
  const resolve = createSecretManagerCredentialResolver({
    secrets: { switch: options.secret },
    ttlMs: options.ttlMs ?? 60_000,
    ...(options.client === undefined ? {} : { client: options.client }),
  });
  return async () => {
    try {
      return parseModelCallSwitch(await resolve("switch"));
    } catch (error) {
      options.onReadError?.(error);
      return false;
    }
  };
}

/**
 * The deployment's switch: `DRAFT_LOOP_MODEL_CALLS_SECRET` names a Secret Manager version, and
 * `DRAFT_LOOP_MODEL_CALLS=paused` pauses calls where there is none.
 */
export function readModelCallSwitch(
  env: NodeJS.ProcessEnv,
  options: Omit<SecretModelCallSwitchOptions, "secret"> = {},
): ModelCallSwitch {
  const secret = env.DRAFT_LOOP_MODEL_CALLS_SECRET?.trim() ?? "";
  if (secret !== "") return secretModelCallSwitch({ ...options, secret });
  const value = env.DRAFT_LOOP_MODEL_CALLS?.trim() ?? "";
  if (value === "" || value === "on") return modelCallsRunning;
  if (value === "paused") return async () => true;
  throw new ApiConfigError("DRAFT_LOOP_MODEL_CALLS must be on or paused.");
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
