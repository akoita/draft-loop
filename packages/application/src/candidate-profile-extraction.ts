import { createHash } from "node:crypto";

import {
  type CanonicalCandidateProfileIssueCode,
  canonicalCandidateProfileFactCategories,
  maximumCanonicalCandidateProfileFactCount,
  maximumCanonicalCandidateProfileIdLength,
  maximumCanonicalCandidateProfileIssueCount,
  maximumCanonicalCandidateProfileIssueFactReferenceCount,
  maximumCanonicalCandidateProfileIssueSourceReferenceCount,
  maximumCanonicalCandidateProfileProvenanceCount,
  maximumCanonicalCandidateProfileValueLength,
} from "@draft-loop/domain";
import {
  type CanonicalCandidateProfileExtractionProposal,
  type CanonicalCandidateProfileFact,
  type CanonicalCandidateProfileFactProvenanceReference,
  type CanonicalCandidateProfileIssue,
  type CanonicalCandidateProfileProvenanceReference,
  canonicalCandidateProfileProvenanceReferenceSchema,
} from "@draft-loop/schemas";
import { isCandidateProfileCollectionFact } from "./candidate-profile-collection-conflicts.js";
import {
  type CandidateProfileExtractionStage,
  candidateProfileExtractionFailureMessage,
} from "./candidate-profile-extraction-errors.js";
import {
  canonicalCandidateProfileSourceContentKey,
  prepareCanonicalCandidateProfileExtractionSources,
} from "./candidate-profile-extraction-sources.js";
import type { CandidateProfileGroundingDiagnosticCount } from "./candidate-profile-grounding-diagnostics.js";
import {
  CandidateProfileInputError,
  candidateProfileSourceEmptyMessage,
  candidateProfileSourceTooLargeMessage,
  candidateProfileTotalTooLargeMessage,
} from "./candidate-profile-input-error.js";
import { hasEnoughDistinctFactsForIssue } from "./candidate-profile-paired-issues.js";
import { CandidateProfileProposalValidationError } from "./candidate-profile-proposal-validation.js";
import type { CanonicalProfileExtractionProgressListener } from "./canonical-profile-extraction-progress.js";
import {
  lexicalCompare,
  normalizedSemantic,
  referenceKey,
  uniqueSorted,
} from "./canonical-profile-fact-keys.js";
import { mergeIdenticalProfileFacts } from "./canonical-profile-fact-merge.js";
import { createCanonicalProfileFactQuoteResolver } from "./canonical-profile-fact-quotes.js";
import { extractGroundedCanonicalCandidateProfileProposal } from "./canonical-profile-grounding-recovery.js";
import {
  type CanonicalProfileSourceSensitivityGuard,
  canonicalProfileQuoteLocatorsByRepresentativeId,
  dropFactsQuotingExcludedText,
} from "./canonical-profile-sensitivity-filter.js";

/** Maximum exact CKB source versions sent through one extraction operation. */
export const maximumCanonicalCandidateProfileExtractionSources = 64;
/**
 * Maximum normalized text accepted for one exact source version. Sources above the unplanned
 * bound are only extracted through bounded windows, so this equals the operation total.
 */
export const maximumCanonicalCandidateProfileExtractionSourceCharacters = 512 * 1024;
/**
 * Maximum characters of one source that a single provider request may carry. Larger sources
 * must be extracted through bounded windows; a request never exceeds this bound.
 */
export const maximumUnplannedCanonicalCandidateProfileExtractionSourceCharacters = 128 * 1024;
/** Maximum normalized text sent across one extraction operation. */
export const maximumCanonicalCandidateProfileExtractionCharacters = 512 * 1024;
export const canonicalCandidateProfileExtractionApprovalErrorMessage =
  "Canonical candidate profile extraction requires explicit provider-data approval.";

const safeIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const checksumPattern = /^[a-f0-9]{64}$/u;

/** Path-free source content passed to the configured extraction provider. */
export interface CanonicalCandidateProfileExtractionSource {
  readonly id: string;
  readonly mediaType: string;
  readonly checksum: string;
  readonly text: string;
}

/** Local source material plus the exact CKB reference hidden from the provider request. */
export interface CanonicalCandidateProfileExtractionMaterial
  extends CanonicalCandidateProfileExtractionSource {
  readonly reference: CanonicalCandidateProfileProvenanceReference;
  /**
   * Present when `text` is a sensitivity-filtered version of the original source. It stays local:
   * it is never copied into a provider request and only checks evidence quotes before mapping.
   */
  readonly sensitivity?: CanonicalProfileSourceSensitivityGuard;
}

export interface CanonicalCandidateProfileExtractionRequest {
  readonly operationId: string;
  readonly sources: readonly CanonicalCandidateProfileExtractionSource[];
  readonly signal?: AbortSignal;
  /** Local advisory progress observer for planned extractions; never sent to a provider. */
  readonly onProgress?: CanonicalProfileExtractionProgressListener;
  readonly groundingRecovery?: readonly CandidateProfileGroundingDiagnosticCount[];
  /**
   * Local validator applied to each bounded batch of a planned extraction. It returns the
   * quote-repaired proposal or throws CandidateProfileGroundingError, and is never sent to a provider.
   */
  readonly groundProposal?: (
    proposal: CanonicalCandidateProfileExtractionProposal,
  ) => CanonicalCandidateProfileExtractionProposal;
  /**
   * Local filter for a replacement batch that still fails grounding. It returns the quote-repaired
   * proposal without its ungrounded facts, and is never sent to a provider.
   */
  readonly filterGroundedProposal?: (
    proposal: CanonicalCandidateProfileExtractionProposal,
  ) => CanonicalCandidateProfileExtractionProposal;
}

/** Provider seam for structured extraction from explicitly approved CKB text. */
export interface CanonicalCandidateProfileExtractionPort {
  readonly extract: (
    request: CanonicalCandidateProfileExtractionRequest,
  ) => unknown | Promise<unknown>;
}

export interface CanonicalCandidateProfileExtractionInput {
  readonly operationId: string;
  readonly sources: readonly CanonicalCandidateProfileExtractionMaterial[];
  readonly allowProviderData: boolean;
  readonly signal?: AbortSignal;
  readonly onProgress?: CanonicalProfileExtractionProgressListener;
}

export interface CanonicalCandidateProfileExtractionResult {
  readonly facts: readonly CanonicalCandidateProfileFact[];
  readonly issues: readonly CanonicalCandidateProfileIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneAndFreeze<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map(cloneAndFreeze)) as T;
  if (!isRecord(value)) return value;
  return Object.freeze(
    Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneAndFreeze(child)])),
  ) as T;
}

function digest(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\u0000"), "utf8").digest("hex");
}

function isOpaqueCandidateReference(
  reference: CanonicalCandidateProfileProvenanceReference,
): boolean {
  return (
    reference.kind === "candidate-provided" &&
    [reference.storeId, reference.knowledgeBaseId, reference.sourceId, reference.versionId].every(
      (value) => safeIdentifierPattern.test(value),
    )
  );
}

function validateInput(input: CanonicalCandidateProfileExtractionInput): {
  readonly request: CanonicalCandidateProfileExtractionRequest;
  readonly references: ReadonlyMap<string, CanonicalCandidateProfileProvenanceReference>;
} {
  if (
    !isRecord(input) ||
    typeof input.operationId !== "string" ||
    input.operationId.length === 0 ||
    input.operationId.length > maximumCanonicalCandidateProfileIdLength ||
    !safeIdentifierPattern.test(input.operationId) ||
    !Array.isArray(input.sources) ||
    input.sources.length === 0 ||
    input.sources.length > maximumCanonicalCandidateProfileExtractionSources
  ) {
    throw new Error("The canonical candidate profile extraction input is invalid.");
  }

  let characterCount = 0;
  const countedContent = new Set<string>();
  const ids = new Set<string>();
  const references = new Map<string, CanonicalCandidateProfileProvenanceReference>();
  const sources: CanonicalCandidateProfileExtractionSource[] = [];
  for (const source of input.sources) {
    if (
      !isRecord(source) ||
      typeof source.id !== "string" ||
      source.id.length === 0 ||
      source.id.length > maximumCanonicalCandidateProfileIdLength ||
      !safeIdentifierPattern.test(source.id) ||
      ids.has(source.id) ||
      typeof source.mediaType !== "string" ||
      source.mediaType.trim().length === 0 ||
      source.mediaType.length > maximumCanonicalCandidateProfileValueLength ||
      typeof source.checksum !== "string" ||
      !checksumPattern.test(source.checksum) ||
      typeof source.text !== "string"
    ) {
      throw new Error("The canonical candidate profile extraction source is invalid.");
    }
    if (source.text.trim().length === 0) {
      throw new CandidateProfileInputError(candidateProfileSourceEmptyMessage());
    }
    if (source.text.length > maximumCanonicalCandidateProfileExtractionSourceCharacters) {
      throw new CandidateProfileInputError(candidateProfileSourceTooLargeMessage());
    }
    const reference = canonicalCandidateProfileProvenanceReferenceSchema.parse(source.reference);
    if (!isOpaqueCandidateReference(reference)) {
      throw new Error("Canonical profile extraction requires candidate-provided CKB material.");
    }
    ids.add(source.id);
    references.set(source.id, reference);
    const contentKey = canonicalCandidateProfileSourceContentKey({
      mediaType: source.mediaType.trim(),
      checksum: source.checksum,
      text: source.text,
    });
    if (!countedContent.has(contentKey)) {
      countedContent.add(contentKey);
      characterCount += source.text.length;
    }
    sources.push(
      Object.freeze({
        id: source.id,
        mediaType: source.mediaType.trim(),
        checksum: source.checksum,
        text: source.text,
      }),
    );
  }
  if (characterCount > maximumCanonicalCandidateProfileExtractionCharacters) {
    throw new CandidateProfileInputError(candidateProfileTotalTooLargeMessage(characterCount));
  }
  return {
    request: Object.freeze({
      operationId: input.operationId,
      sources: Object.freeze(sources),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      ...(typeof input.onProgress === "function" ? { onProgress: input.onProgress } : {}),
    }),
    references,
  };
}

function factId(
  proposal: CanonicalCandidateProfileExtractionProposal["facts"][number],
  subjectId: string | undefined,
  references: readonly CanonicalCandidateProfileProvenanceReference[],
): string {
  return `profile-fact-${digest([
    proposal.key,
    proposal.category,
    subjectId ?? "",
    normalizedSemantic(proposal.field),
    normalizedSemantic(proposal.value),
    ...references.map(referenceKey),
  ]).slice(0, 32)}`;
}

function subjectId(subjectKey: string | undefined): string | undefined {
  return subjectKey === undefined
    ? undefined
    : `profile-subject-${digest([normalizedSemantic(subjectKey)]).slice(0, 32)}`;
}

function issueMessage(code: CanonicalCandidateProfileIssueCode, category?: string): string {
  switch (code) {
    case "conflict-date":
      return "Candidate-provided sources contain conflicting dates.";
    case "conflict-title":
      return "Candidate-provided sources contain conflicting titles.";
    case "conflict-duration":
      return "Candidate-provided sources contain conflicting durations.";
    case "conflict-metric":
      return "Candidate-provided sources contain conflicting metrics.";
    case "conflict-value":
      return "Candidate-provided sources contain conflicting values.";
    case "duplicate":
      return "Candidate-provided sources contain a possible duplicate record.";
    case "omission":
      return category === undefined
        ? "Candidate profile extraction left source material unresolved."
        : `No ${category} fact was extracted; candidate review is required.`;
  }
}

function issueSeverity(
  code: CanonicalCandidateProfileIssueCode,
): CanonicalCandidateProfileIssue["severity"] {
  return code.startsWith("conflict-") ? "error" : "warning";
}

function buildIssue(
  code: CanonicalCandidateProfileIssueCode,
  factIds: readonly string[],
  sourceRefs: readonly CanonicalCandidateProfileProvenanceReference[],
  category?: string,
  severity = issueSeverity(code),
  message?: string,
): CanonicalCandidateProfileIssue {
  const normalizedFactIds = [...new Set(factIds)].sort(lexicalCompare);
  // Issue references never carry a fact's evidence quote.
  const normalizedSourceRefs = uniqueSorted(
    sourceRefs.map(({ storeId, knowledgeBaseId, sourceId, versionId, kind }) => ({
      storeId,
      knowledgeBaseId,
      sourceId,
      versionId,
      kind,
    })),
    referenceKey,
  );
  return {
    id: `profile-issue-${digest([
      code,
      category ?? "",
      ...normalizedFactIds,
      ...normalizedSourceRefs.map(referenceKey),
    ]).slice(0, 32)}`,
    code,
    severity,
    status: "open",
    message: message ?? issueMessage(code, category),
    factIds: normalizedFactIds.slice(0, maximumCanonicalCandidateProfileIssueFactReferenceCount),
    sourceRefs: normalizedSourceRefs.slice(
      0,
      maximumCanonicalCandidateProfileIssueSourceReferenceCount,
    ),
  };
}

function conflictCode(fact: CanonicalCandidateProfileFact): CanonicalCandidateProfileIssueCode {
  const field = normalizedSemantic(fact.field);
  if (fact.category === "date") return "conflict-date";
  if (field.includes("title")) return "conflict-title";
  if (field.includes("duration")) return "conflict-duration";
  if (/(?:metric|percentage|percent|amount|count|revenue|users?)/u.test(field)) {
    return "conflict-metric";
  }
  return "conflict-value";
}

function boundedIssueFacts(
  facts: readonly CanonicalCandidateProfileFact[],
): readonly CanonicalCandidateProfileFact[] {
  return [...facts]
    .sort((left, right) => lexicalCompare(left.id, right.id))
    .slice(0, maximumCanonicalCandidateProfileIssueFactReferenceCount);
}

function detectedIssues(
  facts: readonly CanonicalCandidateProfileFact[],
): CanonicalCandidateProfileIssue[] {
  const groups = new Map<string, CanonicalCandidateProfileFact[]>();
  for (const fact of facts) {
    const key = JSON.stringify([
      fact.category,
      fact.subjectId ?? "",
      normalizedSemantic(fact.field),
    ]);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [fact]);
    else group.push(fact);
  }

  const issues: CanonicalCandidateProfileIssue[] = [];
  for (const group of groups.values()) {
    const byValue = new Map<string, CanonicalCandidateProfileFact[]>();
    for (const fact of group) {
      const value = normalizedSemantic(fact.value);
      const duplicates = byValue.get(value);
      if (duplicates === undefined) byValue.set(value, [fact]);
      else duplicates.push(fact);
    }
    for (const duplicates of byValue.values()) {
      if (duplicates.length > 1) {
        const issueFacts = boundedIssueFacts(duplicates);
        issues.push(
          buildIssue(
            "duplicate",
            issueFacts.map((fact) => fact.id),
            issueFacts.flatMap((fact) => fact.provenance),
          ),
        );
      }
    }
    const firstFact = group[0];
    if (byValue.size > 1 && !(firstFact && isCandidateProfileCollectionFact(firstFact))) {
      const issueFacts = boundedIssueFacts(group);
      issues.push(
        buildIssue(
          conflictCode(group[0] as CanonicalCandidateProfileFact),
          issueFacts.map((fact) => fact.id),
          issueFacts.flatMap((fact) => fact.provenance),
        ),
      );
    }
  }

  const presentCategories = new Set(facts.map((fact) => fact.category));
  for (const category of canonicalCandidateProfileFactCategories) {
    if (!presentCategories.has(category)) issues.push(buildIssue("omission", [], [], category));
  }
  return issues;
}

function mapProposal(
  proposal: CanonicalCandidateProfileExtractionProposal,
  referencesByRepresentativeId: ReadonlyMap<
    string,
    readonly CanonicalCandidateProfileProvenanceReference[]
  >,
  droppedFacts: number,
  sources: readonly CanonicalCandidateProfileExtractionMaterial[],
  sourceTextsByRepresentativeId: ReadonlyMap<string, string>,
): CanonicalCandidateProfileExtractionResult {
  const resolveQuote = createCanonicalProfileFactQuoteResolver(
    sources,
    sourceTextsByRepresentativeId,
  );
  const unmergedByKey = new Map<string, CanonicalCandidateProfileFact>();
  const unmergedFacts = proposal.facts.map((candidate) => {
    // Each cited source version keeps the first evidence quote that resolves to an exact span.
    const quotedReferences = new Map<string, CanonicalCandidateProfileFactProvenanceReference>();
    for (const evidence of candidate.evidence) {
      for (const reference of referencesByRepresentativeId.get(evidence.sourceId) ?? []) {
        const key = referenceKey(reference);
        const existing = quotedReferences.get(key);
        if (existing?.quote !== undefined) continue;
        const quote = resolveQuote(evidence.sourceId, reference, evidence.quote);
        quotedReferences.set(
          key,
          quote === undefined ? (existing ?? reference) : { ...reference, quote },
        );
      }
    }
    const provenance = uniqueSorted([...quotedReferences.values()], referenceKey);
    if (provenance.length > maximumCanonicalCandidateProfileProvenanceCount) {
      throw new Error("The extraction proposal cites too many sources for one fact.");
    }
    const normalizedSubjectId = subjectId(candidate.subjectKey);
    const fact: CanonicalCandidateProfileFact = {
      id: factId(candidate, normalizedSubjectId, provenance),
      category: candidate.category,
      ...(normalizedSubjectId === undefined ? {} : { subjectId: normalizedSubjectId }),
      field: candidate.field,
      value: candidate.value,
      provenance: [...provenance],
    };
    unmergedByKey.set(candidate.key, fact);
    return fact;
  });
  const { facts, aliasOf } = mergeIdenticalProfileFacts(
    unmergedFacts,
    maximumCanonicalCandidateProfileProvenanceCount,
  );
  const survivorById = new Map(facts.map((fact) => [fact.id, fact]));
  const factByKey = new Map<string, CanonicalCandidateProfileFact>();
  for (const [key, fact] of unmergedByKey) {
    const survivor = survivorById.get(aliasOf.get(fact.id) ?? fact.id);
    if (survivor !== undefined) factByKey.set(key, survivor);
  }
  if (facts.length > maximumCanonicalCandidateProfileFactCount) {
    throw new CandidateProfileProposalValidationError([
      { code: "profile_too_many_facts", count: 1 },
    ]);
  }

  // Facts that merged into one leave a conflict or duplicate with nothing to compare; drop it.
  const proposedIssues = proposal.issues.flatMap((candidate) => {
    const issueFacts = candidate.factKeys.map((key) => {
      const fact = factByKey.get(key);
      if (fact === undefined)
        throw new Error("The extraction issue references an unavailable fact.");
      return fact;
    });
    const citedReferences = candidate.sourceIds.flatMap((sourceId) => {
      return referencesByRepresentativeId.get(sourceId) ?? [];
    });
    const factIds = issueFacts.map((fact) => fact.id);
    if (!hasEnoughDistinctFactsForIssue(candidate.code, factIds)) return [];
    return [
      buildIssue(candidate.code, factIds, [
        ...citedReferences,
        ...issueFacts.flatMap((fact) => fact.provenance),
      ]),
    ];
  });

  const droppedFactsIssues =
    droppedFacts > 0
      ? [
          buildIssue(
            "omission",
            [],
            candidateSourceReferences(sources),
            undefined,
            "warning",
            droppedFactsMessage(droppedFacts),
          ),
        ]
      : [];
  const issues = uniqueSorted(
    [...proposedIssues, ...detectedIssues(facts), ...droppedFactsIssues],
    (issue) => issue.id,
  );
  if (issues.length > maximumCanonicalCandidateProfileIssueCount) {
    throw new CandidateProfileProposalValidationError([
      { code: "profile_too_many_issues", count: 1 },
    ]);
  }
  return cloneAndFreeze({ facts, issues });
}

export interface ReconcileCanonicalCandidateProfileFactsInput {
  /** Verified facts kept from an earlier profile version; they survive merges with new facts. */
  readonly reusedFacts: readonly CanonicalCandidateProfileFact[];
  /** Earlier-version issues that still hold, kept as they are. */
  readonly carriedIssues: readonly CanonicalCandidateProfileIssue[];
  /** Facts and issues from extracting only the new or changed sources. */
  readonly extracted: CanonicalCandidateProfileExtractionResult;
}

/**
 * Merge reused facts with newly extracted ones and recompute duplicate, conflict, and omission
 * issues over the merged set. Issues the new extraction derived from its own facts alone are
 * discarded; model-proposed and failure issues are kept with fact references following merges.
 */
export function reconcileCanonicalCandidateProfileFacts(
  input: ReconcileCanonicalCandidateProfileFactsInput,
): CanonicalCandidateProfileExtractionResult {
  const derivedFromNewFactsOnly = new Set(
    detectedIssues(input.extracted.facts).map((issue) => issue.id),
  );
  const { facts, aliasOf } = mergeIdenticalProfileFacts(
    [...input.reusedFacts, ...input.extracted.facts],
    maximumCanonicalCandidateProfileProvenanceCount,
  );
  if (facts.length > maximumCanonicalCandidateProfileFactCount) {
    throw new CandidateProfileProposalValidationError([
      { code: "profile_too_many_facts", count: 1 },
    ]);
  }
  const carriedExtractionIssues = input.extracted.issues
    .filter((issue) => !derivedFromNewFactsOnly.has(issue.id))
    .flatMap((issue) => {
      const factIds = [...new Set(issue.factIds.map((id) => aliasOf.get(id) ?? id))];
      if (!hasEnoughDistinctFactsForIssue(issue.code, factIds)) return [];
      return [
        factIds.length === issue.factIds.length &&
        factIds.every((id, index) => id === issue.factIds[index])
          ? issue
          : buildIssue(
              issue.code,
              factIds,
              issue.sourceRefs,
              undefined,
              issue.severity,
              issue.message,
            ),
      ];
    });
  const issues = uniqueSorted(
    [...carriedExtractionIssues, ...input.carriedIssues, ...detectedIssues(facts)],
    (issue) => issue.id,
  );
  if (issues.length > maximumCanonicalCandidateProfileIssueCount) {
    throw new CandidateProfileProposalValidationError([
      { code: "profile_too_many_issues", count: 1 },
    ]);
  }
  return cloneAndFreeze({ facts, issues });
}

function droppedFactsMessage(count: number): string {
  return `${count} extracted fact${count === 1 ? " was" : "s were"} dropped because their evidence quotes were not found in the cited sources. Review the profile for missing facts.`;
}

function candidateSourceReferences(
  sources: readonly CanonicalCandidateProfileExtractionMaterial[],
): readonly CanonicalCandidateProfileProvenanceReference[] {
  return uniqueSorted(
    sources.flatMap((source) => {
      try {
        const reference = canonicalCandidateProfileProvenanceReferenceSchema.parse(
          source.reference,
        );
        return isOpaqueCandidateReference(reference) ? [reference] : [];
      } catch {
        return [];
      }
    }),
    referenceKey,
  );
}

function extractionFailure(
  sources: readonly CanonicalCandidateProfileExtractionMaterial[],
  message: string,
): CanonicalCandidateProfileExtractionResult {
  const references = candidateSourceReferences(sources);
  return cloneAndFreeze({
    facts: [],
    issues: [buildIssue("omission", [], references, undefined, "error", message)],
  });
}

/** Validate and map one provider proposal into application-owned facts and review issues. */
export async function processCanonicalCandidateProfileExtraction(
  port: CanonicalCandidateProfileExtractionPort,
  input: CanonicalCandidateProfileExtractionInput,
): Promise<CanonicalCandidateProfileExtractionResult> {
  if (!isRecord(input) || input.allowProviderData !== true) {
    throw new Error(canonicalCandidateProfileExtractionApprovalErrorMessage);
  }
  let stage: CandidateProfileExtractionStage = "input-preparation";
  try {
    const validated = validateInput(input);
    const preparedSources = prepareCanonicalCandidateProfileExtractionSources(
      validated.request.sources,
      validated.references,
    );
    const grounded = await extractGroundedCanonicalCandidateProfileProposal(
      port,
      Object.freeze({ ...validated.request, sources: preparedSources.sources }),
      preparedSources.referencesByRepresentativeId,
      preparedSources.sourceTextsByRepresentativeId,
      (nextStage) => {
        stage = nextStage;
      },
    );
    const guarded = dropFactsQuotingExcludedText(
      grounded.proposal,
      canonicalProfileQuoteLocatorsByRepresentativeId(
        input.sources,
        preparedSources.referencesByRepresentativeId,
      ),
    );
    return mapProposal(
      guarded.proposal,
      preparedSources.referencesByRepresentativeId,
      grounded.droppedFacts + guarded.droppedFacts,
      input.sources,
      preparedSources.sourceTextsByRepresentativeId,
    );
  } catch (error) {
    if (input.signal?.aborted === true || (error instanceof Error && error.name === "AbortError")) {
      throw error;
    }
    return extractionFailure(
      isRecord(input) && Array.isArray(input.sources)
        ? (input.sources as readonly CanonicalCandidateProfileExtractionMaterial[])
        : [],
      candidateProfileExtractionFailureMessage(error, stage),
    );
  }
}
