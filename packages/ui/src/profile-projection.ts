/**
 * The renderer's view of a saved career profile version, projected from the record a host's
 * service returns: the desktop's application service, or the hosted API's profile view (ADR 0011,
 * D9). Both hosts run the same projection, so neither can show the screens a field the other leaves
 * out, and a malformed record fails the same way on both.
 */

import {
  canonicalCandidateProfileFactCategories,
  canonicalCandidateProfileIssueCodes,
  canonicalCandidateProfileIssueSeverities,
  canonicalCandidateProfileIssueStatuses,
  canonicalCandidateProfileProvenanceKinds,
  canonicalCandidateProfileStatuses,
  maximumCanonicalCandidateProfileFactCount,
  maximumCanonicalCandidateProfileFactIdLength,
  maximumCanonicalCandidateProfileFieldLength,
  maximumCanonicalCandidateProfileIdLength,
  maximumCanonicalCandidateProfileIssueCount,
  maximumCanonicalCandidateProfileIssueFactReferenceCount,
  maximumCanonicalCandidateProfileIssueMessageLength,
  maximumCanonicalCandidateProfileIssueSourceReferenceCount,
  maximumCanonicalCandidateProfileProvenanceCount,
  maximumCanonicalCandidateProfileProvenanceQuoteLength,
  maximumCanonicalCandidateProfileSubjectIdLength,
  maximumCanonicalCandidateProfileValueLength,
} from "@draft-loop/domain";

import type {
  CanonicalCandidateProfileFactProvenanceReferenceResult,
  CanonicalCandidateProfileFactResult,
  CanonicalCandidateProfileIssueResult,
  CanonicalCandidateProfileProvenanceReferenceResult,
  CanonicalCandidateProfileRecordResult,
} from "./bridge.js";
import type { ProjectionFailure } from "./opportunity-projection.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    Number.isFinite(Date.parse(value))
  );
}

const canonicalCandidateProfileRecordKeys = new Set([
  "workspaceId",
  "profile",
  "checksum",
  "reusedSourceCount",
  "extractedSourceCount",
  "sensitivityRulesApplied",
]);
const canonicalCandidateProfileKeys = new Set([
  "schemaVersion",
  "id",
  "version",
  "parentVersion",
  "status",
  "createdAt",
  "updatedAt",
  "reviewedAt",
  "candidateKnowledgeSelection",
  // Which model and prompt extracted the facts; checked by the application, not sent to the window.
  "extraction",
  "facts",
  "issues",
]);
const canonicalCandidateProfileFactKeys = new Set([
  "id",
  "category",
  "subjectId",
  "field",
  "value",
  "provenance",
]);
const canonicalCandidateProfileIssueKeys = new Set([
  "id",
  "code",
  "severity",
  "status",
  "message",
  "factIds",
  "sourceRefs",
]);
const canonicalCandidateProfileReferenceKeys = new Set([
  "storeId",
  "knowledgeBaseId",
  "sourceId",
  "versionId",
  "kind",
]);
// Only fact provenance keeps the exact source quote; issue references never carry one.
const canonicalCandidateProfileFactReferenceKeys = new Set([
  ...canonicalCandidateProfileReferenceKeys,
  "quote",
]);

/** Thrown inside the projection; the exported function hands it to the host's failure. */
class InvalidProfileRecord extends Error {}

const invalidProfileRecordMessage =
  "The canonical candidate profile service returned an invalid record.";

function canonicalCandidateProfileFailure(): never {
  throw new InvalidProfileRecord(invalidProfileRecordMessage);
}

function canonicalCandidateProfileText(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
    return canonicalCandidateProfileFailure();
  }
  if (
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (
        (codePoint < 0x20 && character !== "\n" && character !== "\r" && character !== "\t") ||
        codePoint === 0x7f ||
        (codePoint >= 0x80 && codePoint <= 0x9f)
      );
    })
  ) {
    return canonicalCandidateProfileFailure();
  }
  return value.trim();
}

function canonicalCandidateProfileIdentifier(
  value: unknown,
  maximum = maximumCanonicalCandidateProfileIdLength,
): string {
  const result = canonicalCandidateProfileText(value, maximum);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(result)) {
    return canonicalCandidateProfileFailure();
  }
  return result;
}

function canonicalCandidateProfileReferenceKey(
  reference: CanonicalCandidateProfileProvenanceReferenceResult,
): string {
  return JSON.stringify([
    reference.storeId,
    reference.knowledgeBaseId,
    reference.sourceId,
    reference.versionId,
    reference.kind,
  ]);
}

function projectCanonicalCandidateProfileReference(
  value: unknown,
): CanonicalCandidateProfileProvenanceReferenceResult {
  if (
    !isRecord(value) ||
    ![...Object.keys(value)].every((key) => canonicalCandidateProfileReferenceKeys.has(key))
  ) {
    return canonicalCandidateProfileFailure();
  }
  return {
    storeId: canonicalCandidateProfileIdentifier(value.storeId),
    knowledgeBaseId: canonicalCandidateProfileIdentifier(value.knowledgeBaseId),
    sourceId: canonicalCandidateProfileIdentifier(value.sourceId),
    versionId: canonicalCandidateProfileIdentifier(value.versionId),
    kind: canonicalCandidateProfileProvenanceKinds.includes(
      value.kind as (typeof canonicalCandidateProfileProvenanceKinds)[number],
    )
      ? (value.kind as (typeof canonicalCandidateProfileProvenanceKinds)[number])
      : canonicalCandidateProfileFailure(),
  };
}

function projectCanonicalCandidateProfileFactReference(
  value: unknown,
): CanonicalCandidateProfileFactProvenanceReferenceResult {
  if (
    !isRecord(value) ||
    ![...Object.keys(value)].every((key) => canonicalCandidateProfileFactReferenceKeys.has(key))
  ) {
    return canonicalCandidateProfileFailure();
  }
  const { quote, ...identity } = value;
  if (
    quote !== undefined &&
    (typeof quote !== "string" ||
      quote.trim().length === 0 ||
      quote.length > maximumCanonicalCandidateProfileProvenanceQuoteLength)
  ) {
    return canonicalCandidateProfileFailure();
  }
  return {
    ...projectCanonicalCandidateProfileReference(identity),
    ...(quote === undefined ? {} : { quote }),
  };
}

function projectCanonicalCandidateProfileFact(value: unknown): CanonicalCandidateProfileFactResult {
  if (
    !isRecord(value) ||
    ![...Object.keys(value)].every((key) => canonicalCandidateProfileFactKeys.has(key))
  ) {
    return canonicalCandidateProfileFailure();
  }
  if (
    !Array.isArray(value.provenance) ||
    value.provenance.length === 0 ||
    value.provenance.length > maximumCanonicalCandidateProfileProvenanceCount
  ) {
    return canonicalCandidateProfileFailure();
  }
  const provenance = value.provenance.map(projectCanonicalCandidateProfileFactReference);
  if (
    new Set(provenance.map(canonicalCandidateProfileReferenceKey)).size !== provenance.length ||
    !provenance.some((reference) => reference.kind === "candidate-provided")
  ) {
    return canonicalCandidateProfileFailure();
  }
  const subjectId =
    value.subjectId === undefined
      ? undefined
      : canonicalCandidateProfileIdentifier(
          value.subjectId,
          maximumCanonicalCandidateProfileSubjectIdLength,
        );
  const category = canonicalCandidateProfileFactCategories.includes(
    value.category as (typeof canonicalCandidateProfileFactCategories)[number],
  )
    ? (value.category as (typeof canonicalCandidateProfileFactCategories)[number])
    : canonicalCandidateProfileFailure();
  return {
    id: canonicalCandidateProfileIdentifier(value.id, maximumCanonicalCandidateProfileFactIdLength),
    category,
    ...(subjectId === undefined ? {} : { subjectId }),
    field: canonicalCandidateProfileText(value.field, maximumCanonicalCandidateProfileFieldLength),
    value: canonicalCandidateProfileText(value.value, maximumCanonicalCandidateProfileValueLength),
    provenance,
  };
}

function projectCanonicalCandidateProfileIssue(
  value: unknown,
): CanonicalCandidateProfileIssueResult {
  if (
    !isRecord(value) ||
    ![...Object.keys(value)].every((key) => canonicalCandidateProfileIssueKeys.has(key))
  ) {
    return canonicalCandidateProfileFailure();
  }
  if (
    !Array.isArray(value.factIds) ||
    value.factIds.length > maximumCanonicalCandidateProfileIssueFactReferenceCount
  ) {
    return canonicalCandidateProfileFailure();
  }
  if (
    !Array.isArray(value.sourceRefs) ||
    value.sourceRefs.length > maximumCanonicalCandidateProfileIssueSourceReferenceCount
  ) {
    return canonicalCandidateProfileFailure();
  }
  const factIds = value.factIds.map((factId) => canonicalCandidateProfileIdentifier(factId));
  if (new Set(factIds).size !== factIds.length) return canonicalCandidateProfileFailure();
  const sourceRefs = value.sourceRefs.map(projectCanonicalCandidateProfileReference);
  if (new Set(sourceRefs.map(canonicalCandidateProfileReferenceKey)).size !== sourceRefs.length) {
    return canonicalCandidateProfileFailure();
  }
  const code = canonicalCandidateProfileIssueCodes.includes(
    value.code as (typeof canonicalCandidateProfileIssueCodes)[number],
  )
    ? (value.code as (typeof canonicalCandidateProfileIssueCodes)[number])
    : canonicalCandidateProfileFailure();
  const severity = canonicalCandidateProfileIssueSeverities.includes(
    value.severity as (typeof canonicalCandidateProfileIssueSeverities)[number],
  )
    ? (value.severity as (typeof canonicalCandidateProfileIssueSeverities)[number])
    : canonicalCandidateProfileFailure();
  const status = canonicalCandidateProfileIssueStatuses.includes(
    value.status as (typeof canonicalCandidateProfileIssueStatuses)[number],
  )
    ? (value.status as (typeof canonicalCandidateProfileIssueStatuses)[number])
    : canonicalCandidateProfileFailure();
  return {
    id: canonicalCandidateProfileIdentifier(value.id, maximumCanonicalCandidateProfileFactIdLength),
    code,
    severity,
    status,
    message: canonicalCandidateProfileText(
      value.message,
      maximumCanonicalCandidateProfileIssueMessageLength,
    ),
    factIds,
    sourceRefs,
  };
}

function projectRecord(
  workspaceId: string,
  value: unknown,
  expectedProfileId?: string,
): CanonicalCandidateProfileRecordResult {
  if (!isRecord(value) || value.workspaceId !== workspaceId || !isRecord(value.profile)) {
    return canonicalCandidateProfileFailure();
  }
  if (!Object.keys(value).every((key) => canonicalCandidateProfileRecordKeys.has(key))) {
    return canonicalCandidateProfileFailure();
  }
  const profile = value.profile as Record<string, unknown>;
  if (!Object.keys(profile).every((key) => canonicalCandidateProfileKeys.has(key))) {
    return canonicalCandidateProfileFailure();
  }
  const version = profile.version;
  const parentVersion = profile.parentVersion;
  const createdAt = profile.createdAt;
  const updatedAt = profile.updatedAt;
  const factsValue = profile.facts;
  const issuesValue = profile.issues;
  if (
    typeof value.checksum !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.checksum) ||
    typeof version !== "number" ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    (parentVersion !== null &&
      (typeof parentVersion !== "number" ||
        !Number.isSafeInteger(parentVersion) ||
        parentVersion < 1)) ||
    (typeof version === "number" &&
      (version === 1 ? parentVersion !== null : parentVersion !== version - 1)) ||
    !isValidTimestamp(createdAt) ||
    !isValidTimestamp(updatedAt) ||
    !Array.isArray(factsValue) ||
    factsValue.length > maximumCanonicalCandidateProfileFactCount ||
    !Array.isArray(issuesValue) ||
    issuesValue.length > maximumCanonicalCandidateProfileIssueCount
  ) {
    return canonicalCandidateProfileFailure();
  }
  const normalizedVersion = version as number;
  const normalizedParentVersion = parentVersion === null ? null : (parentVersion as number);
  const profileId = canonicalCandidateProfileIdentifier(profile.id);
  const status = canonicalCandidateProfileStatuses.includes(
    profile.status as (typeof canonicalCandidateProfileStatuses)[number],
  )
    ? (profile.status as (typeof canonicalCandidateProfileStatuses)[number])
    : canonicalCandidateProfileFailure();
  const reviewedAt =
    profile.reviewedAt === undefined
      ? null
      : isValidTimestamp(profile.reviewedAt)
        ? profile.reviewedAt
        : canonicalCandidateProfileFailure();
  if (
    (status === "draft") !== (reviewedAt === null) ||
    Date.parse(updatedAt) < Date.parse(createdAt) ||
    (reviewedAt !== null &&
      (Date.parse(reviewedAt) < Date.parse(createdAt) ||
        Date.parse(reviewedAt) > Date.parse(updatedAt)))
  ) {
    return canonicalCandidateProfileFailure();
  }
  const facts = factsValue.map(projectCanonicalCandidateProfileFact);
  const issues = issuesValue.map(projectCanonicalCandidateProfileIssue);
  const factIds = new Set(facts.map((fact) => fact.id));
  if (
    factIds.size !== facts.length ||
    new Set(issues.map((issue) => issue.id)).size !== issues.length ||
    issues.some((issue) => issue.factIds.some((factId) => !factIds.has(factId)))
  ) {
    return canonicalCandidateProfileFailure();
  }
  if (expectedProfileId !== undefined && profileId !== expectedProfileId) {
    return canonicalCandidateProfileFailure();
  }
  return {
    workspaceId,
    profileId,
    version: normalizedVersion,
    parentVersion: normalizedParentVersion,
    status,
    createdAt,
    updatedAt,
    reviewedAt,
    checksum: value.checksum,
    facts,
    issues,
    ...projectCanonicalCandidateProfileSourceCounts(value),
  };
}

/** Both counts of a fresh derivation, or neither; anything else is a malformed host answer. */
function projectCanonicalCandidateProfileSourceCounts(
  value: Record<string, unknown>,
): Pick<CanonicalCandidateProfileRecordResult, "reusedSourceCount" | "extractedSourceCount"> {
  const { reusedSourceCount, extractedSourceCount } = value;
  if (reusedSourceCount === undefined && extractedSourceCount === undefined) return {};
  if (
    typeof reusedSourceCount !== "number" ||
    typeof extractedSourceCount !== "number" ||
    !Number.isSafeInteger(reusedSourceCount) ||
    !Number.isSafeInteger(extractedSourceCount) ||
    reusedSourceCount < 0 ||
    extractedSourceCount < 0
  ) {
    return canonicalCandidateProfileFailure();
  }
  return { reusedSourceCount, extractedSourceCount };
}

/**
 * Projects a saved career profile version before it reaches the renderer: exact keys, bounded
 * text and lists, a contiguous version chain and consistent review dates. The extraction identity
 * and the knowledge selection stay with the host.
 */
export function projectCanonicalCandidateProfileRecord(
  workspaceId: string,
  value: unknown,
  fail: ProjectionFailure,
  expectedProfileId?: string,
): CanonicalCandidateProfileRecordResult {
  try {
    return projectRecord(workspaceId, value, expectedProfileId);
  } catch (error) {
    if (error instanceof InvalidProfileRecord) return fail(error.message);
    throw error;
  }
}
