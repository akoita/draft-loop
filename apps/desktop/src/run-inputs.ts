/**
 * The reviewed inputs a run recorded when it started, as the review state carries them.
 *
 * The host reads the requirements brief and career profile version from the run's own context
 * snapshot, so run comparison can say whether two runs shared them instead of guessing from the
 * workspace's current selection. A run started from raw job text records no brief, which reads as
 * `brief: null`; a run with no recorded context at all carries no `runInputs`.
 *
 * The runtime key lists are bound to the interfaces, so adding a field to one without the other
 * is a compile error rather than a validator that silently rejects real payloads.
 */

export interface RunBriefView {
  readonly briefId: string;
  readonly version: number;
}

export interface RunProfileView {
  readonly profileId: string;
  readonly version: number;
}

export interface RunInputsView {
  /** The reviewed brief the run used; null when it was started from raw job text. */
  readonly brief: RunBriefView | null;
  /** The reviewed career profile version the run used; null when it recorded none. */
  readonly profile: RunProfileView | null;
}

function exactKeys<Shape extends object>() {
  return <const Keys extends readonly (keyof Shape & string)[]>(
    keys: Keys & {
      readonly [Key in Exclude<keyof Shape, Keys[number]>]: "add this key to the runtime key list";
    },
  ): Keys => keys;
}

export const runInputsKeys = exactKeys<RunInputsView>()(["brief", "profile"]);
export const runBriefKeys = exactKeys<RunBriefView>()(["briefId", "version"]);
export const runProfileKeys = exactKeys<RunProfileView>()(["profileId", "version"]);

/** The review state with the run's recorded inputs, when it has any. */
export function withRunInputs<State extends object>(
  state: State,
  runInputs: RunInputsView | null,
): State {
  return runInputs === null ? state : { ...state, runInputs };
}

const maximumIdentifierLength = 200;

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  return Object.keys(raw).every((key) => keys.includes(key)) ? raw : undefined;
}

function identifier(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= maximumIdentifierLength
    ? value
    : undefined;
}

function version(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 ? value : undefined;
}

/** The inputs with only their known fields, or `undefined` when the value does not have its shape. */
export function normalizeRunInputs(value: unknown): RunInputsView | undefined {
  const raw = record(value, runInputsKeys);
  if (raw === undefined || raw.brief === undefined || raw.profile === undefined) return undefined;
  let brief: RunBriefView | null = null;
  if (raw.brief !== null) {
    const found = record(raw.brief, runBriefKeys);
    const briefId = identifier(found?.briefId);
    const briefVersion = version(found?.version);
    if (briefId === undefined || briefVersion === undefined) return undefined;
    brief = { briefId, version: briefVersion };
  }
  let profile: RunProfileView | null = null;
  if (raw.profile !== null) {
    const found = record(raw.profile, runProfileKeys);
    const profileId = identifier(found?.profileId);
    const profileVersion = version(found?.version);
    if (profileId === undefined || profileVersion === undefined) return undefined;
    profile = { profileId, version: profileVersion };
  }
  return { brief, profile };
}
