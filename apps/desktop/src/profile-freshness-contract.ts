/**
 * Bridge contract for career profile freshness (ADR 0010).
 *
 * Freshness says whether the reviewed career profile is current with the career evidence. It
 * crosses the bridge as a state and counts only: no source names, ids, text or paths. The runtime
 * key lists are bound to the interfaces, so adding a field to one without the other is a compile
 * error rather than a validator that silently rejects real payloads.
 */

export const profileFreshnessStates = [
  "not-generated",
  "up-to-date",
  "update-available",
  "review-pending",
  "unavailable",
] as const;
export type ProfileFreshnessState = (typeof profileFreshnessStates)[number];

export interface ProfileFreshnessInput {
  readonly workspaceId: string;
  readonly profileId: string;
}

/**
 * - `not-generated`: no version exists.
 * - `up-to-date`: the newest version is reviewed and matches the career evidence.
 * - `update-available`: sources were added, changed or retired since the newest reviewed version.
 * - `review-pending`: the newest version is a draft; `reviewedVersion` is the last reviewed one.
 * - `unavailable`: the comparison cannot be made; the version is null when the host cannot say.
 */
export interface ProfileFreshnessResult {
  readonly workspaceId: string;
  readonly profileId: string;
  readonly state: ProfileFreshnessState;
  /** The newest saved version; null before the first version or when the host cannot say. */
  readonly version: number | null;
  /** The last reviewed version, only while a newer draft awaits review; otherwise null. */
  readonly reviewedVersion: number | null;
  /** Counts are zero unless the state is `update-available`. */
  readonly newSourceCount: number;
  readonly changedSourceCount: number;
  readonly removedSourceCount: number;
}

function exactKeys<Shape extends object>() {
  return <const Keys extends readonly (keyof Shape & string)[]>(
    keys: Keys & {
      readonly [Key in Exclude<keyof Shape, Keys[number]>]: "add this key to the runtime key list";
    },
  ): Keys => keys;
}

export const profileFreshnessInputKeys = exactKeys<ProfileFreshnessInput>()([
  "workspaceId",
  "profileId",
]);
const resultKeys = exactKeys<ProfileFreshnessResult>()([
  "workspaceId",
  "profileId",
  "state",
  "version",
  "reviewedVersion",
  "newSourceCount",
  "changedSourceCount",
  "removedSourceCount",
]);

const maximumCount = 1_000_000;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$/u;

type Raw = Readonly<Record<string, unknown>>;

function record(value: unknown): Raw | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Raw)
    : undefined;
}

function identifier(value: unknown): string | undefined {
  return typeof value === "string" && identifierPattern.test(value) ? value : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximumCount
    ? value
    : undefined;
}

function optionalVersion(value: unknown): number | null | undefined {
  if (value === null) return null;
  const parsed = count(value);
  return parsed === undefined || parsed < 1 ? undefined : parsed;
}

/** Validates a freshness answer from the host; `undefined` means the host answered wrongly. */
export function normalizeProfileFreshnessResult(
  value: unknown,
): ProfileFreshnessResult | undefined {
  const raw = record(value);
  if (raw === undefined || !Object.keys(raw).every((key) => resultKeys.includes(key as never))) {
    return undefined;
  }
  const workspaceId = identifier(raw.workspaceId);
  const profileId = identifier(raw.profileId);
  const state = profileFreshnessStates.find((candidate) => candidate === raw.state);
  const version = optionalVersion(raw.version);
  const reviewedVersion = optionalVersion(raw.reviewedVersion);
  const newSourceCount = count(raw.newSourceCount);
  const changedSourceCount = count(raw.changedSourceCount);
  const removedSourceCount = count(raw.removedSourceCount);
  if (
    workspaceId === undefined ||
    profileId === undefined ||
    state === undefined ||
    version === undefined ||
    reviewedVersion === undefined ||
    newSourceCount === undefined ||
    changedSourceCount === undefined ||
    removedSourceCount === undefined
  ) {
    return undefined;
  }
  const changes = newSourceCount + changedSourceCount + removedSourceCount;
  // Each state carries only the fields that mean something for it.
  if (state === "not-generated" && version !== null) return undefined;
  if (state !== "not-generated" && state !== "unavailable" && version === null) return undefined;
  if (reviewedVersion !== null && (state !== "review-pending" || version === null)) {
    return undefined;
  }
  if (reviewedVersion !== null && version !== null && reviewedVersion >= version) return undefined;
  if (state === "update-available" ? changes === 0 : changes !== 0) return undefined;
  return {
    workspaceId,
    profileId,
    state,
    version,
    reviewedVersion,
    newSourceCount,
    changedSourceCount,
    removedSourceCount,
  };
}
