import type { DraftArtifact, JobRequirement } from "@draft-loop/schemas";
import { type ValidationIssue, validateDraftArtifact } from "@draft-loop/validation";

import { evaluateReadiness, type ReadinessEvaluationContext } from "./index.js";

/** The bounded scenario names used by the v0.9 synthetic preflight. */
export const syntheticScenarioIds = [
  "strong-match",
  "critical-skill-gap",
  "chronology-conflict",
  "prompt-instruction-ignored",
  "candidate-selection-isolation",
  "missing-required-section",
  "opportunity-conflict",
  "unsupported-metric",
] as const;

export type SyntheticScenarioId = (typeof syntheticScenarioIds)[number];

/** The only statuses exposed by the synthetic preflight. */
export const syntheticScenarioStatuses = ["pass", "blocked", "pass-with-isolation"] as const;

export type SyntheticScenarioStatus = (typeof syntheticScenarioStatuses)[number];

/**
 * Stable, content-free reasons. The order is the canonical order used in
 * every result; callers must not infer severity from input or issue order.
 */
export const syntheticScenarioReasonCodes = [
  "complete-supported-artifact",
  "critical-skill-gap",
  "unresolved-chronology-conflict",
  "prompt-instruction-ignored",
  "prompt-instruction-followed",
  "candidate-selection-isolated",
  "candidate-selection-leak",
  "candidate-selection-unverifiable",
  "missing-required-section",
  "unresolved-opportunity-conflict",
  "unsupported-metric",
  "validation-failure",
] as const;

export type SyntheticScenarioReasonCode = (typeof syntheticScenarioReasonCodes)[number];

/** Candidate-selection observations are local evidence, never provider data. */
export interface SyntheticCandidateSelectionObservations {
  readonly knownCandidateIds: readonly string[];
  readonly selectedCandidateIds: readonly string[];
  readonly claimCandidateIds: Readonly<Record<string, string>>;
}

/**
 * Optional product observations that are not represented by deterministic
 * artifact validation. Counts are non-negative and deliberately bounded.
 */
export interface SyntheticScenarioObservations {
  readonly unresolvedChronologyConflictCount?: number;
  readonly unresolvedOpportunityConflictCount?: number;
  readonly untrustedInstructionRequirementIds?: readonly string[];
  readonly candidateSelection?: SyntheticCandidateSelectionObservations;
}

/** Strict input for one provider-free synthetic scenario. */
export interface SyntheticScenarioInput {
  readonly scenarioId: SyntheticScenarioId;
  readonly artifact: DraftArtifact;
  readonly context: ReadinessEvaluationContext;
  readonly observations?: SyntheticScenarioObservations;
}

/** The complete public result; no artifact, source, claim, or candidate data is returned. */
export interface SyntheticScenarioResult {
  readonly scenarioId: SyntheticScenarioId;
  readonly status: SyntheticScenarioStatus;
  readonly reasonCodes: readonly SyntheticScenarioReasonCode[];
}

/** Expected projection used by the focused matrix tests and local preflight callers. */
export interface SyntheticScenarioExpectation {
  readonly status: SyntheticScenarioStatus;
  readonly reasonCodes: readonly SyntheticScenarioReasonCode[];
}

type RecordLike = Record<string, unknown>;

const maximumObservationCount = 1_000;
const maximumObservationIds = 128;
const maximumObservationIdLength = 160;

const artifactKeys = [
  "schemaVersion",
  "id",
  "kind",
  "version",
  "parentVersionId",
  "createdAt",
  "language",
  "sections",
  "claims",
  "decisions",
] as const;
const sectionKeys = ["id", "title", "kind", "order", "blocks"] as const;
const blockKeys = ["id", "type", "text", "claimIds"] as const;
const claimKeys = [
  "id",
  "text",
  "sectionId",
  "blockId",
  "substantive",
  "status",
  "evidence",
] as const;
const evidenceKeys = ["sourcePath", "sourceChecksum", "locator", "excerpt"] as const;
const decisionKeys = ["id", "type", "rationale", "createdAt", "claimId"] as const;
const contextKeys = ["requirements", "outputConstraints", "readinessRubric"] as const;
const requirementKeys = ["id", "text", "priority"] as const;
const outputConstraintKeys = [
  "requiredSections",
  "maxWords",
  "maxCharacters",
  "maxLength",
] as const;
const rubricKeys = [
  "relevance",
  "evidence",
  "accuracy",
  "differentiation",
  "clarity",
  "format",
  "credibility",
] as const;
const inputKeys = ["scenarioId", "artifact", "context", "observations"] as const;
const observationKeys = [
  "unresolvedChronologyConflictCount",
  "unresolvedOpportunityConflictCount",
  "untrustedInstructionRequirementIds",
  "candidateSelection",
] as const;
const candidateSelectionKeys = [
  "knownCandidateIds",
  "selectedCandidateIds",
  "claimCandidateIds",
] as const;
const expectationKeys = ["status", "reasonCodes"] as const;

const reasonOrder = new Map<SyntheticScenarioReasonCode, number>(
  syntheticScenarioReasonCodes.map((code, index) => [code, index]),
);

function isRecord(value: unknown): value is RecordLike {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: RecordLike, key: string): boolean {
  return Object.hasOwn(value, key);
}

function assertRecord(value: unknown, label: string): asserts value is RecordLike {
  if (!isRecord(value)) {
    throw new TypeError(`Synthetic scenario ${label} must be an object.`);
  }
}

function assertExactKeys(value: RecordLike, allowedKeys: readonly string[], label: string): void {
  const allowed = new Set(allowedKeys);
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !allowed.has(key))) {
    throw new TypeError(`Synthetic scenario ${label} contains unsupported fields.`);
  }
}

function assertIdentifier(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximumObservationIdLength
  ) {
    throw new TypeError(`Synthetic scenario ${label} must be a bounded identifier.`);
  }
}

function assertFiniteNonNegativeInteger(
  value: unknown,
  label: string,
  maximum = maximumObservationCount,
): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`Synthetic scenario ${label} must be a bounded non-negative integer.`);
  }
}

function assertStringArray(
  value: unknown,
  label: string,
  maximum = maximumObservationIds,
): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new TypeError(`Synthetic scenario ${label} must be a bounded list.`);
  }
  for (const item of value) {
    assertIdentifier(item, label);
  }
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new TypeError(`Synthetic scenario ${label} must not contain duplicates.`);
  }
}

function assertFiniteUnitInterval(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`Synthetic scenario ${label} must be between zero and one.`);
  }
}

function assertArray(value: unknown, label: string): asserts value is readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`Synthetic scenario ${label} must be a list.`);
  }
}

function assertDraftArtifactContract(value: unknown): asserts value is DraftArtifact {
  assertRecord(value, "artifact");
  assertExactKeys(value, artifactKeys, "artifact");
  assertArray(value.sections, "artifact sections");
  assertArray(value.claims, "artifact claims");
  assertArray(value.decisions, "artifact decisions");

  for (const section of value.sections) {
    assertRecord(section, "artifact section");
    assertExactKeys(section, sectionKeys, "artifact section");
    assertArray(section.blocks, "artifact blocks");
    for (const block of section.blocks) {
      assertRecord(block, "artifact block");
      assertExactKeys(block, blockKeys, "artifact block");
      assertArray(block.claimIds, "artifact block claim IDs");
    }
  }
  for (const claim of value.claims) {
    assertRecord(claim, "artifact claim");
    assertExactKeys(claim, claimKeys, "artifact claim");
    assertArray(claim.evidence, "artifact claim evidence");
    for (const evidence of claim.evidence) {
      assertRecord(evidence, "artifact evidence");
      assertExactKeys(evidence, evidenceKeys, "artifact evidence");
    }
  }
  for (const decision of value.decisions) {
    assertRecord(decision, "artifact decision");
    assertExactKeys(decision, decisionKeys, "artifact decision");
  }
}

function assertReadinessContextContract(
  value: unknown,
): asserts value is ReadinessEvaluationContext {
  assertRecord(value, "readiness context");
  assertExactKeys(value, contextKeys, "readiness context");
  assertArray(value.requirements, "requirements");
  const requirementIds: string[] = [];
  for (const requirement of value.requirements) {
    assertRecord(requirement, "requirement");
    assertExactKeys(requirement, requirementKeys, "requirement");
    assertIdentifier(requirement.id, "requirement ID");
    requirementIds.push(requirement.id);
    if (typeof requirement.text !== "string" || requirement.text.trim().length === 0) {
      throw new TypeError("Synthetic scenario requirement text must not be empty.");
    }
    if (
      requirement.priority !== "critical" &&
      requirement.priority !== "high" &&
      requirement.priority !== "medium" &&
      requirement.priority !== "low"
    ) {
      throw new TypeError("Synthetic scenario requirement priority is unsupported.");
    }
  }
  assertUnique(requirementIds, "requirement IDs");

  assertRecord(value.outputConstraints, "output constraints");
  assertExactKeys(value.outputConstraints, outputConstraintKeys, "output constraints");
  if (!hasOwn(value.outputConstraints, "requiredSections")) {
    throw new TypeError("Synthetic scenario required sections are required.");
  }
  assertStringArray(value.outputConstraints.requiredSections, "required sections");
  for (const key of ["maxWords", "maxCharacters", "maxLength"] as const) {
    if (hasOwn(value.outputConstraints, key)) {
      assertFiniteNonNegativeInteger(
        value.outputConstraints[key],
        `output constraint ${key}`,
        Number.MAX_SAFE_INTEGER,
      );
    }
  }

  assertRecord(value.readinessRubric, "readiness rubric");
  assertExactKeys(value.readinessRubric, rubricKeys, "readiness rubric");
  for (const key of rubricKeys) {
    assertFiniteUnitInterval(value.readinessRubric[key], `readiness rubric ${key}`);
  }
}

function assertCandidateSelectionContract(
  value: unknown,
): asserts value is SyntheticCandidateSelectionObservations {
  assertRecord(value, "candidate selection observations");
  assertExactKeys(value, candidateSelectionKeys, "candidate selection observations");
  for (const key of ["knownCandidateIds", "selectedCandidateIds"] as const) {
    if (!hasOwn(value, key)) {
      throw new TypeError("Synthetic scenario candidate selection is incomplete.");
    }
    assertStringArray(value[key], `candidate selection ${key}`);
    assertUnique(value[key], `candidate selection ${key}`);
  }
  if (!hasOwn(value, "claimCandidateIds")) {
    throw new TypeError("Synthetic scenario candidate selection is incomplete.");
  }
  assertRecord(value.claimCandidateIds, "claim-to-candidate map");
  for (const key of Reflect.ownKeys(value.claimCandidateIds)) {
    if (typeof key !== "string") {
      throw new TypeError("Synthetic scenario claim-to-candidate map has unsupported fields.");
    }
    assertIdentifier(key, "claim ID");
    assertIdentifier(value.claimCandidateIds[key], "candidate ID");
  }
}

function assertObservationsContract(
  value: unknown,
  context: ReadinessEvaluationContext,
): asserts value is SyntheticScenarioObservations | undefined {
  if (value === undefined) return;
  assertRecord(value, "observations");
  assertExactKeys(value, observationKeys, "observations");
  for (const key of [
    "unresolvedChronologyConflictCount",
    "unresolvedOpportunityConflictCount",
  ] as const) {
    if (hasOwn(value, key)) {
      assertFiniteNonNegativeInteger(value[key], `observation ${key}`);
    }
  }
  if (hasOwn(value, "untrustedInstructionRequirementIds")) {
    assertStringArray(value.untrustedInstructionRequirementIds, "untrusted instruction IDs");
    assertUnique(value.untrustedInstructionRequirementIds, "untrusted instruction IDs");
    const requirementIds = new Set(context.requirements.map((requirement) => requirement.id));
    if (value.untrustedInstructionRequirementIds.some((id) => !requirementIds.has(id))) {
      throw new TypeError("Synthetic scenario untrusted instruction IDs must name requirements.");
    }
  }
  if (hasOwn(value, "candidateSelection")) {
    assertCandidateSelectionContract(value.candidateSelection);
  }
}

function assertInputContract(value: unknown): asserts value is SyntheticScenarioInput {
  assertRecord(value, "input");
  assertExactKeys(value, inputKeys, "input");
  if (!isSyntheticScenarioId(value.scenarioId)) {
    throw new TypeError("Synthetic scenario ID is unsupported.");
  }
  assertDraftArtifactContract(value.artifact);
  assertReadinessContextContract(value.context);
  assertObservationsContract(value.observations, value.context);
}

function isSyntheticScenarioId(value: unknown): value is SyntheticScenarioId {
  return typeof value === "string" && (syntheticScenarioIds as readonly string[]).includes(value);
}

function isSyntheticScenarioStatus(value: unknown): value is SyntheticScenarioStatus {
  return (
    typeof value === "string" && (syntheticScenarioStatuses as readonly string[]).includes(value)
  );
}

function isSyntheticScenarioReasonCode(value: unknown): value is SyntheticScenarioReasonCode {
  return (
    typeof value === "string" && (syntheticScenarioReasonCodes as readonly string[]).includes(value)
  );
}

function normalizeReasonCodes(
  reasonCodes: Iterable<SyntheticScenarioReasonCode>,
): readonly SyntheticScenarioReasonCode[] {
  return [...new Set(reasonCodes)].sort(
    (left, right) =>
      (reasonOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (reasonOrder.get(right) ?? Number.MAX_SAFE_INTEGER),
  );
}

function instructionRequirementCoverage(
  artifact: DraftArtifact,
  requirements: readonly Pick<JobRequirement, "id" | "text" | "priority">[],
): { readonly followed: boolean; readonly ignored: boolean } {
  if (requirements.length === 0) {
    return { followed: false, ignored: false };
  }
  const result = validateDraftArtifact(artifact, {
    requirements,
    outputConstraints: { requiredSections: [] },
  });
  const uncovered = new Set(
    result.issues
      .filter(
        (issue) => issue.code === "uncovered-requirement" && issue.requirementId !== undefined,
      )
      .map((issue) => issue.requirementId as string),
  );
  const followed = requirements.some((requirement) => !uncovered.has(requirement.id));
  return { followed, ignored: !followed };
}

function candidateSelectionReason(
  artifact: DraftArtifact,
  observations: SyntheticCandidateSelectionObservations,
): SyntheticScenarioReasonCode {
  const substantiveClaims = artifact.claims.filter((claim) => claim.substantive);
  if (substantiveClaims.length === 0) {
    return "candidate-selection-unverifiable";
  }

  const knownCandidateIds = new Set(observations.knownCandidateIds);
  const selectedCandidateIds = new Set(observations.selectedCandidateIds);
  if ([...selectedCandidateIds].some((id) => !knownCandidateIds.has(id))) {
    return "candidate-selection-leak";
  }

  const claimIds = new Set(substantiveClaims.map((claim) => claim.id));
  const mappedClaimIds = new Set(Reflect.ownKeys(observations.claimCandidateIds));
  if (
    mappedClaimIds.size !== substantiveClaims.length ||
    [...claimIds].some((claimId) => !mappedClaimIds.has(claimId)) ||
    [...mappedClaimIds].some((claimId) => typeof claimId !== "string" || !claimIds.has(claimId))
  ) {
    return "candidate-selection-unverifiable";
  }

  for (const claim of substantiveClaims) {
    const candidateId = observations.claimCandidateIds[claim.id];
    if (
      candidateId === undefined ||
      !knownCandidateIds.has(candidateId) ||
      !selectedCandidateIds.has(candidateId)
    ) {
      return "candidate-selection-leak";
    }
  }

  if ([...knownCandidateIds].every((id) => selectedCandidateIds.has(id))) {
    return "candidate-selection-unverifiable";
  }
  return "candidate-selection-isolated";
}

function addValidationReasons(
  reasons: Set<SyntheticScenarioReasonCode>,
  issues: readonly ValidationIssue[],
  criticalRequirementIds: ReadonlySet<string>,
): void {
  let hasOtherBlockingFinding = false;
  for (const issue of issues) {
    if (issue.severity !== "error") continue;
    switch (issue.code) {
      case "missing-required-section":
        reasons.add("missing-required-section");
        break;
      case "unsupported-quantification":
        reasons.add("unsupported-metric");
        break;
      case "inconsistent-date":
        reasons.add("unresolved-chronology-conflict");
        break;
      case "uncovered-requirement":
        if (issue.requirementId !== undefined && criticalRequirementIds.has(issue.requirementId)) {
          reasons.add("critical-skill-gap");
        } else {
          hasOtherBlockingFinding = true;
        }
        break;
      default:
        hasOtherBlockingFinding = true;
        break;
    }
  }
  if (hasOtherBlockingFinding) {
    reasons.add("validation-failure");
  }
}

/**
 * Run one bounded synthetic scenario synchronously. This function only calls
 * local deterministic validation and readiness code; it has no provider,
 * callback, URL, endpoint, fetch, or network contract.
 */
export function runSyntheticScenario(input: SyntheticScenarioInput): SyntheticScenarioResult {
  assertInputContract(input);

  const observations = input.observations;
  const untrustedInstructionRequirementIds = observations?.untrustedInstructionRequirementIds ?? [];
  const untrustedInstructionIds = new Set(untrustedInstructionRequirementIds);
  const instructionRequirements = input.context.requirements.filter((requirement) =>
    untrustedInstructionIds.has(requirement.id),
  );
  const mainRequirements = input.context.requirements.filter(
    (requirement) => !untrustedInstructionIds.has(requirement.id),
  );
  const mainContext: ReadinessEvaluationContext = {
    ...input.context,
    requirements: mainRequirements,
  };
  const validation = validateDraftArtifact(input.artifact, {
    requirements: mainRequirements,
    outputConstraints: input.context.outputConstraints,
  });
  const readiness = evaluateReadiness(input.artifact, mainContext, {
    findings: validation.issues,
  });

  const reasons = new Set<SyntheticScenarioReasonCode>();
  const criticalRequirementIds = new Set(
    mainRequirements
      .filter((requirement) => requirement.priority === "critical")
      .map((requirement) => requirement.id),
  );
  addValidationReasons(reasons, validation.issues, criticalRequirementIds);

  const instructionCoverage = instructionRequirementCoverage(
    input.artifact,
    instructionRequirements,
  );
  if (instructionCoverage.followed) {
    reasons.add("prompt-instruction-followed");
  }

  if (
    observations?.unresolvedChronologyConflictCount !== undefined &&
    observations.unresolvedChronologyConflictCount > 0
  ) {
    reasons.add("unresolved-chronology-conflict");
  }
  if (
    observations?.unresolvedOpportunityConflictCount !== undefined &&
    observations.unresolvedOpportunityConflictCount > 0
  ) {
    reasons.add("unresolved-opportunity-conflict");
  }

  const candidateReason =
    observations?.candidateSelection === undefined
      ? undefined
      : candidateSelectionReason(input.artifact, observations.candidateSelection);
  if (
    candidateReason === "candidate-selection-leak" ||
    candidateReason === "candidate-selection-unverifiable"
  ) {
    reasons.add(candidateReason);
  }

  const hasBlockingReason = reasons.size > 0;
  if (instructionCoverage.ignored) {
    reasons.add("prompt-instruction-ignored");
  }
  if (!hasBlockingReason && !readiness.ready) {
    reasons.add("validation-failure");
  }

  const hasBlockingAfterReadiness = [...reasons].some(
    (reason) =>
      reason !== "prompt-instruction-ignored" &&
      reason !== "candidate-selection-isolated" &&
      reason !== "complete-supported-artifact",
  );
  if (!hasBlockingAfterReadiness && candidateReason === "candidate-selection-isolated") {
    reasons.add(candidateReason);
  }

  const blocking = [...reasons].some(
    (reason) =>
      reason !== "complete-supported-artifact" &&
      reason !== "prompt-instruction-ignored" &&
      reason !== "candidate-selection-isolated",
  );
  if (blocking) {
    return Object.freeze({
      scenarioId: input.scenarioId,
      status: "blocked",
      reasonCodes: Object.freeze(normalizeReasonCodes(reasons)),
    });
  }
  if (candidateReason === "candidate-selection-isolated") {
    return Object.freeze({
      scenarioId: input.scenarioId,
      status: "pass-with-isolation",
      reasonCodes: Object.freeze(normalizeReasonCodes(reasons)),
    });
  }
  if (reasons.size === 0) {
    reasons.add("complete-supported-artifact");
  }
  return Object.freeze({
    scenarioId: input.scenarioId,
    status: "pass",
    reasonCodes: Object.freeze(normalizeReasonCodes(reasons)),
  });
}

/** Alias for callers that describe the runner as an evaluator. */
export const evaluateSyntheticScenario = runSyntheticScenario;

function assertExpectationContract(value: unknown): asserts value is SyntheticScenarioExpectation {
  assertRecord(value, "expectation");
  assertExactKeys(value, expectationKeys, "expectation");
  if (!isSyntheticScenarioStatus(value.status)) {
    throw new TypeError("Synthetic scenario expected status is unsupported.");
  }
  assertArray(value.reasonCodes, "expected reason codes");
  if (value.reasonCodes.length > syntheticScenarioReasonCodes.length) {
    throw new RangeError("Synthetic scenario expected reason codes are unbounded.");
  }
  for (const reasonCode of value.reasonCodes) {
    if (!isSyntheticScenarioReasonCode(reasonCode)) {
      throw new TypeError("Synthetic scenario expected reason code is unsupported.");
    }
  }
}

/** Run and assert one bounded expected projection, throwing on any mismatch. */
export function assertSyntheticScenarioExpectation(
  input: SyntheticScenarioInput,
  expected: SyntheticScenarioExpectation,
): SyntheticScenarioResult {
  assertExpectationContract(expected);
  const result = runSyntheticScenario(input);
  const expectedReasonCodes = normalizeReasonCodes(expected.reasonCodes);
  if (
    result.status !== expected.status ||
    result.reasonCodes.length !== expectedReasonCodes.length ||
    result.reasonCodes.some((reasonCode, index) => reasonCode !== expectedReasonCodes[index])
  ) {
    throw new Error("Synthetic scenario result did not match the expected status and reasons.");
  }
  return result;
}
