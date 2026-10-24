/**
 * Bridge contract for testing a saved provider API key before a run.
 *
 * The renderer names a provider and gets back an outcome, the models it concerns, at most one
 * short provider error token, and when it was checked. The key itself never crosses the bridge in
 * either direction: the host reads it from its own credential store.
 */

export const credentialTestProviders = ["anthropic", "openai"] as const;
export type CredentialTestProvider = (typeof credentialTestProviders)[number];

export const credentialTestOutcomes = [
  "works",
  "rejected",
  "no-model-access",
  "limited",
  "unreachable",
] as const;
export type CredentialTestOutcome = (typeof credentialTestOutcomes)[number];

export interface CredentialTestInput {
  readonly provider: CredentialTestProvider;
}

/**
 * - `works`: the key was accepted and every model in `models` is available to it. `models` is
 *   empty when the open workspace uses no model from this provider, so only the key was checked.
 * - `rejected`: the provider refused the key.
 * - `no-model-access`: the key works but cannot reach the one model in `models`.
 * - `limited`: a quota or rate limit answered; `providerCode` holds the provider's token if safe.
 * - `unreachable`: the check could not reach the provider or read its answer.
 */
export interface CredentialTestResult {
  readonly provider: CredentialTestProvider;
  readonly outcome: CredentialTestOutcome;
  readonly models: readonly string[];
  readonly providerCode: string | null;
  /** ISO 8601 time of the check. */
  readonly checkedAt: string;
}

function exactKeys<Shape extends object>() {
  return <const Keys extends readonly (keyof Shape & string)[]>(
    keys: Keys & {
      readonly [Key in Exclude<keyof Shape, Keys[number]>]: "add this key to the runtime key list";
    },
  ): Keys => keys;
}

export const credentialTestInputKeys = exactKeys<CredentialTestInput>()(["provider"]);
const resultKeys = exactKeys<CredentialTestResult>()([
  "provider",
  "outcome",
  "models",
  "providerCode",
  "checkedAt",
]);

/** An author and a critic: a key serves at most two models of one run. */
const maximumModels = 2;
// Kept in step with the bridge's `modelId` rule.
const modelIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const providerCodePattern = /^[a-z][a-z0-9_]{0,47}$/u;

type Raw = Readonly<Record<string, unknown>>;

function record(value: unknown): Raw | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Raw)
    : undefined;
}

function models(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > maximumModels) return undefined;
  const ids = value.filter((id): id is string => typeof id === "string" && modelIdPattern.test(id));
  return ids.length === value.length ? ids : undefined;
}

function providerCode(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && providerCodePattern.test(value) ? value : undefined;
}

function timestamp(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value))
    ? value
    : undefined;
}

/** Validates a key test answer from the host; `undefined` means the host answered wrongly. */
export function normalizeCredentialTestResult(value: unknown): CredentialTestResult | undefined {
  const raw = record(value);
  if (raw === undefined || !Object.keys(raw).every((key) => resultKeys.includes(key as never))) {
    return undefined;
  }
  const provider = credentialTestProviders.find((candidate) => candidate === raw.provider);
  const outcome = credentialTestOutcomes.find((candidate) => candidate === raw.outcome);
  const checkedModels = models(raw.models);
  const code = providerCode(raw.providerCode);
  const checkedAt = timestamp(raw.checkedAt);
  if (
    provider === undefined ||
    outcome === undefined ||
    checkedModels === undefined ||
    code === undefined ||
    checkedAt === undefined
  ) {
    return undefined;
  }
  // A token explains a limit only, and a missing model is always named.
  if (code !== null && outcome !== "limited") return undefined;
  if (outcome === "no-model-access" && checkedModels.length !== 1) return undefined;
  return { provider, outcome, models: checkedModels, providerCode: code, checkedAt };
}
