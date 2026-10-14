import type { ReviewAction } from "./model.js";

/**
 * An earlier run of the reviewed application, opened from the run list.
 *
 * The host marks a review state with this when the loaded run is not the application's latest.
 * The review then shows the run read-only, and the host refuses changes to it, so read-only is
 * enforced rather than only hidden.
 *
 * The runtime key list is bound to the interface, so adding a field to one without the other is
 * a compile error rather than a validator that silently rejects real payloads.
 */
export interface EarlierRunView {
  /** The application's latest run, which takes every change. */
  readonly latestRunId: string;
}

function exactKeys<Shape extends object>() {
  return <const Keys extends readonly (keyof Shape & string)[]>(
    keys: Keys & {
      readonly [Key in Exclude<keyof Shape, Keys[number]>]: "add this key to the runtime key list";
    },
  ): Keys => keys;
}

export const earlierRunKeys = exactKeys<EarlierRunView>()(["latestRunId"]);

const maximumRunIdLength = 200;

/** The view with only its known fields, or `undefined` when the value does not have its shape. */
export function normalizeEarlierRun(value: unknown): EarlierRunView | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (!Object.keys(raw).every((key) => (earlierRunKeys as readonly string[]).includes(key))) {
    return undefined;
  }
  const latestRunId = raw.latestRunId;
  if (
    typeof latestRunId !== "string" ||
    latestRunId.length === 0 ||
    latestRunId.length > maximumRunIdLength
  ) {
    return undefined;
  }
  return { latestRunId };
}

/** Why an earlier run refuses a change; the host and the review say the same thing. */
export const earlierRunRefusal = "This is an earlier run. Open the latest run to change it.";

/**
 * Whether an action may be taken while an earlier run is open. Only actions that change no run
 * pass: the workspace-wide transmission acknowledgement and autopilot setting, and starting a
 * new review, which never targets the run on screen.
 */
export function earlierRunAllowsAction(type: ReviewAction["type"]): boolean {
  return (
    type === "acknowledge-provider-transmission" || type === "set-autopilot" || type === "start"
  );
}
