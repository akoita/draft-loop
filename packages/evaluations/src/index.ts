import { hasRequiredArtifactSection } from "@draft-loop/artifacts";
import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import {
  type DraftArtifact,
  type JobRequirement,
  type OutputConstraints,
  type ReadinessRubric,
  readinessDimensions as schemaReadinessDimensions,
} from "@draft-loop/schemas";

export * from "./pilot.js";
export * from "./pilot-comparison-gate.js";
export * from "./readiness-report.js";
export * from "./retrieval.js";
export * from "./stopping-decision.js";

export const readinessDimensions = schemaReadinessDimensions;

export type ReadinessDimension = (typeof readinessDimensions)[number];

export interface ReadinessScore {
  readonly dimension: ReadinessDimension;
  readonly score: number;
  readonly rationale: string;
}

export type ReadinessScoreVector = Readonly<Record<ReadinessDimension, number>>;
export type ReadinessScoreHistoryEntry = Readonly<ReadinessScore[]> | ReadinessScoreVector;
export type ReadinessScoreHistory =
  | readonly ReadinessScoreHistoryEntry[]
  | readonly ReadinessScore[];

export interface ReadinessEvaluationContext {
  readonly requirements: readonly Pick<JobRequirement, "id" | "text" | "priority">[];
  readonly outputConstraints: Pick<
    OutputConstraints,
    "requiredSections" | "maxWords" | "maxCharacters" | "maxLength"
  >;
  readonly readinessRubric: ReadinessRubric;
}

export type ReadinessFindingSeverity = "error" | "warning";

/** A structural copy of validation findings keeps this package provider-free. */
export interface ReadinessFinding {
  readonly code: string;
  readonly severity: ReadinessFindingSeverity;
  readonly message: string;
  readonly category?: "format" | "factuality" | "coverage" | "evidence" | "quality";
  readonly claimId?: string;
  readonly sectionId?: string;
  readonly requirementId?: string;
}

export interface ReadinessEvaluationOptions {
  readonly explicitGapRequirementIds?: readonly string[];
  readonly round?: number;
  readonly priorScoreHistory?: ReadinessScoreHistory;
  readonly findings?: readonly ReadinessFinding[];
  readonly validationResult?: Readonly<{ readonly issues: readonly ReadinessFinding[] }>;
  readonly stableRounds?: number;
  readonly scoreDelta?: number;
  readonly maxRounds?: number;
}

export type ReadinessStopReason =
  | "ready"
  | "stable-convergence"
  | "max-rounds"
  | "blocked-findings"
  | "continue";

export type ReadinessStatus = "ready" | "awaiting-approval" | "continue";

export interface ReadinessThresholdResult {
  readonly dimension: ReadinessDimension;
  readonly score: number;
  readonly threshold: number;
  readonly meets: boolean;
}

export interface ReadinessEvaluation {
  readonly scores: readonly ReadinessScore[];
  readonly scoreVector: ReadinessScoreVector;
  readonly rubric: ReadinessRubric;
  readonly thresholdResults: readonly ReadinessThresholdResult[];
  readonly meetsRubric: boolean;
  readonly findings: readonly ReadinessFinding[];
  readonly ready: boolean;
  readonly stable: boolean;
  readonly round: number;
  readonly stableRounds: number;
  readonly scoreDelta: number;
  readonly maxRounds: number;
  readonly stopReason: ReadinessStopReason;
  readonly shouldStop: boolean;
  readonly status: ReadinessStatus;
  readonly bestAvailable: boolean;
}

const stopWords = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

function normalizeText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

function tokens(value: string): readonly string[] {
  return [...normalizeText(value).matchAll(/[\p{L}\p{N}]+/gu)]
    .map((match) => match[0])
    .filter((token) => token.length > 1 && !stopWords.has(token));
}

function isRequirementCovered(requirement: Pick<JobRequirement, "text">, text: string): boolean {
  const requirementTokens = [...new Set(tokens(requirement.text))];
  if (requirementTokens.length === 0) {
    return false;
  }
  const artifactTokens = new Set(tokens(text));
  const matches = requirementTokens.filter((token) => artifactTokens.has(token)).length;
  return matches > 0 && matches / requirementTokens.length >= 0.5;
}

function artifactText(artifact: DraftArtifact): string {
  return artifact.sections
    .flatMap((section) => section.blocks.map((block) => block.text))
    .join("\n");
}

function wordCount(value: string): number {
  const trimmed = value.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/u).length;
}

function clampScore(value: number): number {
  return Math.min(1, Math.max(0, Number(value.toFixed(6))));
}

function weightedCoverage(
  artifact: DraftArtifact,
  requirements: ReadinessEvaluationContext["requirements"],
  explicitGapIds: ReadonlySet<string>,
): { readonly score: number; readonly covered: number; readonly total: number } {
  const text = artifactText(artifact);
  let coveredWeight = 0;
  let totalWeight = 0;
  let covered = 0;
  for (const requirement of requirements) {
    const weight =
      requirement.priority === "critical" ? 2 : requirement.priority === "high" ? 1.5 : 1;
    totalWeight += weight;
    if (!explicitGapIds.has(requirement.id) && isRequirementCovered(requirement, text)) {
      coveredWeight += weight;
      covered += 1;
    }
  }
  return {
    score: totalWeight === 0 ? 0 : clampScore(coveredWeight / totalWeight),
    covered,
    total: requirements.length,
  };
}

function backedClaimRatio(artifact: DraftArtifact): number {
  const substantiveClaims = artifact.claims.filter((claim) => claim.substantive);
  if (substantiveClaims.length === 0) {
    return 0;
  }
  return clampScore(
    substantiveClaims.filter((claim) => claim.evidence.length > 0).length /
      substantiveClaims.length,
  );
}

function duplicateRatio(artifact: DraftArtifact): number {
  const uniqueRatio = (values: readonly string[]): number =>
    values.length === 0 ? 1 : new Set(values).size / values.length;
  const blockValues = artifact.sections.flatMap((section) =>
    section.blocks.map((block) => normalizeText(block.text)),
  );
  const claimValues = artifact.claims.map((claim) => normalizeText(claim.text));
  if (blockValues.length === 0 && claimValues.length === 0) {
    return 0;
  }
  return clampScore((uniqueRatio(blockValues) + uniqueRatio(claimValues)) / 2);
}

function formatScore(
  artifact: DraftArtifact,
  constraints: ReadinessEvaluationContext["outputConstraints"],
): { readonly score: number; readonly passed: number; readonly checks: number } {
  const text = artifactText(artifact);
  const checks: boolean[] = [];
  if ((constraints.requiredSections ?? []).length > 0) {
    checks.push(
      (constraints.requiredSections ?? []).every((title) =>
        hasRequiredArtifactSection(artifact, title),
      ),
    );
  }
  if (constraints.maxWords !== undefined) {
    checks.push(wordCount(text) <= constraints.maxWords);
  }
  if (constraints.maxCharacters !== undefined) {
    checks.push(text.length <= constraints.maxCharacters);
  }
  if (constraints.maxLength !== undefined) {
    checks.push(text.length <= constraints.maxLength);
  }
  if (checks.length === 0) {
    return { score: 1, passed: 0, checks: 0 };
  }
  const passed = checks.filter(Boolean).length;
  return { score: clampScore(passed / checks.length), passed, checks: checks.length };
}

function hasError(
  findings: readonly ReadinessFinding[],
  categories: readonly ReadinessFinding["category"][] = [],
): boolean {
  return findings.some(
    (finding) =>
      finding.severity === "error" &&
      (categories.length === 0 || categories.includes(finding.category)),
  );
}

function findingCount(
  findings: readonly ReadinessFinding[],
  code: string,
  severity?: ReadinessFindingSeverity,
): number {
  return findings.filter(
    (finding) => finding.code === code && (severity === undefined || finding.severity === severity),
  ).length;
}

function rationaleCount(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

function normalizeHistoryEntry(entry: ReadinessScoreHistoryEntry): ReadinessScoreVector {
  if (isScoreList(entry)) {
    const vector = {} as Record<ReadinessDimension, number>;
    for (const dimension of readinessDimensions) {
      vector[dimension] = entry.find((score) => score.dimension === dimension)?.score ?? 0;
    }
    return vector;
  }
  const vector = {} as Record<ReadinessDimension, number>;
  for (const dimension of readinessDimensions) {
    vector[dimension] = entry[dimension] ?? 0;
  }
  return vector;
}

function isScoreList(entry: ReadinessScoreHistoryEntry): entry is readonly ReadinessScore[] {
  return Array.isArray(entry);
}

function isReadinessScore(value: unknown): value is ReadinessScore {
  return typeof value === "object" && value !== null && "dimension" in value && "score" in value;
}

function normalizeScoreHistory(
  history: ReadinessScoreHistory | undefined,
): readonly ReadinessScoreHistoryEntry[] {
  if (history === undefined || history.length === 0) {
    return [];
  }
  const first = history[0];
  return isReadinessScore(first)
    ? [history as readonly ReadinessScore[]]
    : (history as readonly ReadinessScoreHistoryEntry[]);
}

function stableScoreVectors(
  history: ReadonlyArray<ReadinessScoreHistoryEntry>,
  current: ReadinessScoreVector,
  stableRounds: number,
  scoreDelta: number,
): boolean {
  const vectors = [...history.map(normalizeHistoryEntry), current];
  if (vectors.length < stableRounds) {
    return false;
  }
  const recent = vectors.slice(-stableRounds);
  return readinessDimensions.every((dimension) => {
    const values = recent.map((vector) => vector[dimension]);
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    return maximum - minimum <= scoreDelta;
  });
}

function validateStopConfiguration(
  options: ReadinessEvaluationOptions,
): Required<Pick<ReadinessEvaluationOptions, "stableRounds" | "scoreDelta" | "maxRounds">> {
  const stableRounds = options.stableRounds ?? 2;
  const scoreDelta = options.scoreDelta ?? 0.05;
  const maxRounds = options.maxRounds ?? 3;
  if (!Number.isInteger(stableRounds) || stableRounds < 1) {
    throw new RangeError("stableRounds must be a positive integer");
  }
  if (!Number.isFinite(scoreDelta) || scoreDelta < 0) {
    throw new RangeError("scoreDelta must be a finite non-negative number");
  }
  if (!Number.isInteger(maxRounds) || maxRounds < 1) {
    throw new RangeError("maxRounds must be a positive integer");
  }
  return { stableRounds, scoreDelta, maxRounds };
}

function resolveOptions(
  optionsOrGapIds: ReadinessEvaluationOptions | readonly string[] | undefined,
  round: number | undefined,
  priorScoreHistory: ReadinessScoreHistory | undefined,
): ReadinessEvaluationOptions {
  if (Array.isArray(optionsOrGapIds)) {
    return {
      explicitGapRequirementIds: optionsOrGapIds,
      ...(round === undefined ? {} : { round }),
      ...(priorScoreHistory === undefined ? {} : { priorScoreHistory }),
    };
  }
  return (optionsOrGapIds as ReadinessEvaluationOptions | undefined) ?? {};
}

export function evaluateReadiness(
  artifact: DraftArtifact,
  context: ReadinessEvaluationContext,
  options?: ReadinessEvaluationOptions,
): ReadinessEvaluation;
export function evaluateReadiness(
  artifact: DraftArtifact,
  context: ReadinessEvaluationContext,
  explicitGapRequirementIds?: readonly string[],
  round?: number,
  priorScoreHistory?: ReadinessScoreHistory,
): ReadinessEvaluation;
export function evaluateReadiness(
  artifact: DraftArtifact,
  context: ReadinessEvaluationContext,
  optionsOrGapIds: ReadinessEvaluationOptions | readonly string[] = {},
  round?: number,
  priorScoreHistory?: ReadinessScoreHistory,
): ReadinessEvaluation {
  const options = resolveOptions(optionsOrGapIds, round, priorScoreHistory);
  const stopConfiguration = validateStopConfiguration(options);
  const explicitGapIds = new Set(options.explicitGapRequirementIds ?? []);
  const findings = Object.freeze(
    (options.findings ?? options.validationResult?.issues ?? []).map((finding) =>
      Object.freeze({ ...finding }),
    ),
  ) as readonly ReadinessFinding[];
  const coverage = weightedCoverage(artifact, context.requirements, explicitGapIds);
  const evidence = backedClaimRatio(artifact);
  const duplicate = duplicateRatio(artifact);
  const format = formatScore(artifact, context.outputConstraints);
  const factualityErrors =
    findingCount(findings, "unsupported-quantification", "error") +
    findingCount(findings, "inconsistent-date", "error");
  const unsupportedClaims = findingCount(findings, "unsupported-claim", "error");
  const disputedClaims = artifact.claims.filter((claim) => claim.status === "disputed").length;
  const substantiveClaims = artifact.claims.filter((claim) => claim.substantive).length;
  const clarity = artifact.sections.every((section) =>
    section.blocks.every((block) => wordCount(block.text) <= 45),
  )
    ? 1
    : 0.8;
  const scores: readonly ReadinessScore[] = [
    {
      dimension: "relevance",
      score: coverage.score,
      rationale: `${coverage.covered} of ${coverage.total} requirements matched by deterministic tokens`,
    },
    {
      dimension: "evidence",
      score: evidence,
      rationale: `${Math.round(evidence * substantiveClaims)} of ${substantiveClaims} substantive claims have evidence`,
    },
    {
      dimension: "accuracy",
      score: clampScore(
        (substantiveClaims === 0 ? 0 : 1) -
          Math.min(1, factualityErrors * 0.35 + disputedClaims * 0.25),
      ),
      rationale:
        factualityErrors === 0
          ? "no deterministic factuality conflicts"
          : rationaleCount(factualityErrors, "deterministic factuality conflict"),
    },
    {
      dimension: "differentiation",
      score: duplicate,
      rationale: `${Math.round(duplicate * (artifact.sections.length + artifact.claims.length))} of ${artifact.sections.length + artifact.claims.length} content entries are unique`,
    },
    {
      dimension: "clarity",
      score: clarity,
      rationale:
        clarity === 1
          ? "all blocks are concise under the deterministic limit"
          : "some blocks exceed the concise-word heuristic",
    },
    {
      dimension: "format",
      score: format.score,
      rationale:
        format.checks === 0
          ? "no format constraints are configured"
          : `${format.passed} of ${format.checks} deterministic format checks pass`,
    },
    {
      dimension: "credibility",
      score: clampScore(
        Math.min(evidence, substantiveClaims === 0 ? 0 : 1) -
          Math.min(1, unsupportedClaims * 0.35 + factualityErrors * 0.35),
      ),
      rationale:
        unsupportedClaims + factualityErrors === 0
          ? "substantive claims are supported without deterministic metric or date conflicts"
          : "deterministic support or factuality findings reduce credibility",
    },
  ];
  const frozenScores = Object.freeze(
    scores.map((score) => Object.freeze({ ...score })),
  ) as readonly ReadinessScore[];

  const scoreVector = Object.freeze(
    Object.fromEntries(frozenScores.map((score) => [score.dimension, score.score])) as Record<
      ReadinessDimension,
      number
    >,
  );
  const thresholdResults = Object.freeze(
    readinessDimensions.map((dimension) =>
      Object.freeze({
        dimension,
        score: scoreVector[dimension],
        threshold: context.readinessRubric[dimension],
        meets: scoreVector[dimension] >= context.readinessRubric[dimension],
      }),
    ),
  );
  const meetsRubric = thresholdResults.every((result) => result.meets);
  const ready = !hasError(findings) && meetsRubric;
  const history = normalizeScoreHistory(options.priorScoreHistory);
  const stable = stableScoreVectors(
    history,
    scoreVector,
    stopConfiguration.stableRounds,
    stopConfiguration.scoreDelta,
  );
  const currentRound = options.round ?? history.length + 1;
  const stopReason: ReadinessStopReason = ready
    ? "ready"
    : hasError(findings)
      ? "blocked-findings"
      : stable
        ? "stable-convergence"
        : currentRound >= stopConfiguration.maxRounds
          ? "max-rounds"
          : "continue";
  const shouldStop = stopReason !== "continue";
  const status: ReadinessStatus = ready ? "ready" : shouldStop ? "awaiting-approval" : "continue";

  return Object.freeze({
    scores: frozenScores,
    scoreVector,
    rubric: Object.freeze({ ...context.readinessRubric }),
    thresholdResults,
    meetsRubric,
    findings,
    ready,
    stable,
    round: currentRound,
    stableRounds: stopConfiguration.stableRounds,
    scoreDelta: stopConfiguration.scoreDelta,
    maxRounds: stopConfiguration.maxRounds,
    stopReason,
    shouldStop,
    status,
    bestAvailable: shouldStop && !ready,
  });
}

export const evaluateDraftReadiness = evaluateReadiness;
export const evaluateDraftArtifact = evaluateReadiness;

export type EvaluationVariant = "first-draft" | "revised-draft" | "manual-baseline";

export interface EvaluationUserEffort {
  readonly reviewMinutes?: number;
  readonly editCount?: number;
  readonly approvalCount?: number;
}

export interface EvaluationCase {
  readonly id: string;
  readonly context: ReadinessEvaluationContext;
  readonly firstDraft: DraftArtifact;
  readonly revisedDraft: DraftArtifact;
  readonly manualBaseline: DraftArtifact;
  readonly userEffort?: Readonly<Partial<Record<EvaluationVariant, EvaluationUserEffort>>>;
}

export interface EvaluationVariantResult {
  readonly variant: EvaluationVariant;
  readonly evaluation: ReadinessEvaluation;
  readonly userEffort?: EvaluationUserEffort;
}

export interface EvaluationDelta {
  readonly baseline: EvaluationVariant;
  readonly candidate: "revised-draft";
  readonly dimensionDelta: Readonly<Record<ReadinessDimension, number>>;
  readonly readinessDelta: number;
  readonly reviewMinutesDelta?: number;
  readonly editCountDelta?: number;
  readonly approvalCountDelta?: number;
}

export interface EvaluationHarnessOptions {
  readonly readinessOptions?: Omit<ReadinessEvaluationOptions, "round" | "priorScoreHistory">;
  readonly maxDimensionDrop?: number;
  readonly maxReadinessDrop?: number;
}

export interface EvaluationComparison {
  readonly caseId: string;
  readonly results: readonly EvaluationVariantResult[];
  readonly deltas: readonly EvaluationDelta[];
  readonly qualityRegression: boolean;
  readonly regressions: readonly string[];
}

export class EvaluationRegressionError extends Error {
  readonly comparison: EvaluationComparison;

  constructor(comparison: EvaluationComparison) {
    super(
      `Evaluation quality regression in case ${comparison.caseId}: ${comparison.regressions.join(", ")}`,
    );
    this.name = "EvaluationRegressionError";
    this.comparison = comparison;
  }
}

const evaluationVariants: readonly EvaluationVariant[] = [
  "first-draft",
  "revised-draft",
  "manual-baseline",
];

function validateRegressionLimit(value: number | undefined, name: string): number {
  const resolved = value ?? 0;
  if (!Number.isFinite(resolved) || resolved < 0) {
    throw new RangeError(`${name} must be a finite non-negative number`);
  }
  return resolved;
}

function effortDelta(
  baseline: EvaluationUserEffort | undefined,
  candidate: EvaluationUserEffort | undefined,
  key: keyof EvaluationUserEffort,
): number | undefined {
  const baselineValue = baseline?.[key];
  const candidateValue = candidate?.[key];
  if (baselineValue === undefined || candidateValue === undefined) {
    return undefined;
  }
  return candidateValue - baselineValue;
}

function evaluationDelta(
  baseline: EvaluationVariantResult,
  candidate: EvaluationVariantResult,
): EvaluationDelta {
  const dimensionDelta = Object.fromEntries(
    readinessDimensions.map((dimension) => [
      dimension,
      Number(
        (
          candidate.evaluation.scoreVector[dimension] - baseline.evaluation.scoreVector[dimension]
        ).toFixed(6),
      ),
    ]),
  ) as Record<ReadinessDimension, number>;
  const reviewMinutesDelta = effortDelta(
    baseline.userEffort,
    candidate.userEffort,
    "reviewMinutes",
  );
  const editCountDelta = effortDelta(baseline.userEffort, candidate.userEffort, "editCount");
  const approvalCountDelta = effortDelta(
    baseline.userEffort,
    candidate.userEffort,
    "approvalCount",
  );
  return Object.freeze({
    baseline: baseline.variant,
    candidate: "revised-draft" as const,
    dimensionDelta: Object.freeze(dimensionDelta),
    readinessDelta: Number(candidate.evaluation.ready) - Number(baseline.evaluation.ready),
    ...(reviewMinutesDelta === undefined ? {} : { reviewMinutesDelta }),
    ...(editCountDelta === undefined ? {} : { editCountDelta }),
    ...(approvalCountDelta === undefined ? {} : { approvalCountDelta }),
  });
}

function regressionReasons(
  first: EvaluationVariantResult,
  revised: EvaluationVariantResult,
  maxDimensionDrop: number,
  maxReadinessDrop: number,
): readonly string[] {
  const reasons: string[] = [];
  for (const dimension of readinessDimensions) {
    const delta =
      revised.evaluation.scoreVector[dimension] - first.evaluation.scoreVector[dimension];
    if (delta < -maxDimensionDrop) {
      reasons.push(`${dimension} dropped by ${Math.abs(delta).toFixed(6)}`);
    }
  }
  const readinessDelta = Number(revised.evaluation.ready) - Number(first.evaluation.ready);
  if (readinessDelta < -maxReadinessDrop) {
    reasons.push("readiness regressed");
  }
  if (first.evaluation.meetsRubric && !revised.evaluation.meetsRubric) {
    reasons.push("revised draft no longer meets the readiness rubric");
  }
  return reasons;
}

/**
 * Evaluates the generated variants with the same deterministic rubric. The
 * manual baseline is a comparison reference; first-to-revised is the CI gate.
 */
export function compareEvaluationCase(
  evaluationCase: EvaluationCase,
  options: EvaluationHarnessOptions = {},
): EvaluationComparison {
  const maxDimensionDrop = validateRegressionLimit(options.maxDimensionDrop, "maxDimensionDrop");
  const maxReadinessDrop = validateRegressionLimit(options.maxReadinessDrop, "maxReadinessDrop");
  const drafts: Readonly<Record<EvaluationVariant, DraftArtifact>> = {
    "first-draft": evaluationCase.firstDraft,
    "revised-draft": evaluationCase.revisedDraft,
    "manual-baseline": evaluationCase.manualBaseline,
  };
  const results = evaluationVariants.map((variant, index) => {
    const readinessOptions = options.readinessOptions ?? {};
    return Object.freeze({
      variant,
      evaluation: evaluateReadiness(drafts[variant], evaluationCase.context, {
        ...readinessOptions,
        round: index === 1 ? 2 : 1,
      }),
      ...(evaluationCase.userEffort?.[variant] === undefined
        ? {}
        : { userEffort: Object.freeze({ ...evaluationCase.userEffort[variant] }) }),
    });
  }) as readonly EvaluationVariantResult[];
  const revised = results[1];
  const first = results[0];
  const manual = results[2];
  if (first === undefined || revised === undefined || manual === undefined) {
    throw new Error("Evaluation variants are incomplete");
  }
  const regressions = regressionReasons(first, revised, maxDimensionDrop, maxReadinessDrop);
  return Object.freeze({
    caseId: evaluationCase.id,
    results: Object.freeze(results),
    deltas: Object.freeze([evaluationDelta(first, revised), evaluationDelta(manual, revised)]),
    qualityRegression: regressions.length > 0,
    regressions: Object.freeze(regressions),
  });
}

export function assertNoQualityRegression(comparison: EvaluationComparison): void {
  if (comparison.qualityRegression) {
    throw new EvaluationRegressionError(comparison);
  }
}

export type RetrievalMode = "lexical" | "vector" | "hybrid";

export interface RetrievalBenchmarkCase {
  readonly id: string;
  readonly query: string;
  readonly corpus: readonly ScoredEvidenceChunk[];
  readonly groundTruthEvidenceIds: readonly string[];
  readonly requirements?: readonly { readonly id: string; readonly text: string }[];
  readonly draftClaims?: readonly {
    readonly id: string;
    readonly text: string;
    readonly evidenceIds: readonly string[];
  }[];
}

export interface RetrievalEvaluationMetrics {
  readonly citationAccuracy: number;
  readonly requirementCoverage: number;
  readonly irrelevantContextRatio: number;
  readonly unsupportedClaimCount: number;
  readonly meanReciprocalRank: number;
}

export interface RetrievalBenchmarkReport {
  readonly baselineMode: RetrievalMode;
  readonly candidateMode: RetrievalMode;
  readonly caseCount: number;
  readonly baselineMetrics: RetrievalEvaluationMetrics;
  readonly candidateMetrics: RetrievalEvaluationMetrics;
  readonly deltas: {
    readonly citationAccuracyDelta: number;
    readonly requirementCoverageDelta: number;
    readonly irrelevantContextRatioDelta: number;
    readonly unsupportedClaimDelta: number;
    readonly meanReciprocalRankDelta: number;
  };
  readonly passed: boolean;
  readonly regressionReasons: readonly string[];
}

export class RetrievalRegressionError extends Error {
  readonly report: RetrievalBenchmarkReport;

  constructor(report: RetrievalBenchmarkReport) {
    super(
      `Retrieval benchmark regression detected (${report.candidateMode} vs ${report.baselineMode}): ${report.regressionReasons.join(", ")}`,
    );
    this.name = "RetrievalRegressionError";
    this.report = report;
  }
}

export function evaluateRetrievalMetrics(
  retrieved: readonly ScoredEvidenceChunk[],
  benchmarkCase: RetrievalBenchmarkCase,
): RetrievalEvaluationMetrics {
  const groundTruthSet = new Set(benchmarkCase.groundTruthEvidenceIds);
  const relevantRetrieved = retrieved.filter((chunk) => groundTruthSet.has(chunk.id));

  const citationAccuracy = retrieved.length === 0 ? 0 : relevantRetrieved.length / retrieved.length;

  const irrelevantContextRatio =
    retrieved.length === 0 ? 0 : (retrieved.length - relevantRetrieved.length) / retrieved.length;

  const firstRelevantIndex = retrieved.findIndex((chunk) => groundTruthSet.has(chunk.id));
  const meanReciprocalRank = firstRelevantIndex >= 0 ? 1 / (firstRelevantIndex + 1) : 0;

  const requirements = benchmarkCase.requirements ?? [];
  let coveredRequirements = 0;
  for (const req of requirements) {
    const reqTokens = tokens(req.text);
    const hasMatch = retrieved.some((chunk) => {
      const chunkTokens = new Set(tokens(chunk.text));
      return reqTokens.some((token) => chunkTokens.has(token));
    });
    if (hasMatch) {
      coveredRequirements++;
    }
  }
  const requirementCoverage =
    requirements.length === 0 ? 1 : coveredRequirements / requirements.length;

  const retrievedIdSet = new Set(retrieved.map((c) => c.id));
  const draftClaims = benchmarkCase.draftClaims ?? [];
  let unsupportedClaimCount = 0;
  for (const claim of draftClaims) {
    const hasEvidence = claim.evidenceIds.some((id) => retrievedIdSet.has(id));
    if (!hasEvidence) {
      unsupportedClaimCount++;
    }
  }

  return {
    citationAccuracy,
    requirementCoverage,
    irrelevantContextRatio,
    unsupportedClaimCount,
    meanReciprocalRank,
  };
}

export interface BenchmarkRetrievalOptions {
  readonly maxCitationAccuracyDrop?: number;
  readonly maxCoverageDrop?: number;
  readonly maxUnsupportedClaimIncrease?: number;
}

export async function benchmarkRetrieval(
  cases: readonly RetrievalBenchmarkCase[],
  baseline: {
    readonly mode: RetrievalMode;
    readonly queryEvidence: (
      query: string,
      options?: { readonly limit?: number },
    ) => Promise<readonly ScoredEvidenceChunk[]>;
  },
  candidate: {
    readonly mode: RetrievalMode;
    readonly queryEvidence: (
      query: string,
      options?: { readonly limit?: number },
    ) => Promise<readonly ScoredEvidenceChunk[]>;
  },
  options: BenchmarkRetrievalOptions = {},
): Promise<RetrievalBenchmarkReport> {
  const maxCitationAccuracyDrop = options.maxCitationAccuracyDrop ?? 0.05;
  const maxCoverageDrop = options.maxCoverageDrop ?? 0.05;
  const maxUnsupportedClaimIncrease = options.maxUnsupportedClaimIncrease ?? 0;

  let totalBaselineAcc = 0;
  let totalCandidateAcc = 0;
  let totalBaselineCov = 0;
  let totalCandidateCov = 0;
  let totalBaselineIrr = 0;
  let totalCandidateIrr = 0;
  let totalBaselineUnsup = 0;
  let totalCandidateUnsup = 0;
  let totalBaselineMrr = 0;
  let totalCandidateMrr = 0;

  for (const benchmarkCase of cases) {
    const [baselineResults, candidateResults] = await Promise.all([
      baseline.queryEvidence(benchmarkCase.query),
      candidate.queryEvidence(benchmarkCase.query),
    ]);
    const bMetrics = evaluateRetrievalMetrics(baselineResults, benchmarkCase);
    const cMetrics = evaluateRetrievalMetrics(candidateResults, benchmarkCase);

    totalBaselineAcc += bMetrics.citationAccuracy;
    totalCandidateAcc += cMetrics.citationAccuracy;
    totalBaselineCov += bMetrics.requirementCoverage;
    totalCandidateCov += cMetrics.requirementCoverage;
    totalBaselineIrr += bMetrics.irrelevantContextRatio;
    totalCandidateIrr += cMetrics.irrelevantContextRatio;
    totalBaselineUnsup += bMetrics.unsupportedClaimCount;
    totalCandidateUnsup += cMetrics.unsupportedClaimCount;
    totalBaselineMrr += bMetrics.meanReciprocalRank;
    totalCandidateMrr += cMetrics.meanReciprocalRank;
  }

  const n = Math.max(1, cases.length);
  const baselineMetrics: RetrievalEvaluationMetrics = {
    citationAccuracy: totalBaselineAcc / n,
    requirementCoverage: totalBaselineCov / n,
    irrelevantContextRatio: totalBaselineIrr / n,
    unsupportedClaimCount: totalBaselineUnsup / n,
    meanReciprocalRank: totalBaselineMrr / n,
  };
  const candidateMetrics: RetrievalEvaluationMetrics = {
    citationAccuracy: totalCandidateAcc / n,
    requirementCoverage: totalCandidateCov / n,
    irrelevantContextRatio: totalCandidateIrr / n,
    unsupportedClaimCount: totalCandidateUnsup / n,
    meanReciprocalRank: totalCandidateMrr / n,
  };

  const citationAccuracyDelta =
    candidateMetrics.citationAccuracy - baselineMetrics.citationAccuracy;
  const requirementCoverageDelta =
    candidateMetrics.requirementCoverage - baselineMetrics.requirementCoverage;
  const irrelevantContextRatioDelta =
    candidateMetrics.irrelevantContextRatio - baselineMetrics.irrelevantContextRatio;
  const unsupportedClaimDelta =
    candidateMetrics.unsupportedClaimCount - baselineMetrics.unsupportedClaimCount;
  const meanReciprocalRankDelta =
    candidateMetrics.meanReciprocalRank - baselineMetrics.meanReciprocalRank;

  const regressionReasons: string[] = [];
  if (citationAccuracyDelta < -maxCitationAccuracyDrop) {
    regressionReasons.push(
      `Citation accuracy dropped by ${Math.abs(citationAccuracyDelta).toFixed(4)}`,
    );
  }
  if (requirementCoverageDelta < -maxCoverageDrop) {
    regressionReasons.push(
      `Requirement coverage dropped by ${Math.abs(requirementCoverageDelta).toFixed(4)}`,
    );
  }
  if (unsupportedClaimDelta > maxUnsupportedClaimIncrease) {
    regressionReasons.push(`Unsupported claims increased by ${unsupportedClaimDelta.toFixed(2)}`);
  }

  return {
    baselineMode: baseline.mode,
    candidateMode: candidate.mode,
    caseCount: cases.length,
    baselineMetrics,
    candidateMetrics,
    deltas: {
      citationAccuracyDelta,
      requirementCoverageDelta,
      irrelevantContextRatioDelta,
      unsupportedClaimDelta,
      meanReciprocalRankDelta,
    },
    passed: regressionReasons.length === 0,
    regressionReasons,
  };
}

export function assertNoRetrievalRegression(report: RetrievalBenchmarkReport): void {
  if (!report.passed) {
    throw new RetrievalRegressionError(report);
  }
}
