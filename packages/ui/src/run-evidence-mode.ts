/**
 * The evidence mode a run actually used, as the review screen shows it.
 *
 * Workspace readiness describes what a fresh retrieval would select today; a run that sent its
 * full source recorded a different decision. The host reads that recorded decision per run and
 * sends only modes, counts and the fallback reason across the bridge. Retrieval-mode runs record
 * nothing, so the review keeps its readiness-based display for them.
 *
 * The runtime key list is bound to the interface, so adding a field to one without the other is
 * a compile error rather than a validator that silently rejects real payloads.
 */

const evidenceModes = ["retrieval", "full-source"] as const;
const fallbackReasons = ["budget-exceeded", "no-eligible-chunks"] as const;

export interface RunEvidenceModeView {
  readonly requestedMode: (typeof evidenceModes)[number];
  readonly effectiveMode: (typeof evidenceModes)[number];
  readonly chunkCount: number;
  /** Absent for runs recorded before the source count was kept. */
  readonly sourceCount?: number;
  readonly fallbackReason?: (typeof fallbackReasons)[number];
}

function exactKeys<Shape extends object>() {
  return <const Keys extends readonly (keyof Shape & string)[]>(
    keys: Keys & {
      readonly [Key in Exclude<keyof Shape, Keys[number]>]: "add this key to the runtime key list";
    },
  ): Keys => keys;
}

export const runEvidenceModeKeys = exactKeys<RunEvidenceModeView>()([
  "requestedMode",
  "effectiveMode",
  "chunkCount",
  "sourceCount",
  "fallbackReason",
]);

const maximumCount = 1_000_000;

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= maximumCount
    ? value
    : undefined;
}

function member<Value extends string>(value: unknown, values: readonly Value[]): Value | undefined {
  return typeof value === "string" && (values as readonly string[]).includes(value)
    ? (value as Value)
    : undefined;
}

/** The view with only its known fields, or `undefined` when the value does not have its shape. */
export function normalizeRunEvidenceMode(value: unknown): RunEvidenceModeView | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (!Object.keys(raw).every((key) => (runEvidenceModeKeys as readonly string[]).includes(key))) {
    return undefined;
  }
  const requestedMode = member(raw.requestedMode, evidenceModes);
  const effectiveMode = member(raw.effectiveMode, evidenceModes);
  const chunkCount = count(raw.chunkCount);
  const sourceCount = raw.sourceCount === undefined ? undefined : count(raw.sourceCount);
  const fallbackReason =
    raw.fallbackReason === undefined ? undefined : member(raw.fallbackReason, fallbackReasons);
  if (
    requestedMode === undefined ||
    effectiveMode === undefined ||
    chunkCount === undefined ||
    (raw.sourceCount !== undefined && sourceCount === undefined) ||
    (raw.fallbackReason !== undefined && fallbackReason === undefined)
  ) {
    return undefined;
  }
  return {
    requestedMode,
    effectiveMode,
    chunkCount,
    ...(sourceCount === undefined ? {} : { sourceCount }),
    ...(fallbackReason === undefined ? {} : { fallbackReason }),
  };
}

export type RunEvidenceModeDisplay =
  | {
      readonly kind: "full-source";
      /** Retrieval-strip status, e.g. "181 chunks from 1 source". */
      readonly stripStatus: string;
      /** Side-panel value, e.g. "181 chunks". */
      readonly panelValue: string;
      /** Side-panel detail, e.g. "full source from 1 source". */
      readonly panelDetail: string;
    }
  | {
      readonly kind: "fallback";
      readonly stripStatus: string;
      /** Replaces the side panel's "from N sources" detail; the excerpt count stays. */
      readonly panelDetail: string;
    };

function plural(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

/** What the review shows for the run's recorded mode; `undefined` keeps the readiness display. */
export function runEvidenceModeDisplay(
  mode: RunEvidenceModeView | null | undefined,
): RunEvidenceModeDisplay | undefined {
  if (mode === undefined || mode === null || mode.requestedMode !== "full-source") return undefined;
  if (mode.effectiveMode === "full-source") {
    const sources =
      mode.sourceCount === undefined ? "" : ` from ${plural(mode.sourceCount, "source")}`;
    return {
      kind: "full-source",
      stripStatus: `${plural(mode.chunkCount, "chunk")}${sources}`,
      panelValue: plural(mode.chunkCount, "chunk"),
      panelDetail: `full source${sources}`,
    };
  }
  if (mode.fallbackReason === "budget-exceeded") {
    return {
      kind: "fallback",
      stripStatus: `Full source did not fit the evidence budget (${plural(mode.chunkCount, "chunk")}), so retrieval was used`,
      panelDetail: "retrieval; full source did not fit",
    };
  }
  if (mode.fallbackReason === "no-eligible-chunks") {
    return {
      kind: "fallback",
      stripStatus: "No eligible chunks for full source, so retrieval was used",
      panelDetail: "retrieval; no full-source chunks",
    };
  }
  return undefined;
}
