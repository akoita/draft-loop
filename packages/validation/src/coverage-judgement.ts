import type {
  RequirementCoverageAssessment,
  RequirementCoverageEvidence,
} from "./requirement-coverage-assessment.js";

export const maximumCoverageJudgementRequests = 8;
export const maximumCoverageJudgementRationaleCharacters = 240;

export const coverageJudgementVerdicts = ["satisfied", "not-satisfied"] as const;

export type CoverageJudgementVerdict = (typeof coverageJudgementVerdicts)[number];

/** Asks a critic to judge one requirement against its candidate CV blocks. */
export interface CoverageJudgementRequest {
  readonly requirementId: string;
  readonly candidateBlockIds: readonly string[];
}

/** A critic's concise, user-visible verdict for one requested requirement. */
export interface CoverageJudgement {
  readonly requirementId: string;
  readonly verdict: CoverageJudgementVerdict;
  readonly citedBlockIds: readonly string[];
  readonly rationale: string;
}

/** Content-free counts; they never quote requirement, block, or rationale text. */
export interface CoverageJudgementSummary {
  /** Requirements resolved by a valid judgement (`satisfied + notSatisfied`). */
  readonly judged: number;
  readonly satisfied: number;
  readonly notSatisfied: number;
  /**
   * Distinct requirement ids whose judgement was rejected: failed validation,
   * duplicated, or addressed a requirement that was not asked for.
   */
  readonly invalid: number;
  /** Requested requirements that received no judgement at all. */
  readonly unanswered: number;
}

export interface AppliedCoverageJudgements {
  readonly assessments: readonly RequirementCoverageAssessment[];
  readonly summary: CoverageJudgementSummary;
}

const hiddenReasoningMarkers = [
  "chain of thought",
  "chain-of-thought",
  "<thinking",
  "reasoning:",
  "scratchpad",
];

const lineBreakPattern = /[\r\n\u2028\u2029]/;

/** Requests judgement for each `needs-judgement` assessment, in order, up to the cap. */
export function coverageJudgementRequestsFrom(
  assessments: readonly RequirementCoverageAssessment[],
): readonly CoverageJudgementRequest[] {
  return Object.freeze(
    assessments
      .filter((assessment) => assessment.status === "needs-judgement")
      .slice(0, maximumCoverageJudgementRequests)
      .map((assessment) =>
        Object.freeze({
          requirementId: assessment.requirementId,
          candidateBlockIds: Object.freeze(assessment.evidence.map(({ blockId }) => blockId)),
        }),
      ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validRationale(rationale: unknown): string | null {
  if (typeof rationale !== "string") {
    return null;
  }
  const trimmed = rationale.trim();
  if (trimmed === "" || trimmed.length > maximumCoverageJudgementRationaleCharacters) {
    return null;
  }
  if (lineBreakPattern.test(trimmed)) {
    return null;
  }
  const lowered = trimmed.toLowerCase();
  return hiddenReasoningMarkers.some((marker) => lowered.includes(marker)) ? null : trimmed;
}

function validCitations(
  judgement: Record<string, unknown>,
  verdict: CoverageJudgementVerdict,
  request: CoverageJudgementRequest,
): readonly string[] | null {
  const cited = judgement.citedBlockIds;
  if (!Array.isArray(cited)) {
    return null;
  }
  const candidates = new Set(request.candidateBlockIds);
  const unique: string[] = [];
  for (const blockId of cited as readonly unknown[]) {
    if (typeof blockId !== "string" || !candidates.has(blockId)) {
      return null;
    }
    if (!unique.includes(blockId)) {
      unique.push(blockId);
    }
  }
  return verdict === "satisfied" && unique.length === 0 ? null : unique;
}

function resolveAssessment(
  assessment: RequirementCoverageAssessment,
  judgement: unknown,
  request: CoverageJudgementRequest,
): RequirementCoverageAssessment | null {
  if (!isRecord(judgement)) {
    return null;
  }
  const verdict = judgement.verdict;
  if (verdict !== "satisfied" && verdict !== "not-satisfied") {
    return null;
  }
  const rationale = validRationale(judgement.rationale);
  const citations = validCitations(judgement, verdict, request);
  if (rationale === null || citations === null) {
    return null;
  }
  if (verdict === "not-satisfied") {
    return Object.freeze({
      requirementId: assessment.requirementId,
      status: "uncovered",
      basis: "judgement",
      evidence: Object.freeze([]),
      rationale,
    });
  }
  const evidence = citations.map((blockId): RequirementCoverageEvidence => {
    const candidate = assessment.evidence.find((item) => item.blockId === blockId);
    return Object.freeze(
      candidate?.score === undefined ? { blockId } : { blockId, score: candidate.score },
    );
  });
  return Object.freeze({
    requirementId: assessment.requirementId,
    status: "covered",
    basis: "judgement",
    evidence: Object.freeze(evidence),
    rationale,
  });
}

/**
 * Folds critic judgements into the assessments. Only `needs-judgement`
 * assessments that were actually requested may change; every other assessment
 * is returned as-is. An invalid, duplicated, or missing judgement leaves the
 * assessment `needs-judgement` rather than guessing a verdict.
 */
export function applyCoverageJudgements(
  assessments: readonly RequirementCoverageAssessment[],
  requests: readonly CoverageJudgementRequest[],
  judgements: readonly CoverageJudgement[],
): AppliedCoverageJudgements {
  const requestsById = new Map(requests.map((request) => [request.requirementId, request]));
  const judgementsById = new Map<string, unknown[]>();
  for (const judgement of judgements as readonly unknown[]) {
    const requirementId = isRecord(judgement) ? judgement.requirementId : undefined;
    if (typeof requirementId === "string") {
      judgementsById.set(requirementId, [...(judgementsById.get(requirementId) ?? []), judgement]);
    }
  }

  let satisfied = 0;
  let notSatisfied = 0;
  let unanswered = 0;
  const resolvedIds = new Set<string>();

  const next = assessments.map((assessment) => {
    const request = requestsById.get(assessment.requirementId);
    if (assessment.status !== "needs-judgement" || request === undefined) {
      return assessment;
    }
    const answers = judgementsById.get(assessment.requirementId) ?? [];
    if (answers.length === 0) {
      unanswered += 1;
      return assessment;
    }
    const resolved =
      answers.length === 1 ? resolveAssessment(assessment, answers[0], request) : null;
    if (resolved === null) {
      return assessment;
    }
    resolvedIds.add(assessment.requirementId);
    if (resolved.status === "covered") {
      satisfied += 1;
    } else {
      notSatisfied += 1;
    }
    return resolved;
  });

  const invalid = [...judgementsById.keys()].filter((id) => !resolvedIds.has(id)).length;
  return Object.freeze({
    assessments: Object.freeze(next),
    summary: Object.freeze({
      judged: satisfied + notSatisfied,
      satisfied,
      notSatisfied,
      invalid,
      unanswered,
    }),
  });
}
