/**
 * The runs of the reviewed application, as the review screen lists them.
 *
 * The host reads each run's snapshot and recorded models; only display fields cross the bridge.
 * The list is read-only: it shows how each model pair did on the same job.
 *
 * The runtime key list is bound to the interface, so adding a field to one without the other is
 * a compile error rather than a validator that silently rejects real payloads.
 */
import { type ModelProfileEffort, modelProfileEfforts } from "@draft-loop/domain/model-profile";

export interface ApplicationRunRowView {
  readonly runId: string;
  readonly startedAt: string;
  /** The author's model id, or an empty string when the run recorded no models. */
  readonly authorModel: string;
  /** The critic's model id, or an empty string when the run recorded no models. */
  readonly criticModel: string;
  /** The reasoning level the author ran at, when the run used a model profile. */
  readonly authorEffort?: ModelProfileEffort;
  readonly criticEffort?: ModelProfileEffort;
  readonly round: number;
  readonly state: string;
  /** Mean of the latest readiness evaluation's dimension scores, 0 to 1; absent without one. */
  readonly score?: number;
  /** The application's newest run; exactly one row carries it. */
  readonly latest: boolean;
  /** The run whose draft the person chose for approval and export; at most one row carries it. */
  readonly chosen?: boolean;
}

function exactKeys<Shape extends object>() {
  return <const Keys extends readonly (keyof Shape & string)[]>(
    keys: Keys & {
      readonly [Key in Exclude<keyof Shape, Keys[number]>]: "add this key to the runtime key list";
    },
  ): Keys => keys;
}

export const applicationRunRowKeys = exactKeys<ApplicationRunRowView>()([
  "runId",
  "startedAt",
  "authorModel",
  "criticModel",
  "authorEffort",
  "criticEffort",
  "round",
  "state",
  "score",
  "latest",
  "chosen",
]);

/** The most runs the host sends and the bridge accepts. */
export const maximumApplicationRuns = 50;
const maximumTextLength = 200;
const maximumCount = 1_000_000;

function text(value: unknown, allowEmpty = false): string | undefined {
  return typeof value === "string" &&
    value.length <= maximumTextLength &&
    (allowEmpty || value.length > 0)
    ? value
    : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= maximumCount
    ? value
    : undefined;
}

function score(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : undefined;
}

function effort(value: unknown): ModelProfileEffort | undefined {
  return modelProfileEfforts.find((level) => level === value);
}

function normalizeRow(value: unknown): ApplicationRunRowView | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (
    !Object.keys(raw).every((key) => (applicationRunRowKeys as readonly string[]).includes(key))
  ) {
    return undefined;
  }
  const runId = text(raw.runId);
  const startedAt = text(raw.startedAt);
  const authorModel = text(raw.authorModel, true);
  const criticModel = text(raw.criticModel, true);
  const round = count(raw.round);
  const state = text(raw.state);
  const rowScore = raw.score === undefined ? undefined : score(raw.score);
  const authorEffort = effort(raw.authorEffort);
  const criticEffort = effort(raw.criticEffort);
  if (
    runId === undefined ||
    startedAt === undefined ||
    authorModel === undefined ||
    criticModel === undefined ||
    round === undefined ||
    state === undefined ||
    (raw.score !== undefined && rowScore === undefined) ||
    (raw.authorEffort !== undefined && authorEffort === undefined) ||
    (raw.criticEffort !== undefined && criticEffort === undefined) ||
    typeof raw.latest !== "boolean" ||
    (raw.chosen !== undefined && typeof raw.chosen !== "boolean")
  ) {
    return undefined;
  }
  return {
    runId,
    startedAt,
    authorModel,
    criticModel,
    ...(authorEffort === undefined ? {} : { authorEffort }),
    ...(criticEffort === undefined ? {} : { criticEffort }),
    round,
    state,
    ...(rowScore === undefined ? {} : { score: rowScore }),
    latest: raw.latest,
    ...(raw.chosen === true ? { chosen: true } : {}),
  };
}

/**
 * The rows with only their known fields, or `undefined` when the value is not a list of at most
 * {@link maximumApplicationRuns} rows with at most one marked latest.
 */
export function normalizeApplicationRuns(
  value: unknown,
): readonly ApplicationRunRowView[] | undefined {
  if (!Array.isArray(value) || value.length > maximumApplicationRuns) return undefined;
  const rows: ApplicationRunRowView[] = [];
  for (const item of value) {
    const row = normalizeRow(item);
    if (row === undefined) return undefined;
    rows.push(row);
  }
  return rows.filter((row) => row.latest).length > 1 ||
    rows.filter((row) => row.chosen === true).length > 1
    ? undefined
    : rows;
}

/** One run before ordering: everything but the latest and chosen markers. */
export type ApplicationRunInput = Omit<ApplicationRunRowView, "latest" | "chosen">;

/** The rows with the chosen run marked; unchanged without a chosen run. */
export function markChosenRun(
  rows: readonly ApplicationRunRowView[],
  chosenRunId: string | undefined,
): readonly ApplicationRunRowView[] {
  if (chosenRunId === undefined) return rows;
  return rows.map((row) => (row.runId === chosenRunId ? { ...row, chosen: true } : row));
}

function startedTime(row: ApplicationRunInput): number {
  const time = Date.parse(row.startedAt);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/**
 * Newest start first, at most {@link maximumApplicationRuns} rows, with exactly one marked latest.
 *
 * The latest run is `latestRunId` when it is listed, as the application's own newest-run rule
 * chose it, and otherwise the first row. It leads its start time; other equal start times are
 * ordered by run id, descending.
 */
export function orderApplicationRuns(
  runs: readonly ApplicationRunInput[],
  latestRunId?: string,
): readonly ApplicationRunRowView[] {
  const latestId =
    latestRunId !== undefined && runs.some((run) => run.runId === latestRunId)
      ? latestRunId
      : undefined;
  const ordered = [...runs].sort((left, right) => {
    const byTime = startedTime(right) - startedTime(left);
    if (byTime !== 0 && !Number.isNaN(byTime)) return byTime;
    if (left.runId === latestId) return -1;
    if (right.runId === latestId) return 1;
    return left.runId < right.runId ? 1 : left.runId > right.runId ? -1 : 0;
  });
  const marked = latestId ?? ordered[0]?.runId;
  return ordered
    .slice(0, maximumApplicationRuns)
    .map((run) => ({ ...run, latest: run.runId === marked }));
}

/**
 * The mean of an evaluation's dimension scores, or `undefined` without any finite score in the
 * 0 to 1 range. Readiness has no single overall score, so the list shows this mean.
 */
export function meanReadinessScore(
  scores: Readonly<Record<string, number>> | null | undefined,
): number | undefined {
  const values = Object.values(scores ?? {}).filter(
    (value) => Number.isFinite(value) && value >= 0 && value <= 1,
  );
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
