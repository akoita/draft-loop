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
  type CanonicalCandidateProfileIssue,
  type CanonicalCandidateProfileProvenanceReference,
  canonicalCandidateProfileExtractionProposalSchema,
  canonicalCandidateProfileProvenanceReferenceSchema,
} from "@draft-loop/schemas";

/** Maximum exact CKB source versions sent through one extraction operation. */
export const maximumCanonicalCandidateProfileExtractionSources = 64;
/** Maximum normalized text sent for one exact source version. */
export const maximumCanonicalCandidateProfileExtractionSourceCharacters = 128 * 1024;
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
}

export interface CanonicalCandidateProfileExtractionRequest {
  readonly operationId: string;
  readonly sources: readonly CanonicalCandidateProfileExtractionSource[];
  readonly signal?: AbortSignal;
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

function normalizedSemantic(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function referenceKey(reference: CanonicalCandidateProfileProvenanceReference): string {
  return JSON.stringify([
    reference.storeId,
    reference.knowledgeBaseId,
    reference.sourceId,
    reference.versionId,
    reference.kind,
  ]);
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

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted<T>(values: readonly T[], key: (value: T) => string): readonly T[] {
  const entries = new Map<string, T>();
  for (const value of values) entries.set(key(value), value);
  return [...entries.entries()]
    .sort(([left], [right]) => lexicalCompare(left, right))
    .map(([, value]) => value);
}

function validateInput(input: CanonicalCandidateProfileExtractionInput): {
  readonly request: CanonicalCandidateProfileExtractionRequest;
  readonly references: ReadonlyMap<string, CanonicalCandidateProfileProvenanceReference>;
  readonly sourceTexts: ReadonlyMap<string, string>;
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
  const ids = new Set<string>();
  const references = new Map<string, CanonicalCandidateProfileProvenanceReference>();
  const sourceTexts = new Map<string, string>();
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
      typeof source.text !== "string" ||
      source.text.trim().length === 0 ||
      source.text.length > maximumCanonicalCandidateProfileExtractionSourceCharacters
    ) {
      throw new Error("The canonical candidate profile extraction source is invalid.");
    }
    const reference = canonicalCandidateProfileProvenanceReferenceSchema.parse(source.reference);
    if (!isOpaqueCandidateReference(reference)) {
      throw new Error("Canonical profile extraction requires candidate-provided CKB material.");
    }
    ids.add(source.id);
    references.set(source.id, reference);
    sourceTexts.set(source.id, source.text);
    characterCount += source.text.length;
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
    throw new Error("The canonical candidate profile extraction input exceeds the size limit.");
  }
  return {
    request: Object.freeze({
      operationId: input.operationId,
      sources: Object.freeze(sources),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
    references,
    sourceTexts,
  };
}

function quoteSupportsValue(quote: string, sourceText: string, value: string): boolean {
  const normalizedQuote = normalizedSemantic(quote);
  const normalizedValue = normalizedSemantic(value);
  return (
    normalizedQuote.length > 0 &&
    normalizedValue.length > 0 &&
    normalizedSemantic(sourceText).includes(normalizedQuote) &&
    normalizedQuote.includes(normalizedValue)
  );
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
): CanonicalCandidateProfileIssue {
  const normalizedFactIds = [...new Set(factIds)].sort(lexicalCompare);
  const normalizedSourceRefs = uniqueSorted(sourceRefs, referenceKey);
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
    message: issueMessage(code, category),
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
    if (byValue.size > 1) {
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
  references: ReadonlyMap<string, CanonicalCandidateProfileProvenanceReference>,
  sourceTexts: ReadonlyMap<string, string>,
): CanonicalCandidateProfileExtractionResult {
  const factByKey = new Map<string, CanonicalCandidateProfileFact>();
  const facts = proposal.facts.map((candidate) => {
    const provenance = uniqueSorted(
      candidate.evidence.map((evidence) => {
        const reference = references.get(evidence.sourceId);
        const sourceText = sourceTexts.get(evidence.sourceId);
        if (reference === undefined)
          throw new Error("The extraction proposal cites an unavailable source.");
        if (
          sourceText === undefined ||
          !quoteSupportsValue(evidence.quote, sourceText, candidate.value)
        ) {
          throw new Error("The extraction proposal evidence does not support its proposed value.");
        }
        return reference;
      }),
      referenceKey,
    );
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
    factByKey.set(candidate.key, fact);
    return fact;
  });
  if (facts.length > maximumCanonicalCandidateProfileFactCount) {
    throw new Error("The extraction proposal contains too many facts.");
  }

  const proposedIssues = proposal.issues.map((candidate) => {
    const issueFacts = candidate.factKeys.map((key) => {
      const fact = factByKey.get(key);
      if (fact === undefined)
        throw new Error("The extraction issue references an unavailable fact.");
      return fact;
    });
    const citedReferences = candidate.sourceIds.map((sourceId) => {
      const reference = references.get(sourceId);
      if (reference === undefined)
        throw new Error("The extraction issue cites an unavailable source.");
      return reference;
    });
    return buildIssue(
      candidate.code,
      issueFacts.map((fact) => fact.id),
      [...citedReferences, ...issueFacts.flatMap((fact) => fact.provenance)],
    );
  });

  const issues = uniqueSorted([...proposedIssues, ...detectedIssues(facts)], (issue) => issue.id);
  if (issues.length > maximumCanonicalCandidateProfileIssueCount) {
    throw new Error("The extraction proposal produces too many review issues.");
  }
  return cloneAndFreeze({ facts, issues });
}

function extractionFailure(
  sources: readonly CanonicalCandidateProfileExtractionMaterial[],
): CanonicalCandidateProfileExtractionResult {
  const references = uniqueSorted(
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
  return cloneAndFreeze({
    facts: [],
    issues: [buildIssue("omission", [], references, undefined, "error")],
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
  try {
    const validated = validateInput(input);
    const proposal = canonicalCandidateProfileExtractionProposalSchema.parse(
      await port.extract(validated.request),
    );
    return mapProposal(proposal, validated.references, validated.sourceTexts);
  } catch (error) {
    if (input.signal?.aborted === true || (error instanceof Error && error.name === "AbortError")) {
      throw error;
    }
    return extractionFailure(
      isRecord(input) && Array.isArray(input.sources)
        ? (input.sources as readonly CanonicalCandidateProfileExtractionMaterial[])
        : [],
    );
  }
}
