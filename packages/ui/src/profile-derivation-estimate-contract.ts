/**
 * Bridge contract for a career profile derivation's estimate (#3183): what an update would send
 * and roughly cost, before the person starts it. It crosses the bridge as counts and a price range
 * only, never source names, text or paths.
 */

export interface ProfileDerivationEstimateInput {
  readonly workspaceId: string;
  readonly profileId: string;
  readonly fullExtraction?: true;
}

export interface ProfileDerivationEstimateResult {
  readonly reusedSourceCount: number;
  readonly extractedSourceCount: number;
  readonly extractedCharacters: number;
  readonly calls: number;
  /** In US dollars; null when the extraction model has no price. */
  readonly estimatedUsd: { readonly low: number; readonly high: number } | null;
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$/u;
const inputKeys = new Set(["workspaceId", "profileId", "fullExtraction"]);
const resultKeys = new Set([
  "reusedSourceCount",
  "extractedSourceCount",
  "extractedCharacters",
  "calls",
  "estimatedUsd",
]);
const maximumCount = 1_000_000_000;
const maximumUsd = 1_000_000;

type Raw = Readonly<Record<string, unknown>>;

function record(value: unknown): Raw | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Raw)
    : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximumCount
    ? value
    : undefined;
}

function usd(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximumUsd
    ? value
    : undefined;
}

/** Validates a screen's request; throws on anything but the two ids and the full-extraction flag. */
export function validateProfileDerivationEstimateInput(
  value: unknown,
): ProfileDerivationEstimateInput {
  const raw = record(value);
  const workspaceId = raw?.workspaceId;
  const profileId = raw?.profileId;
  if (
    raw === undefined ||
    !Object.keys(raw).every((key) => inputKeys.has(key)) ||
    typeof workspaceId !== "string" ||
    !identifierPattern.test(workspaceId) ||
    typeof profileId !== "string" ||
    !identifierPattern.test(profileId) ||
    (raw.fullExtraction !== undefined && raw.fullExtraction !== true)
  ) {
    throw new TypeError("Invalid profile derivation estimate request.");
  }
  return {
    workspaceId,
    profileId,
    ...(raw.fullExtraction === true ? { fullExtraction: true } : {}),
  };
}

/** Validates a host's estimate; `undefined` means the host answered wrongly. */
export function normalizeProfileDerivationEstimateResult(
  value: unknown,
): ProfileDerivationEstimateResult | undefined {
  const raw = record(value);
  if (raw === undefined || !Object.keys(raw).every((key) => resultKeys.has(key))) return undefined;
  const reusedSourceCount = count(raw.reusedSourceCount);
  const extractedSourceCount = count(raw.extractedSourceCount);
  const extractedCharacters = count(raw.extractedCharacters);
  const calls = count(raw.calls);
  let estimatedUsd: ProfileDerivationEstimateResult["estimatedUsd"] | undefined = null;
  if (raw.estimatedUsd !== null) {
    const range = record(raw.estimatedUsd);
    const low = usd(range?.low);
    const high = usd(range?.high);
    estimatedUsd =
      range === undefined ||
      Object.keys(range).some((key) => key !== "low" && key !== "high") ||
      low === undefined ||
      high === undefined ||
      low > high
        ? undefined
        : { low, high };
  }
  if (
    reusedSourceCount === undefined ||
    extractedSourceCount === undefined ||
    extractedCharacters === undefined ||
    calls === undefined ||
    estimatedUsd === undefined
  ) {
    return undefined;
  }
  return { reusedSourceCount, extractedSourceCount, extractedCharacters, calls, estimatedUsd };
}
