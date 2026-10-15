/**
 * What two compared runs recorded, side by side, and where their inputs differ.
 *
 * Every value comes from the run's own review state: the models from its run-list row, the
 * rounds, readiness, findings and cost from its record, the coverage tally and coverage
 * instructions from its coverage judgement, and the evidence mode and writing policy it
 * recorded. Nothing is read from the workspace's current configuration, so a run started with
 * other models, another policy or another brief is never credited with today's setup. A value a
 * run did not record reads "not recorded".
 */
import { meanReadinessScore } from "./application-run-list.js";
import { type DesktopReviewState, isUnresolvedFinding } from "./model.js";
import { coverageTally } from "./review-work-tabs.js";
import { policyChecksumLabel, recordedRunModels } from "./run-details.js";

export const notRecorded = "not recorded";

/** One fact about each run, e.g. the rounds each took. */
export interface ComparisonFactRow {
  readonly key:
    | "author-model"
    | "critic-model"
    | "rounds"
    | "readiness"
    | "coverage"
    | "blocking-findings"
    | "cost";
  readonly label: string;
  readonly left: string;
  readonly right: string;
  /** Set when the values were judged under different coverage instructions. */
  readonly note?: string;
}

export type InputDifferenceStatus = "same" | "different" | "unknown";

/** One input to both runs, and whether they had the same one. */
export interface InputDifferenceRow {
  readonly key:
    | "requirements-brief"
    | "career-profile"
    | "evidence"
    | "writing-policy"
    | "coverage-instructions";
  readonly label: string;
  readonly left: string;
  readonly right: string;
  readonly status: InputDifferenceStatus;
  /** The row in words, e.g. "Different writing policy: v3 vs v5". */
  readonly message: string;
}

export interface RunComparisonFacts {
  readonly leftLabel: string;
  readonly rightLabel: string;
  readonly facts: readonly ComparisonFactRow[];
  readonly inputs: readonly InputDifferenceRow[];
  /** Whether the runs' coverage was judged under different instructions. */
  readonly notDirectlyComparable: boolean;
}

export const notDirectlyComparable = "not directly comparable";

type RunState = Pick<
  DesktopReviewState,
  | "runId"
  | "applicationRuns"
  | "round"
  | "evaluation"
  | "coverage"
  | "findings"
  | "totalCostUsd"
  | "evidenceMode"
  | "writingPolicy"
>;

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function modelOf(state: RunState, role: "author" | "critic"): string {
  const recorded = recordedRunModels(state);
  const model = recorded?.[role] ?? "";
  return model === "" ? notRecorded : model;
}

function readinessOf(state: RunState): string {
  const mean = meanReadinessScore(state.evaluation.scores);
  return mean === undefined ? notRecorded : mean.toFixed(2);
}

function coverageOf(state: RunState): string {
  if (state.coverage === undefined || state.coverage === null) return notRecorded;
  const { covered, total } = coverageTally(state.coverage);
  return total === 0 ? "none assessed" : `${covered} of ${total} covered`;
}

function blockingOf(state: RunState): string {
  // The same count the validation banner gives: unresolved findings of error severity.
  const blocking = state.findings.filter(
    (finding) => finding.severity === "error" && isUnresolvedFinding(finding),
  );
  return String(blocking.length);
}

function costOf(state: RunState): string {
  return Number.isFinite(state.totalCostUsd) ? `$${state.totalCostUsd.toFixed(3)}` : notRecorded;
}

/** The evidence mode and size the run recorded; retrieval runs record none. */
function evidenceOf(state: RunState): string {
  const mode = state.evidenceMode;
  if (mode === undefined || mode === null) return notRecorded;
  const sources =
    mode.sourceCount === undefined ? "" : ` from ${plural(mode.sourceCount, "source")}`;
  if (mode.effectiveMode === "full-source") {
    return `full source, ${plural(mode.chunkCount, "chunk")}${sources}`;
  }
  if (mode.requestedMode === "full-source") {
    return mode.fallbackReason === "no-eligible-chunks"
      ? "retrieval (no full-source chunks)"
      : `retrieval (full source of ${plural(mode.chunkCount, "chunk")} did not fit)`;
  }
  return `retrieval, ${plural(mode.chunkCount, "chunk")}${sources}`;
}

/** The writing policy in force for the run: its version and checksum, or none. */
function policyOf(state: RunState): { readonly text: string; readonly identity: string | null } {
  if (state.writingPolicy === undefined) return { text: notRecorded, identity: null };
  if (state.writingPolicy === null) return { text: "no policy", identity: "none" };
  const { version, checksum } = state.writingPolicy.effective;
  const override = state.writingPolicy.lineage.kind === "opportunity-override" ? " override" : "";
  return {
    text: `v${version}${override} (${policyChecksumLabel(checksum)})`,
    identity: checksum,
  };
}

function coverageInstructionsOf(state: RunState): string {
  const version = state.coverage?.instructionsVersion;
  return version === undefined || version === null || version === "" ? notRecorded : version;
}

function differenceRow(
  key: InputDifferenceRow["key"],
  label: string,
  noun: string,
  left: { readonly text: string; readonly identity: string | null },
  right: { readonly text: string; readonly identity: string | null },
  labels: { readonly left: string; readonly right: string },
): InputDifferenceRow {
  const base = { key, label, left: left.text, right: right.text };
  if (left.identity === null && right.identity === null) {
    return {
      ...base,
      status: "unknown",
      message: `${label} not recorded for either run, so it cannot be compared`,
    };
  }
  if (left.identity === null || right.identity === null) {
    const missing = left.identity === null ? labels.left : labels.right;
    return {
      ...base,
      status: "unknown",
      message: `${label} not recorded for ${missing}, so it cannot be compared`,
    };
  }
  if (left.identity === right.identity) {
    return { ...base, status: "same", message: `Same ${noun}` };
  }
  return {
    ...base,
    status: "different",
    message: `Different ${noun}: ${left.text} vs ${right.text}`,
  };
}

/** Different coverage instructions make the judged values not directly comparable. */
function coverageInstructionsRow(row: InputDifferenceRow): InputDifferenceRow {
  return row.status === "different"
    ? { ...row, message: `${row.message}; coverage and readiness are ${notDirectlyComparable}` }
    : row;
}

function recorded(text: string): { readonly text: string; readonly identity: string | null } {
  return { text, identity: text === notRecorded ? null : text };
}

/**
 * The comparison table for two runs, left then right, from what each run recorded. The labels
 * name the runs in the wording, e.g. "Run 2".
 */
export function runComparisonFacts(
  left: RunState,
  right: RunState,
  labels: { readonly left: string; readonly right: string } = {
    left: "the left run",
    right: "the right run",
  },
): RunComparisonFacts {
  const leftInstructions = coverageInstructionsOf(left);
  const rightInstructions = coverageInstructionsOf(right);
  const instructionsDiffer =
    leftInstructions !== notRecorded &&
    rightInstructions !== notRecorded &&
    leftInstructions !== rightInstructions;
  const judgedNote = instructionsDiffer
    ? { note: `${notDirectlyComparable}: judged under different coverage instructions` }
    : {};

  const facts: ComparisonFactRow[] = [
    {
      key: "author-model",
      label: "Author model",
      left: modelOf(left, "author"),
      right: modelOf(right, "author"),
    },
    {
      key: "critic-model",
      label: "Critic model",
      left: modelOf(left, "critic"),
      right: modelOf(right, "critic"),
    },
    { key: "rounds", label: "Rounds", left: String(left.round), right: String(right.round) },
    {
      key: "readiness",
      label: "Mean readiness score",
      left: readinessOf(left),
      right: readinessOf(right),
      ...judgedNote,
    },
    {
      key: "coverage",
      label: "Requirements covered (judged)",
      left: coverageOf(left),
      right: coverageOf(right),
      ...judgedNote,
    },
    {
      key: "blocking-findings",
      label: "Blocking findings left",
      left: blockingOf(left),
      right: blockingOf(right),
    },
    { key: "cost", label: "Cost", left: costOf(left), right: costOf(right) },
  ];

  // The run's review state records no brief or profile identity, so these are never guessed
  // from the workspace's current selection.
  const unrecorded = { text: notRecorded, identity: null };
  const inputs: InputDifferenceRow[] = [
    differenceRow(
      "requirements-brief",
      "Requirements brief",
      "requirements brief",
      unrecorded,
      unrecorded,
      labels,
    ),
    differenceRow(
      "career-profile",
      "Career profile version",
      "career profile",
      unrecorded,
      unrecorded,
      labels,
    ),
    differenceRow(
      "evidence",
      "Evidence mode and size",
      "evidence",
      recorded(evidenceOf(left)),
      recorded(evidenceOf(right)),
      labels,
    ),
    differenceRow(
      "writing-policy",
      "Writing policy",
      "writing policy",
      policyOf(left),
      policyOf(right),
      labels,
    ),
    coverageInstructionsRow(
      differenceRow(
        "coverage-instructions",
        "Coverage-judgement instructions",
        "coverage-judgement instructions",
        recorded(leftInstructions),
        recorded(rightInstructions),
        labels,
      ),
    ),
  ];

  return {
    leftLabel: labels.left,
    rightLabel: labels.right,
    facts,
    inputs,
    notDirectlyComparable: instructionsDiffer,
  };
}
