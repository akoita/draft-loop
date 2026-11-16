import type { BilledUsage, JsonValue, ModelResponse } from "@draft-loop/providers";

/** Which job a metered call served; a fixed word, never material. */
export type MeteredCallPurpose = "opportunity-extraction" | "profile-derivation";

/**
 * One provider call's content-free usage (#2806): the purpose, company, model, route, tokens and
 * estimated cost. A failed call reports what the provider billed for it, or zero tokens and no
 * cost when it never answered.
 */
export interface MeteredModelCall {
  readonly purpose: MeteredCallPurpose;
  readonly company: string;
  readonly model: string;
  readonly route: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** `null` when the model has no price, so the cost cannot be estimated. */
  readonly estimatedUsd: number | null;
  readonly failed: boolean;
}

/** Receives each metered call, such as the worker's log; it must not throw. */
export type ModelCallMeter = (call: MeteredModelCall) => void;

interface Executes {
  readonly execute: (request: never) => Promise<ModelResponse<JsonValue>>;
}

function billedOf(error: unknown): BilledUsage | undefined {
  const billed = (error as { readonly billed?: unknown } | null)?.billed;
  return billed === null || typeof billed !== "object" ? undefined : (billed as BilledUsage);
}

function routeOf(error: unknown): string | null {
  const route = (error as { readonly route?: unknown } | null)?.route;
  return typeof route === "string" ? route : null;
}

/**
 * The adapter with each `execute` reported to the meter, answered or failed. Without a meter it
 * is the adapter itself, so the desktop and the CLI run unchanged.
 */
export function meterAdapter<Adapter extends Executes>(
  adapter: Adapter,
  identity: {
    readonly purpose: MeteredCallPurpose;
    readonly company: string;
    readonly model: string;
  },
  meter: ModelCallMeter | undefined,
): Adapter {
  if (meter === undefined) return adapter;
  const execute = adapter.execute.bind(adapter) as (
    request: Parameters<Adapter["execute"]>[0],
  ) => Promise<ModelResponse<JsonValue>>;
  const metered = Object.create(adapter) as Adapter & { execute: Adapter["execute"] };
  Object.defineProperty(metered, "execute", {
    value: async (request: Parameters<Adapter["execute"]>[0]) => {
      try {
        const response = await execute(request);
        meter({
          purpose: identity.purpose,
          company: response.company,
          model: response.modelId,
          route: response.route,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          estimatedUsd: response.cost.estimatedUsd,
          failed: false,
        });
        return response;
      } catch (error) {
        const billed = billedOf(error);
        meter({
          ...identity,
          route: routeOf(error),
          inputTokens: billed?.usage.inputTokens ?? 0,
          outputTokens: billed?.usage.outputTokens ?? 0,
          estimatedUsd: billed === undefined ? 0 : billed.cost.estimatedUsd,
          failed: true,
        });
        throw error;
      }
    },
  });
  return metered;
}
