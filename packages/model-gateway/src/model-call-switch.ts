import { z } from "zod";

import {
  createSecretManagerCredentialResolver,
  type SecretVersionReader,
} from "./secret-credentials.js";

/**
 * The global model call switch (#3112), shared by the API and the worker so both read one value
 * the same way. The operator stores JSON in a Secret Manager version:
 *
 * - `{"modelCalls":"paused"}` stops every metered model call the API's registry lists, and stops
 *   Claude's refusal fallback in the worker.
 * - `{"refusalFallback":"off"}` stops only the refusal fallback (#3275).
 * - `{}`, `{"modelCalls":"on"}` or `{"refusalFallback":"on"}` let everything through.
 *
 * A self-hosted server without Secret Manager sets `DRAFT_LOOP_MODEL_CALLS=paused`.
 */
const storedSwitchSchema = z.strictObject({
  modelCalls: z.enum(["on", "paused"]).optional(),
  refusalFallback: z.enum(["on", "off"]).optional(),
});

export interface ModelCallSwitchState {
  /** Whether metered model calls are paused. */
  readonly paused: boolean;
  /** Whether Claude's refusal fallback may retry; false while paused. */
  readonly refusalFallback: boolean;
}

/** Reads the switch's current state. */
export type ModelCallSwitchReader = () => Promise<ModelCallSwitchState>;

export const modelCallSwitchRunning: ModelCallSwitchState = {
  paused: false,
  refusalFallback: true,
};

const pausedState: ModelCallSwitchState = { paused: true, refusalFallback: false };

/** Parses the stored text. Empty text lets everything through; text that is not valid throws. */
export function parseModelCallSwitchState(text: string | undefined): ModelCallSwitchState {
  const trimmed = text?.trim() ?? "";
  if (trimmed === "") return modelCallSwitchRunning;
  const stored = storedSwitchSchema.parse(JSON.parse(trimmed));
  const paused = stored.modelCalls === "paused";
  return { paused, refusalFallback: !paused && stored.refusalFallback !== "off" };
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
 * Reads the switch from Secret Manager. A failed or invalid read keeps calls running, as before
 * the switch existed: it is for the operator to stop spending, and an unreadable secret must not
 * take the service down.
 */
export function secretModelCallSwitchReader(
  options: SecretModelCallSwitchOptions,
): ModelCallSwitchReader {
  const resolve = createSecretManagerCredentialResolver({
    secrets: { switch: options.secret },
    ttlMs: options.ttlMs ?? 60_000,
    ...(options.client === undefined ? {} : { client: options.client }),
  });
  return async () => {
    try {
      return parseModelCallSwitchState(await resolve("switch"));
    } catch (error) {
      options.onReadError?.(error);
      return modelCallSwitchRunning;
    }
  };
}

export class ModelCallSwitchConfigError extends Error {
  override readonly name = "ModelCallSwitchConfigError";
}

/**
 * The deployment's switch: `DRAFT_LOOP_MODEL_CALLS_SECRET` names a Secret Manager version, and
 * `DRAFT_LOOP_MODEL_CALLS=paused` pauses calls where there is none.
 */
export function readModelCallSwitchReader(
  env: NodeJS.ProcessEnv,
  options: Omit<SecretModelCallSwitchOptions, "secret"> = {},
): ModelCallSwitchReader {
  const secret = env.DRAFT_LOOP_MODEL_CALLS_SECRET?.trim() ?? "";
  if (secret !== "") {
    try {
      return secretModelCallSwitchReader({ ...options, secret });
    } catch (error) {
      throw new ModelCallSwitchConfigError(
        "DRAFT_LOOP_MODEL_CALLS_SECRET must name a Secret Manager secret version.",
        { cause: error },
      );
    }
  }
  const value = env.DRAFT_LOOP_MODEL_CALLS?.trim() ?? "";
  if (value === "" || value === "on") return async () => modelCallSwitchRunning;
  if (value === "paused") return async () => pausedState;
  throw new ModelCallSwitchConfigError("DRAFT_LOOP_MODEL_CALLS must be on or paused.");
}
