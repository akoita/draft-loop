/**
 * How the host reaches each provider company that has a choice of route, so the renderer can say
 * before a run starts whether a call is billed per token or runs on a signed-in session.
 *
 * The runtime key list is bound to the interface, so adding a field to one without the other is a
 * compile error rather than a validator that silently rejects real payloads.
 */

export type ProviderRoute = "api-key" | "user-session";

export interface ProviderRoutesView {
  readonly anthropic: ProviderRoute;
  readonly openai: ProviderRoute;
  /** The time limit each provider call has on the session route. */
  readonly sessionCallLimitMs: number;
}

function exactKeys<Shape extends object>() {
  return <const Keys extends readonly (keyof Shape & string)[]>(
    keys: Keys & {
      readonly [Key in Exclude<keyof Shape, Keys[number]>]: "add this key to the runtime key list";
    },
  ): Keys => keys;
}

export const providerRoutesKeys = exactKeys<ProviderRoutesView>()([
  "anthropic",
  "openai",
  "sessionCallLimitMs",
]);

const providerRouteValues: readonly ProviderRoute[] = ["api-key", "user-session"];
/** A day: far above any configured call limit, and still a finite, sane number. */
const maximumCallLimitMs = 86_400_000;

function route(value: unknown): ProviderRoute | undefined {
  return providerRouteValues.find((candidate) => candidate === value);
}

/** The routes with only their known fields, or `undefined` when the value is not valid. */
export function normalizeProviderRoutes(value: unknown): ProviderRoutesView | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (!Object.keys(raw).every((key) => (providerRoutesKeys as readonly string[]).includes(key))) {
    return undefined;
  }
  const anthropic = route(raw.anthropic);
  const openai = route(raw.openai);
  const limit = raw.sessionCallLimitMs;
  if (
    anthropic === undefined ||
    openai === undefined ||
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit <= 0 ||
    limit > maximumCallLimitMs
  ) {
    return undefined;
  }
  return { anthropic, openai, sessionCallLimitMs: limit };
}
