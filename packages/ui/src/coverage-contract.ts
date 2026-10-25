/**
 * Bridge contract for the requirement coverage shown in the review panel.
 *
 * The host projects the latest same-round critic judgement from the run snapshot with the same
 * application helper the CLI uses. Ids, enumerated statuses, counts, the critic's user-visible
 * rationale, and the text of each job requirement as the run recorded it cross the bridge; no
 * block text or filesystem path does. The renderer resolves section titles from the artifact
 * it already holds.
 *
 * The runtime key lists below are bound to the interfaces, so adding a field to one without the
 * other is a compile error rather than a validator that silently rejects real payloads.
 */

export const coverageStatuses = [
  "covered",
  "needs-judgement",
  "uncovered",
  "explicit-gap",
] as const;
export type CoverageStatus = (typeof coverageStatuses)[number];

export const coverageBases = [
  "lexical",
  "protected-rule",
  "semantic-candidate",
  "judgement",
] as const;
export type CoverageBasis = (typeof coverageBases)[number];

export interface CoverageEvidenceView {
  /** A block of the draft the assessment cites. */
  readonly blockId: string;
}

export interface CoverageAssessmentView {
  readonly requirementId: string;
  /** The job requirement as the run recorded it; absent when the run's context has no text. */
  readonly requirementText?: string;
  readonly status: CoverageStatus;
  readonly basis: CoverageBasis;
  readonly evidence: readonly CoverageEvidenceView[];
  readonly rationale: string;
}

/** Content-free counts of the critic's coverage verdicts. */
export interface CoverageSummaryView {
  readonly judged: number;
  readonly satisfied: number;
  readonly notSatisfied: number;
  readonly invalid: number;
  readonly unanswered: number;
}

export interface ReviewCoverageView {
  readonly instructionsVersion: string | null;
  readonly summary: CoverageSummaryView;
  readonly assessments: readonly CoverageAssessmentView[];
}

function exactKeys<Shape extends object>() {
  return <const Keys extends readonly (keyof Shape & string)[]>(
    keys: Keys & {
      readonly [Key in Exclude<keyof Shape, Keys[number]>]: "add this key to the runtime key list";
    },
  ): Keys => keys;
}

const coverageKeys = exactKeys<ReviewCoverageView>()([
  "instructionsVersion",
  "summary",
  "assessments",
]);
const summaryKeys = exactKeys<CoverageSummaryView>()([
  "judged",
  "satisfied",
  "notSatisfied",
  "invalid",
  "unanswered",
]);
const assessmentKeys = exactKeys<CoverageAssessmentView>()([
  "requirementId",
  "requirementText",
  "status",
  "basis",
  "evidence",
  "rationale",
]);
const evidenceKeys = exactKeys<CoverageEvidenceView>()(["blockId"]);

export const maximumCoverageAssessments = 512;
export const maximumCoverageEvidencePerAssessment = 64;
const maximumIdentifierLength = 256;
const maximumRationaleLength = 1_000;
/** Longer requirement text is cut by the host before it crosses the bridge. */
export const maximumCoverageRequirementTextLength = 2_000;
const maximumCount = 1_000_000;

/** The CLI's wording for how an assessment was reached. */
export const coverageBasisLabels: Readonly<Record<CoverageBasis, string>> = Object.freeze({
  lexical: "matching wording",
  "protected-rule": "strict rule",
  "semantic-candidate": "semantic candidate (needs judgement)",
  judgement: "critic judgement",
});

/** Words, not colour, carry the status. */
export const coverageStatusLabels: Readonly<Record<CoverageStatus, string>> = Object.freeze({
  covered: "Covered",
  "needs-judgement": "Needs judgement",
  uncovered: "Uncovered",
  "explicit-gap": "Explicit gap",
});

type Raw = Readonly<Record<string, unknown>>;

function record(value: unknown): Raw | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Raw)
    : undefined;
}

function onlyKeys(value: Raw, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function plainText(
  value: unknown,
  maxLength: number,
  allowLineBreaks: boolean,
): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    return undefined;
  }
  const clean = [...value].every(
    (character) =>
      character !== "\u007f" &&
      (character >= " " || (allowLineBreaks && (character === "\n" || character === "\t"))),
  );
  return clean ? value : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximumCount
    ? value
    : undefined;
}

function oneOf<Value extends string>(value: unknown, values: readonly Value[]): Value | undefined {
  return typeof value === "string" ? values.find((candidate) => candidate === value) : undefined;
}

function normalizeSummary(value: unknown): CoverageSummaryView | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, summaryKeys)) return undefined;
  const judged = count(raw.judged);
  const satisfied = count(raw.satisfied);
  const notSatisfied = count(raw.notSatisfied);
  const invalid = count(raw.invalid);
  const unanswered = count(raw.unanswered);
  if (
    judged === undefined ||
    satisfied === undefined ||
    notSatisfied === undefined ||
    invalid === undefined ||
    unanswered === undefined
  ) {
    return undefined;
  }
  return { judged, satisfied, notSatisfied, invalid, unanswered };
}

function normalizeAssessment(value: unknown): CoverageAssessmentView | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, assessmentKeys)) return undefined;
  const requirementId = plainText(raw.requirementId, maximumIdentifierLength, false);
  const requirementText =
    raw.requirementText === undefined
      ? undefined
      : plainText(raw.requirementText, maximumCoverageRequirementTextLength, true);
  const status = oneOf(raw.status, coverageStatuses);
  const basis = oneOf(raw.basis, coverageBases);
  const rationale = plainText(raw.rationale, maximumRationaleLength, true);
  if (
    requirementId === undefined ||
    status === undefined ||
    basis === undefined ||
    rationale === undefined ||
    (raw.requirementText !== undefined && requirementText === undefined) ||
    !Array.isArray(raw.evidence) ||
    raw.evidence.length > maximumCoverageEvidencePerAssessment
  ) {
    return undefined;
  }
  const evidence: CoverageEvidenceView[] = [];
  for (const item of raw.evidence as readonly unknown[]) {
    const entry = record(item);
    if (entry === undefined || !onlyKeys(entry, evidenceKeys)) return undefined;
    const blockId = plainText(entry.blockId, maximumIdentifierLength, false);
    if (blockId === undefined) return undefined;
    evidence.push({ blockId });
  }
  return {
    requirementId,
    ...(requirementText === undefined ? {} : { requirementText }),
    status,
    basis,
    evidence,
    rationale,
  };
}

/**
 * Validate coverage received from the host. Returns `undefined` when the value is malformed so
 * the bridge can reject the whole review state with its own validation error.
 */
export function normalizeReviewCoverage(value: unknown): ReviewCoverageView | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, coverageKeys)) return undefined;
  const instructionsVersion =
    raw.instructionsVersion === null ? null : plainText(raw.instructionsVersion, 128, false);
  const summary = normalizeSummary(raw.summary);
  if (
    instructionsVersion === undefined ||
    summary === undefined ||
    !Array.isArray(raw.assessments) ||
    raw.assessments.length > maximumCoverageAssessments
  ) {
    return undefined;
  }
  const assessments: CoverageAssessmentView[] = [];
  for (const item of raw.assessments as readonly unknown[]) {
    const assessment = normalizeAssessment(item);
    if (assessment === undefined) return undefined;
    assessments.push(assessment);
  }
  return { instructionsVersion, summary, assessments };
}
