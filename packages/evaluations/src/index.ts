import {
  type DraftArtifact,
  type JobRequirement,
  type OutputConstraints,
  type ReadinessRubric,
  readinessDimensions as schemaReadinessDimensions,
} from "@draft-loop/schemas";

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

function normalizeSectionTitle(value: string): string {
  return normalizeText(value).replace(/\s/gu, "");
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
    const sectionTitles = new Set(
      artifact.sections.map((section) => normalizeSectionTitle(section.title)),
    );
    checks.push(
      (constraints.requiredSections ?? []).every((title) =>
        sectionTitles.has(normalizeSectionTitle(title)),
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
