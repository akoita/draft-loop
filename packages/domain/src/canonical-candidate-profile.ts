import {
  type CandidateKnowledgeBaseId,
  type CandidateKnowledgeSelectionSnapshot,
  type CandidateKnowledgeSelectionSnapshotInput,
  type CandidateKnowledgeSourceId,
  type CandidateKnowledgeSourceVersionId,
  type CandidateKnowledgeStoreId,
  type CanonicalCandidateProfileId,
  createCandidateKnowledgeSelectionSnapshot,
  SemanticValidationError,
  type SemanticValidationIssue,
  type SemanticValidationResult,
  validateCandidateKnowledgeSelectionSnapshot,
} from "./index.js";
import {
  addIssue,
  cloneAndFreeze,
  isIsoTimestamp,
  isNonEmptyString,
  isRecord,
  isSafePositiveInteger,
} from "./semantic-validation-helpers.js";
import { type SourceSensitivityTier, sourceSensitivityTiers } from "./source-sensitivity.js";

/** Version of the provider-independent canonical candidate profile contract. */
export const canonicalCandidateProfileSchemaVersion = 1 as const;
export type CanonicalCandidateProfileSchemaVersion = typeof canonicalCandidateProfileSchemaVersion;

/** Version of the provider-facing canonical candidate profile extraction proposal. */
export const canonicalCandidateProfileExtractionSchemaVersion = 1 as const;
export type CanonicalCandidateProfileExtractionSchemaVersion =
  typeof canonicalCandidateProfileExtractionSchemaVersion;

export const canonicalCandidateProfileStatuses = ["draft", "reviewed"] as const;
export type CanonicalCandidateProfileStatus = (typeof canonicalCandidateProfileStatuses)[number];

/**
 * The profile deliberately uses one bounded fact shape rather than a rigid CV
 * document. New facts remain auditable because their category, field, value,
 * and exact source-version references are persisted together.
 */
export const canonicalCandidateProfileFactCategories = [
  "identity",
  "contact",
  "role",
  "employer",
  "date",
  "achievement",
  "project",
  "skill",
  "certification",
  "education",
  "language",
  "approved-link",
] as const;
export type CanonicalCandidateProfileFactCategory =
  (typeof canonicalCandidateProfileFactCategories)[number];

/** Exact, path-free origins allowed for a canonical profile fact. */
export const canonicalCandidateProfileProvenanceKinds = [
  "candidate-provided",
  "public-corroboration",
] as const;
export type CanonicalCandidateProfileProvenanceKind =
  (typeof canonicalCandidateProfileProvenanceKinds)[number];

/** Visible issue classes; no conflict is silently resolved into a value. */
export const canonicalCandidateProfileIssueCodes = [
  "conflict-date",
  "conflict-title",
  "conflict-duration",
  "conflict-metric",
  "conflict-value",
  "duplicate",
  "omission",
] as const;
export type CanonicalCandidateProfileIssueCode =
  (typeof canonicalCandidateProfileIssueCodes)[number];

export const canonicalCandidateProfileIssueSeverities = ["error", "warning"] as const;
export type CanonicalCandidateProfileIssueSeverity =
  (typeof canonicalCandidateProfileIssueSeverities)[number];

export const canonicalCandidateProfileIssueStatuses = ["open", "acknowledged", "resolved"] as const;
export type CanonicalCandidateProfileIssueStatus =
  (typeof canonicalCandidateProfileIssueStatuses)[number];

/** Bounds keep a profile useful for a career history while keeping persistence predictable. */
export const maximumCanonicalCandidateProfileIdLength = 120 as const;
export const maximumCanonicalCandidateProfileFactCount = 2_048 as const;
export const maximumCanonicalCandidateProfileIssueCount = 1_024 as const;
export const maximumCanonicalCandidateProfileProvenanceCount = 32 as const;
export const maximumCanonicalCandidateProfileIssueFactReferenceCount = 64 as const;
export const maximumCanonicalCandidateProfileIssueSourceReferenceCount = 64 as const;
export const maximumCanonicalCandidateProfileFactIdLength = 120 as const;
export const maximumCanonicalCandidateProfileSubjectIdLength = 120 as const;
export const maximumCanonicalCandidateProfileFieldLength = 120 as const;
export const maximumCanonicalCandidateProfileValueLength = 2_000 as const;
/** An evidence quote is bounded like a fact value, the same bound the extraction proposal uses. */
export const maximumCanonicalCandidateProfileProvenanceQuoteLength =
  maximumCanonicalCandidateProfileValueLength;
export const maximumCanonicalCandidateProfileIssueMessageLength = 400 as const;

export interface CanonicalCandidateProfileProvenanceReferenceInput {
  readonly storeId: string;
  readonly knowledgeBaseId: string;
  readonly sourceId: string;
  readonly versionId: string;
  readonly kind: CanonicalCandidateProfileProvenanceKind;
}

export interface CanonicalCandidateProfileProvenanceReference {
  readonly storeId: CandidateKnowledgeStoreId;
  readonly knowledgeBaseId: CandidateKnowledgeBaseId;
  readonly sourceId: CandidateKnowledgeSourceId;
  readonly versionId: CandidateKnowledgeSourceVersionId;
  readonly kind: CanonicalCandidateProfileProvenanceKind;
}

export type CanonicalCandidateProfileSourceReference = CanonicalCandidateProfileProvenanceReference;

/**
 * Only fact provenance may keep the exact grounded source quote for its cited source version; issue
 * source references never carry one. The quote is not part of the reference identity.
 */
export interface CanonicalCandidateProfileFactProvenanceReferenceInput
  extends CanonicalCandidateProfileProvenanceReferenceInput {
  readonly quote?: string;
}

export interface CanonicalCandidateProfileFactProvenanceReference
  extends CanonicalCandidateProfileProvenanceReference {
  readonly quote?: string;
}

export interface CanonicalCandidateProfileFactInput {
  readonly id: string;
  readonly category: CanonicalCandidateProfileFactCategory;
  readonly subjectId?: string;
  readonly field: string;
  readonly value: string;
  readonly provenance: readonly CanonicalCandidateProfileFactProvenanceReferenceInput[];
}

export interface CanonicalCandidateProfileFact {
  readonly id: string;
  readonly category: CanonicalCandidateProfileFactCategory;
  readonly subjectId?: string;
  readonly field: string;
  readonly value: string;
  readonly provenance: readonly CanonicalCandidateProfileFactProvenanceReference[];
}

export interface CanonicalCandidateProfileIssueInput {
  readonly id: string;
  readonly code: CanonicalCandidateProfileIssueCode;
  readonly severity: CanonicalCandidateProfileIssueSeverity;
  readonly status: CanonicalCandidateProfileIssueStatus;
  readonly message: string;
  readonly factIds?: readonly string[];
  readonly sourceRefs?: readonly CanonicalCandidateProfileProvenanceReferenceInput[];
}

export interface CanonicalCandidateProfileIssue {
  readonly id: string;
  readonly code: CanonicalCandidateProfileIssueCode;
  readonly severity: CanonicalCandidateProfileIssueSeverity;
  readonly status: CanonicalCandidateProfileIssueStatus;
  readonly message: string;
  readonly factIds: readonly string[];
  readonly sourceRefs: readonly CanonicalCandidateProfileProvenanceReference[];
}

export const maximumCanonicalCandidateProfileExtractionIdentityLength = 200 as const;

/** The extraction profile that shaped one extraction route, when the model has one. */
export interface CanonicalCandidateProfileExtractionProfileIdentity {
  readonly id: string;
  readonly version: number;
}

export const maximumCanonicalCandidateProfileSensitivityRuleCount = 200 as const;

/** The sensitivity rules version that filtered one knowledge base's sources. */
export interface CanonicalCandidateProfileSensitivityRulesIdentity {
  readonly storeId: string;
  readonly knowledgeBaseId: string;
  readonly rulesVersion: number;
  /** Lowercase SHA-256 hex of the canonical rules, as the store records it. */
  readonly rulesChecksum: string;
}

/**
 * The sensitivity filtering behind one extraction: the tiers kept out of provider requests and the
 * rules versions applied per knowledge base. An empty `rules` list records that no rules applied.
 */
export interface CanonicalCandidateProfileSensitivityIdentity {
  readonly excludedTiers: readonly SourceSensitivityTier[];
  readonly rules: readonly CanonicalCandidateProfileSensitivityRulesIdentity[];
}

/**
 * Which model and prompt extracted a profile version. It lets a later derivation reuse facts only
 * when they came from the same route; it carries no source text, path, or credential.
 */
export interface CanonicalCandidateProfileExtractionIdentity {
  readonly company: string;
  readonly modelId: string;
  readonly promptTemplateVersion: string;
  readonly extractionProfile?: CanonicalCandidateProfileExtractionProfileIdentity;
  /** Optional so versions recorded before sensitivity filtering was tracked stay valid. */
  readonly sensitivity?: CanonicalCandidateProfileSensitivityIdentity;
}

export interface CanonicalCandidateProfileInput {
  readonly schemaVersion?: number;
  readonly id: string;
  readonly version: number;
  readonly parentVersion: number | null;
  readonly status: CanonicalCandidateProfileStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly reviewedAt?: string;
  /** Optional for an empty draft; required whenever facts are present. */
  readonly candidateKnowledgeSelection?: CandidateKnowledgeSelectionSnapshotInput;
  /** Optional so profile versions created before extraction identity was recorded stay valid. */
  readonly extraction?: CanonicalCandidateProfileExtractionIdentity;
  readonly facts: readonly CanonicalCandidateProfileFactInput[];
  readonly issues?: readonly CanonicalCandidateProfileIssueInput[];
}

export interface CanonicalCandidateProfile {
  readonly schemaVersion: CanonicalCandidateProfileSchemaVersion;
  readonly id: CanonicalCandidateProfileId;
  readonly version: number;
  readonly parentVersion: number | null;
  readonly status: CanonicalCandidateProfileStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly reviewedAt?: string;
  readonly candidateKnowledgeSelection?: CandidateKnowledgeSelectionSnapshot;
  readonly extraction?: CanonicalCandidateProfileExtractionIdentity;
  readonly facts: readonly CanonicalCandidateProfileFact[];
  readonly issues: readonly CanonicalCandidateProfileIssue[];
}

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
  "extraction",
  "facts",
  "issues",
]);
const canonicalCandidateProfileExtractionKeys = new Set([
  "company",
  "modelId",
  "promptTemplateVersion",
  "extractionProfile",
  "sensitivity",
]);
const canonicalCandidateProfileExtractionProfileKeys = new Set(["id", "version"]);
const canonicalCandidateProfileSensitivityKeys = new Set(["excludedTiers", "rules"]);
const canonicalCandidateProfileSensitivityRuleKeys = new Set([
  "storeId",
  "knowledgeBaseId",
  "rulesVersion",
  "rulesChecksum",
]);
const canonicalCandidateProfileRulesChecksumPattern = /^[0-9a-f]{64}$/u;
const canonicalCandidateProfileFactKeys = new Set([
  "id",
  "category",
  "subjectId",
  "field",
  "value",
  "provenance",
]);
const canonicalCandidateProfileProvenanceKeys = new Set([
  "storeId",
  "knowledgeBaseId",
  "sourceId",
  "versionId",
  "kind",
]);
const canonicalCandidateProfileFactProvenanceKeys = new Set([
  ...canonicalCandidateProfileProvenanceKeys,
  "quote",
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
const canonicalCandidateProfileSelectionKeys = new Set(["schemaVersion", "capturedAt", "entries"]);
const canonicalCandidateProfileSelectionEntryKeys = new Set([
  "storeId",
  "knowledgeBaseId",
  "sources",
]);
const canonicalCandidateProfileSelectionSourceKeys = new Set([
  "sourceId",
  "versionId",
  "lifecycleRevision",
]);
const canonicalCandidateProfileSelectionRevisionKeys = new Set([
  "knowledgeBaseState",
  "knowledgeBaseArchivedAt",
  "versionId",
  "version",
  "createdAt",
  "managed",
  "originBoundAt",
  "observation",
  "retirement",
  "provenanceFetchedAt",
  "directory",
]);
const canonicalCandidateProfileSelectionObservationKeys = new Set([
  "observedVersionId",
  "status",
  "checkedAt",
  "lastRefreshedVersionId",
  "lastRefreshedAt",
  "stale",
]);
const canonicalCandidateProfileSelectionRetirementKeys = new Set(["retiredAt", "reason"]);
const canonicalCandidateProfileSelectionDirectoryKeys = new Set([
  "directoryId",
  "rootRevision",
  "rootBoundAt",
  "memberRevision",
  "memberBoundAt",
]);
const canonicalCandidateProfileIssueCodesRequiringMultipleFacts: ReadonlySet<CanonicalCandidateProfileIssueCode> =
  new Set([
    "conflict-date",
    "conflict-title",
    "conflict-duration",
    "conflict-metric",
    "conflict-value",
    "duplicate",
  ] as const);

function canonicalCandidateProfileReferenceKey(
  reference: Pick<
    CanonicalCandidateProfileProvenanceReferenceInput,
    "storeId" | "knowledgeBaseId" | "sourceId" | "versionId"
  >,
): string {
  return JSON.stringify([
    reference.storeId.trim(),
    reference.knowledgeBaseId.trim(),
    reference.sourceId.trim(),
    reference.versionId.trim(),
  ]);
}

function canonicalCandidateProfileReferenceSortKey(
  reference: CanonicalCandidateProfileProvenanceReference,
): string {
  return `${canonicalCandidateProfileReferenceKey(reference)}\u0000${reference.kind}`;
}

function compareCanonicalCandidateProfileStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateCanonicalCandidateProfileKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  field: string,
  issues: SemanticValidationIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      addIssue(issues, "invalid-value", `${field}.${key}`, "is not supported.");
    }
  }
}

function validateCanonicalCandidateProfileSelectionShape(
  value: unknown,
  field: string,
  issues: SemanticValidationIssue[],
): void {
  if (!isRecord(value)) return;
  validateCanonicalCandidateProfileKeys(
    value,
    canonicalCandidateProfileSelectionKeys,
    field,
    issues,
  );
  if (!Array.isArray(value.entries)) return;
  for (const [entryIndex, entryValue] of value.entries.entries()) {
    const entryField = `${field}.entries[${entryIndex}]`;
    if (!isRecord(entryValue)) continue;
    validateCanonicalCandidateProfileKeys(
      entryValue,
      canonicalCandidateProfileSelectionEntryKeys,
      entryField,
      issues,
    );
    if (!Array.isArray(entryValue.sources)) continue;
    for (const [sourceIndex, sourceValue] of entryValue.sources.entries()) {
      const sourceField = `${entryField}.sources[${sourceIndex}]`;
      if (!isRecord(sourceValue)) continue;
      validateCanonicalCandidateProfileKeys(
        sourceValue,
        canonicalCandidateProfileSelectionSourceKeys,
        sourceField,
        issues,
      );
      const revision = sourceValue.lifecycleRevision;
      if (!isRecord(revision)) continue;
      const revisionField = `${sourceField}.lifecycleRevision`;
      validateCanonicalCandidateProfileKeys(
        revision,
        canonicalCandidateProfileSelectionRevisionKeys,
        revisionField,
        issues,
      );
      if (isRecord(revision.observation)) {
        validateCanonicalCandidateProfileKeys(
          revision.observation,
          canonicalCandidateProfileSelectionObservationKeys,
          `${revisionField}.observation`,
          issues,
        );
      }
      if (isRecord(revision.retirement)) {
        validateCanonicalCandidateProfileKeys(
          revision.retirement,
          canonicalCandidateProfileSelectionRetirementKeys,
          `${revisionField}.retirement`,
          issues,
        );
      }
      if (isRecord(revision.directory)) {
        validateCanonicalCandidateProfileKeys(
          revision.directory,
          canonicalCandidateProfileSelectionDirectoryKeys,
          `${revisionField}.directory`,
          issues,
        );
      }
    }
  }
}

function validateCanonicalCandidateProfileBoundedText(
  value: unknown,
  field: string,
  maximum: number,
  issues: SemanticValidationIssue[],
): value is string {
  if (!isNonEmptyString(value)) {
    addIssue(issues, "invalid-value", field, "must be a non-empty string.");
    return false;
  }
  if ([...value.trim()].length > maximum) {
    addIssue(issues, "invalid-value", field, `must be at most ${maximum} characters.`);
  }
  return true;
}

function validateCanonicalCandidateProfileProvenanceReference(
  value: unknown,
  field: string,
  issues: SemanticValidationIssue[],
  selectionReferences: ReadonlySet<string> | undefined,
  allowQuote = false,
): value is CanonicalCandidateProfileProvenanceReferenceInput {
  if (!isRecord(value)) {
    addIssue(issues, "invalid-value", field, "must be a provenance reference object.");
    return false;
  }
  validateCanonicalCandidateProfileKeys(
    value,
    allowQuote
      ? canonicalCandidateProfileFactProvenanceKeys
      : canonicalCandidateProfileProvenanceKeys,
    field,
    issues,
  );
  if (allowQuote && value.quote !== undefined) {
    validateCanonicalCandidateProfileBoundedText(
      value.quote,
      `${field}.quote`,
      maximumCanonicalCandidateProfileProvenanceQuoteLength,
      issues,
    );
  }
  const reference = value as Partial<CanonicalCandidateProfileProvenanceReferenceInput>;
  const identifiers = [
    ["storeId", reference.storeId],
    ["knowledgeBaseId", reference.knowledgeBaseId],
    ["sourceId", reference.sourceId],
    ["versionId", reference.versionId],
  ] as const;
  for (const [key, identifier] of identifiers) {
    validateCanonicalCandidateProfileBoundedText(
      identifier,
      `${field}.${key}`,
      maximumCanonicalCandidateProfileIdLength,
      issues,
    );
  }
  if (
    !canonicalCandidateProfileProvenanceKinds.includes(
      reference.kind as CanonicalCandidateProfileProvenanceKind,
    )
  ) {
    addIssue(
      issues,
      "invalid-value",
      `${field}.kind`,
      "must be candidate-provided or public-corroboration.",
    );
  }
  if (
    selectionReferences !== undefined &&
    identifiers.every(([, identifier]) => isNonEmptyString(identifier)) &&
    !selectionReferences.has(
      canonicalCandidateProfileReferenceKey(
        reference as CanonicalCandidateProfileProvenanceReferenceInput,
      ),
    )
  ) {
    addIssue(
      issues,
      "invalid-value",
      field,
      "must reference an exact source version in candidateKnowledgeSelection.",
    );
  }
  return true;
}

function candidateKnowledgeSelectionReferences(
  selection: CandidateKnowledgeSelectionSnapshot,
): Set<string> {
  return new Set(
    selection.entries.flatMap((entry) =>
      entry.sources.map((source) =>
        canonicalCandidateProfileReferenceKey({
          storeId: entry.storeId,
          knowledgeBaseId: entry.knowledgeBaseId,
          sourceId: source.sourceId,
          versionId: source.versionId,
        }),
      ),
    ),
  );
}

function validateCanonicalCandidateProfileFact(
  value: unknown,
  field: string,
  issues: SemanticValidationIssue[],
  selectionReferences: ReadonlySet<string> | undefined,
): value is CanonicalCandidateProfileFactInput {
  if (!isRecord(value)) {
    addIssue(issues, "invalid-value", field, "must be a fact object.");
    return false;
  }
  validateCanonicalCandidateProfileKeys(value, canonicalCandidateProfileFactKeys, field, issues);
  const fact = value as Partial<CanonicalCandidateProfileFactInput>;
  validateCanonicalCandidateProfileBoundedText(
    fact.id,
    `${field}.id`,
    maximumCanonicalCandidateProfileFactIdLength,
    issues,
  );
  if (
    !canonicalCandidateProfileFactCategories.includes(
      fact.category as CanonicalCandidateProfileFactCategory,
    )
  ) {
    addIssue(
      issues,
      "invalid-value",
      `${field}.category`,
      "must be a recognized profile fact category.",
    );
  }
  if (fact.subjectId !== undefined) {
    validateCanonicalCandidateProfileBoundedText(
      fact.subjectId,
      `${field}.subjectId`,
      maximumCanonicalCandidateProfileSubjectIdLength,
      issues,
    );
  }
  validateCanonicalCandidateProfileBoundedText(
    fact.field,
    `${field}.field`,
    maximumCanonicalCandidateProfileFieldLength,
    issues,
  );
  validateCanonicalCandidateProfileBoundedText(
    fact.value,
    `${field}.value`,
    maximumCanonicalCandidateProfileValueLength,
    issues,
  );
  if (!Array.isArray(fact.provenance) || fact.provenance.length === 0) {
    addIssue(
      issues,
      "invalid-value",
      `${field}.provenance`,
      "must contain at least one exact provenance reference.",
    );
    return true;
  }
  if (fact.provenance.length > maximumCanonicalCandidateProfileProvenanceCount) {
    addIssue(
      issues,
      "invalid-value",
      `${field}.provenance`,
      `must contain at most ${maximumCanonicalCandidateProfileProvenanceCount} references.`,
    );
  }
  const references = new Set<string>();
  let hasCandidateProvidedReference = false;
  for (const [index, reference] of fact.provenance.entries()) {
    const referenceField = `${field}.provenance[${index}]`;
    const validReference = validateCanonicalCandidateProfileProvenanceReference(
      reference,
      referenceField,
      issues,
      selectionReferences,
      true,
    );
    if (!validReference || !isRecord(reference)) continue;
    const candidateReference =
      reference as Partial<CanonicalCandidateProfileProvenanceReferenceInput>;
    if (candidateReference.kind === "candidate-provided") hasCandidateProvidedReference = true;
    if (
      isNonEmptyString(candidateReference.storeId) &&
      isNonEmptyString(candidateReference.knowledgeBaseId) &&
      isNonEmptyString(candidateReference.sourceId) &&
      isNonEmptyString(candidateReference.versionId) &&
      canonicalCandidateProfileProvenanceKinds.includes(
        candidateReference.kind as CanonicalCandidateProfileProvenanceKind,
      )
    ) {
      const referenceKey = `${canonicalCandidateProfileReferenceKey(candidateReference as CanonicalCandidateProfileProvenanceReferenceInput)}\u0000${candidateReference.kind}`;
      if (references.has(referenceKey)) {
        addIssue(
          issues,
          "invalid-value",
          `${referenceField}`,
          "provenance references must be unique.",
        );
      }
      references.add(referenceKey);
    }
  }
  if (!hasCandidateProvidedReference) {
    addIssue(
      issues,
      "invalid-value",
      `${field}.provenance`,
      "must include at least one candidate-provided reference.",
    );
  }
  return true;
}

function validateCanonicalCandidateProfileIssue(
  value: unknown,
  field: string,
  issues: SemanticValidationIssue[],
  factsById: ReadonlyMap<string, CanonicalCandidateProfileFactInput>,
  selectionReferences: ReadonlySet<string> | undefined,
): value is CanonicalCandidateProfileIssueInput {
  if (!isRecord(value)) {
    addIssue(issues, "invalid-value", field, "must be an issue object.");
    return false;
  }
  validateCanonicalCandidateProfileKeys(value, canonicalCandidateProfileIssueKeys, field, issues);
  const issue = value as Partial<CanonicalCandidateProfileIssueInput>;
  validateCanonicalCandidateProfileBoundedText(
    issue.id,
    `${field}.id`,
    maximumCanonicalCandidateProfileFactIdLength,
    issues,
  );
  if (
    !canonicalCandidateProfileIssueCodes.includes(issue.code as CanonicalCandidateProfileIssueCode)
  ) {
    addIssue(issues, "invalid-value", `${field}.code`, "must be a recognized profile issue code.");
  }
  if (
    !canonicalCandidateProfileIssueSeverities.includes(
      issue.severity as CanonicalCandidateProfileIssueSeverity,
    )
  ) {
    addIssue(issues, "invalid-value", `${field}.severity`, "must be error or warning.");
  }
  if (
    !canonicalCandidateProfileIssueStatuses.includes(
      issue.status as CanonicalCandidateProfileIssueStatus,
    )
  ) {
    addIssue(
      issues,
      "invalid-value",
      `${field}.status`,
      "must be open, acknowledged, or resolved.",
    );
  }
  validateCanonicalCandidateProfileBoundedText(
    issue.message,
    `${field}.message`,
    maximumCanonicalCandidateProfileIssueMessageLength,
    issues,
  );
  const normalizedFactIds = new Set<string>();
  const requiresMultipleFacts = canonicalCandidateProfileIssueCodesRequiringMultipleFacts.has(
    issue.code as CanonicalCandidateProfileIssueCode,
  );
  if (issue.factIds !== undefined) {
    if (!Array.isArray(issue.factIds)) {
      addIssue(issues, "invalid-value", `${field}.factIds`, "must be an array when provided.");
    } else {
      if (issue.factIds.length > maximumCanonicalCandidateProfileIssueFactReferenceCount) {
        addIssue(
          issues,
          "invalid-value",
          `${field}.factIds`,
          `must contain at most ${maximumCanonicalCandidateProfileIssueFactReferenceCount} ids.`,
        );
      }
      for (const [index, factId] of issue.factIds.entries()) {
        const factField = `${field}.factIds[${index}]`;
        if (
          !validateCanonicalCandidateProfileBoundedText(
            factId,
            factField,
            maximumCanonicalCandidateProfileFactIdLength,
            issues,
          )
        ) {
          continue;
        }
        const normalizedFactId = factId.trim();
        if (normalizedFactIds.has(normalizedFactId)) {
          addIssue(issues, "invalid-value", factField, "fact ids must be unique.");
        }
        normalizedFactIds.add(normalizedFactId);
        if (!factsById.has(normalizedFactId)) {
          addIssue(issues, "invalid-value", factField, "must reference an existing profile fact.");
        }
      }
    }
  }
  if (requiresMultipleFacts && normalizedFactIds.size < 2) {
    addIssue(
      issues,
      "invalid-value",
      `${field}.factIds`,
      "conflict and duplicate issues must involve at least two distinct profile facts.",
    );
  }
  const relatedSourceReferences = new Set<string>();
  for (const factId of normalizedFactIds) {
    const fact = factsById.get(factId);
    if (fact === undefined || !Array.isArray(fact.provenance)) continue;
    for (const reference of fact.provenance) {
      if (!isRecord(reference)) continue;
      const candidateReference =
        reference as Partial<CanonicalCandidateProfileProvenanceReferenceInput>;
      if (
        isNonEmptyString(candidateReference.storeId) &&
        isNonEmptyString(candidateReference.knowledgeBaseId) &&
        isNonEmptyString(candidateReference.sourceId) &&
        isNonEmptyString(candidateReference.versionId) &&
        canonicalCandidateProfileProvenanceKinds.includes(
          candidateReference.kind as CanonicalCandidateProfileProvenanceKind,
        )
      ) {
        relatedSourceReferences.add(
          `${canonicalCandidateProfileReferenceKey(candidateReference as CanonicalCandidateProfileProvenanceReferenceInput)}\u0000${candidateReference.kind}`,
        );
      }
    }
  }
  if (issue.sourceRefs !== undefined) {
    if (!Array.isArray(issue.sourceRefs)) {
      addIssue(issues, "invalid-value", `${field}.sourceRefs`, "must be an array when provided.");
    } else {
      if (issue.sourceRefs.length > maximumCanonicalCandidateProfileIssueSourceReferenceCount) {
        addIssue(
          issues,
          "invalid-value",
          `${field}.sourceRefs`,
          `must contain at most ${maximumCanonicalCandidateProfileIssueSourceReferenceCount} references.`,
        );
      }
      const sourceReferences = new Set<string>();
      for (const [index, reference] of issue.sourceRefs.entries()) {
        const referenceField = `${field}.sourceRefs[${index}]`;
        const validReference = validateCanonicalCandidateProfileProvenanceReference(
          reference,
          referenceField,
          issues,
          selectionReferences,
        );
        if (!validReference || !isRecord(reference)) continue;
        const candidateReference =
          reference as Partial<CanonicalCandidateProfileProvenanceReferenceInput>;
        if (
          isNonEmptyString(candidateReference.storeId) &&
          isNonEmptyString(candidateReference.knowledgeBaseId) &&
          isNonEmptyString(candidateReference.sourceId) &&
          isNonEmptyString(candidateReference.versionId) &&
          canonicalCandidateProfileProvenanceKinds.includes(
            candidateReference.kind as CanonicalCandidateProfileProvenanceKind,
          )
        ) {
          const referenceKey = `${canonicalCandidateProfileReferenceKey(candidateReference as CanonicalCandidateProfileProvenanceReferenceInput)}\u0000${candidateReference.kind}`;
          if (sourceReferences.has(referenceKey)) {
            addIssue(issues, "invalid-value", referenceField, "source references must be unique.");
          }
          sourceReferences.add(referenceKey);
          if (requiresMultipleFacts && !relatedSourceReferences.has(referenceKey)) {
            addIssue(
              issues,
              "invalid-value",
              referenceField,
              "must reference a provenance source on one of the involved profile facts.",
            );
          }
        }
      }
    }
  }
  if (
    issue.sourceRefs !== undefined &&
    Array.isArray(issue.sourceRefs) &&
    issue.sourceRefs.length > 0 &&
    selectionReferences === undefined
  ) {
    addIssue(
      issues,
      "invalid-value",
      `${field}.sourceRefs`,
      "requires a bound candidateKnowledgeSelection.",
    );
  }
  return true;
}

function validateCanonicalCandidateProfileSensitivity(
  value: unknown,
  field: string,
  issues: SemanticValidationIssue[],
): void {
  if (!isRecord(value)) {
    addIssue(issues, "invalid-value", field, "must be an object when provided.");
    return;
  }
  validateCanonicalCandidateProfileKeys(
    value,
    canonicalCandidateProfileSensitivityKeys,
    field,
    issues,
  );
  const tiers = value.excludedTiers;
  if (!Array.isArray(tiers)) {
    addIssue(issues, "invalid-value", `${field}.excludedTiers`, "must be an array.");
  } else {
    const seen = new Set<unknown>();
    tiers.forEach((tier, index) => {
      if (!sourceSensitivityTiers.includes(tier as SourceSensitivityTier)) {
        addIssue(
          issues,
          "invalid-value",
          `${field}.excludedTiers[${index}]`,
          "must be a known sensitivity tier.",
        );
      } else if (seen.has(tier)) {
        addIssue(issues, "invalid-value", `${field}.excludedTiers[${index}]`, "must be unique.");
      }
      seen.add(tier);
    });
  }
  const rules = value.rules;
  if (!Array.isArray(rules)) {
    addIssue(issues, "invalid-value", `${field}.rules`, "must be an array.");
    return;
  }
  if (rules.length > maximumCanonicalCandidateProfileSensitivityRuleCount) {
    addIssue(
      issues,
      "invalid-value",
      `${field}.rules`,
      `must have at most ${maximumCanonicalCandidateProfileSensitivityRuleCount} entries.`,
    );
  }
  const seenBases = new Set<string>();
  rules.forEach((rule: unknown, index) => {
    const ruleField = `${field}.rules[${index}]`;
    if (!isRecord(rule)) {
      addIssue(issues, "invalid-value", ruleField, "must be an object.");
      return;
    }
    validateCanonicalCandidateProfileKeys(
      rule,
      canonicalCandidateProfileSensitivityRuleKeys,
      ruleField,
      issues,
    );
    const validIds = (["storeId", "knowledgeBaseId"] as const).map((key) =>
      validateCanonicalCandidateProfileBoundedText(
        rule[key],
        `${ruleField}.${key}`,
        maximumCanonicalCandidateProfileIdLength,
        issues,
      ),
    );
    if (!isSafePositiveInteger(rule.rulesVersion)) {
      addIssue(
        issues,
        "invalid-value",
        `${ruleField}.rulesVersion`,
        "must be a positive safe integer.",
      );
    }
    if (
      typeof rule.rulesChecksum !== "string" ||
      !canonicalCandidateProfileRulesChecksumPattern.test(rule.rulesChecksum)
    ) {
      addIssue(
        issues,
        "invalid-value",
        `${ruleField}.rulesChecksum`,
        "must be a lowercase SHA-256 hex digest.",
      );
    }
    if (validIds.every(Boolean)) {
      const key = JSON.stringify([
        (rule.storeId as string).trim(),
        (rule.knowledgeBaseId as string).trim(),
      ]);
      if (seenBases.has(key)) {
        addIssue(issues, "invalid-value", ruleField, "must be unique per knowledge base.");
      }
      seenBases.add(key);
    }
  });
}

function validateCanonicalCandidateProfileExtraction(
  value: unknown,
  issues: SemanticValidationIssue[],
): void {
  const field = "profile.extraction";
  if (!isRecord(value)) {
    addIssue(issues, "invalid-value", field, "must be an object when provided.");
    return;
  }
  validateCanonicalCandidateProfileKeys(
    value,
    canonicalCandidateProfileExtractionKeys,
    field,
    issues,
  );
  for (const key of ["company", "modelId", "promptTemplateVersion"] as const) {
    validateCanonicalCandidateProfileBoundedText(
      value[key],
      `${field}.${key}`,
      maximumCanonicalCandidateProfileExtractionIdentityLength,
      issues,
    );
  }
  if (value.sensitivity !== undefined) {
    validateCanonicalCandidateProfileSensitivity(value.sensitivity, `${field}.sensitivity`, issues);
  }
  const extractionProfile = value.extractionProfile;
  if (extractionProfile === undefined) return;
  if (!isRecord(extractionProfile)) {
    addIssue(
      issues,
      "invalid-value",
      `${field}.extractionProfile`,
      "must be an object when provided.",
    );
    return;
  }
  validateCanonicalCandidateProfileKeys(
    extractionProfile,
    canonicalCandidateProfileExtractionProfileKeys,
    `${field}.extractionProfile`,
    issues,
  );
  validateCanonicalCandidateProfileBoundedText(
    extractionProfile.id,
    `${field}.extractionProfile.id`,
    maximumCanonicalCandidateProfileExtractionIdentityLength,
    issues,
  );
  if (!isSafePositiveInteger(extractionProfile.version)) {
    addIssue(
      issues,
      "invalid-value",
      `${field}.extractionProfile.version`,
      "must be a positive safe integer.",
    );
  }
}

/** Validate one canonical profile without requiring callers to construct it. */
export function validateCanonicalCandidateProfile(value: unknown): SemanticValidationResult {
  const issues: SemanticValidationIssue[] = [];
  if (!isRecord(value)) {
    return {
      valid: false,
      issues: [
        {
          code: "invalid-input",
          field: "canonicalCandidateProfile",
          message: "a canonical candidate profile object is required.",
        },
      ],
    };
  }
  validateCanonicalCandidateProfileKeys(value, canonicalCandidateProfileKeys, "profile", issues);
  const profile = value as Partial<CanonicalCandidateProfileInput>;
  if (
    profile.schemaVersion !== undefined &&
    profile.schemaVersion !== canonicalCandidateProfileSchemaVersion
  ) {
    addIssue(
      issues,
      "invalid-value",
      "profile.schemaVersion",
      "only schema version 1 is supported.",
    );
  }
  validateCanonicalCandidateProfileBoundedText(
    profile.id,
    "profile.id",
    maximumCanonicalCandidateProfileIdLength,
    issues,
  );
  if (!isSafePositiveInteger(profile.version)) {
    addIssue(issues, "invalid-value", "profile.version", "must be a positive safe integer.");
  }
  if (
    profile.parentVersion !== null &&
    profile.parentVersion !== undefined &&
    !isSafePositiveInteger(profile.parentVersion)
  ) {
    addIssue(
      issues,
      "invalid-value",
      "profile.parentVersion",
      "must be null or a positive safe integer.",
    );
  }
  if (isSafePositiveInteger(profile.version)) {
    if (profile.version === 1 && profile.parentVersion !== null) {
      addIssue(
        issues,
        "invalid-value",
        "profile.parentVersion",
        "version 1 must have parentVersion null.",
      );
    }
    if (profile.version > 1 && profile.parentVersion !== profile.version - 1) {
      addIssue(
        issues,
        "invalid-value",
        "profile.parentVersion",
        "profile versions after version 1 must link to the immediate predecessor.",
      );
    }
  }
  if (
    !canonicalCandidateProfileStatuses.includes(profile.status as CanonicalCandidateProfileStatus)
  ) {
    addIssue(issues, "invalid-value", "profile.status", "must be draft or reviewed.");
  }
  if (!isIsoTimestamp(profile.createdAt)) {
    addIssue(issues, "invalid-value", "profile.createdAt", "must be a valid ISO timestamp.");
  }
  if (!isIsoTimestamp(profile.updatedAt)) {
    addIssue(issues, "invalid-value", "profile.updatedAt", "must be a valid ISO timestamp.");
  }
  if (
    isIsoTimestamp(profile.createdAt) &&
    isIsoTimestamp(profile.updatedAt) &&
    Date.parse(profile.updatedAt) < Date.parse(profile.createdAt)
  ) {
    addIssue(issues, "invalid-value", "profile.updatedAt", "must not precede createdAt.");
  }

  const hasReviewedAt = profile.reviewedAt !== undefined;
  if (profile.status === "draft" && hasReviewedAt) {
    addIssue(issues, "invalid-value", "profile.reviewedAt", "draft profiles must omit reviewedAt.");
  }
  if (profile.status === "reviewed" && !hasReviewedAt) {
    addIssue(
      issues,
      "invalid-value",
      "profile.reviewedAt",
      "reviewed profiles require reviewedAt.",
    );
  }
  if (hasReviewedAt && !isIsoTimestamp(profile.reviewedAt)) {
    addIssue(issues, "invalid-value", "profile.reviewedAt", "must be a valid ISO timestamp.");
  }
  if (
    profile.status === "reviewed" &&
    isIsoTimestamp(profile.reviewedAt) &&
    isIsoTimestamp(profile.createdAt) &&
    Date.parse(profile.reviewedAt) < Date.parse(profile.createdAt)
  ) {
    addIssue(issues, "invalid-value", "profile.reviewedAt", "must not precede createdAt.");
  }
  if (
    profile.status === "reviewed" &&
    isIsoTimestamp(profile.reviewedAt) &&
    isIsoTimestamp(profile.updatedAt) &&
    Date.parse(profile.reviewedAt) > Date.parse(profile.updatedAt)
  ) {
    addIssue(issues, "invalid-value", "profile.reviewedAt", "must not follow updatedAt.");
  }

  if (profile.extraction !== undefined) {
    validateCanonicalCandidateProfileExtraction(profile.extraction, issues);
  }

  let selectionReferences: ReadonlySet<string> | undefined;
  if (profile.candidateKnowledgeSelection !== undefined) {
    validateCanonicalCandidateProfileSelectionShape(
      profile.candidateKnowledgeSelection,
      "profile.candidateKnowledgeSelection",
      issues,
    );
    const selectionValidation = validateCandidateKnowledgeSelectionSnapshot(
      profile.candidateKnowledgeSelection,
    );
    for (const issue of selectionValidation.issues) {
      addIssue(issues, issue.code, `profile.${issue.field}`, issue.message);
    }
    if (selectionValidation.valid) {
      selectionReferences = candidateKnowledgeSelectionReferences(
        createCandidateKnowledgeSelectionSnapshot(
          profile.candidateKnowledgeSelection as CandidateKnowledgeSelectionSnapshotInput,
        ),
      );
    }
  }

  const profileFacts = Array.isArray(profile.facts) ? profile.facts : [];
  if (!Array.isArray(profile.facts)) {
    addIssue(issues, "invalid-value", "profile.facts", "must be an array.");
  } else if (profile.facts.length > maximumCanonicalCandidateProfileFactCount) {
    addIssue(
      issues,
      "invalid-value",
      "profile.facts",
      `must contain at most ${maximumCanonicalCandidateProfileFactCount} facts.`,
    );
  }
  if (profileFacts.length > 0 && selectionReferences === undefined) {
    addIssue(
      issues,
      "invalid-value",
      "profile.candidateKnowledgeSelection",
      "is required when profile facts are present so every fact can bind to an exact source version.",
    );
  }
  if (profile.status === "reviewed" && selectionReferences === undefined) {
    addIssue(
      issues,
      "invalid-value",
      "profile.candidateKnowledgeSelection",
      "reviewed profiles require a bound candidateKnowledgeSelection.",
    );
  }
  if (profile.status === "reviewed" && profileFacts.length === 0) {
    addIssue(
      issues,
      "invalid-value",
      "profile.facts",
      "reviewed profiles require at least one fact.",
    );
  }
  const factsById = new Map<string, CanonicalCandidateProfileFactInput>();
  for (const [index, fact] of profileFacts.entries()) {
    const field = `profile.facts[${index}]`;
    const validFact = validateCanonicalCandidateProfileFact(
      fact,
      field,
      issues,
      selectionReferences,
    );
    if (!validFact || !isRecord(fact)) continue;
    const factId = (fact as Partial<CanonicalCandidateProfileFactInput>).id;
    if (!isNonEmptyString(factId)) continue;
    const normalizedFactId = factId.trim();
    if (factsById.has(normalizedFactId)) {
      addIssue(issues, "invalid-value", `${field}.id`, "fact ids must be unique.");
    }
    factsById.set(normalizedFactId, fact as CanonicalCandidateProfileFactInput);
  }

  if (profile.issues !== undefined && !Array.isArray(profile.issues)) {
    addIssue(issues, "invalid-value", "profile.issues", "must be an array when provided.");
  }
  const profileIssues = Array.isArray(profile.issues) ? profile.issues : [];
  if (profileIssues.length > maximumCanonicalCandidateProfileIssueCount) {
    addIssue(
      issues,
      "invalid-value",
      "profile.issues",
      `must contain at most ${maximumCanonicalCandidateProfileIssueCount} issues.`,
    );
  }
  const issueIds = new Set<string>();
  for (const [index, issue] of profileIssues.entries()) {
    const field = `profile.issues[${index}]`;
    const validIssue = validateCanonicalCandidateProfileIssue(
      issue,
      field,
      issues,
      factsById,
      selectionReferences,
    );
    if (!validIssue || !isRecord(issue)) continue;
    const issueId = (issue as Partial<CanonicalCandidateProfileIssueInput>).id;
    if (!isNonEmptyString(issueId)) continue;
    const normalizedIssueId = issueId.trim();
    if (issueIds.has(normalizedIssueId)) {
      addIssue(issues, "invalid-value", `${field}.id`, "issue ids must be unique.");
    }
    issueIds.add(normalizedIssueId);
  }
  if (
    profile.status === "reviewed" &&
    profileIssues.some(
      (issue) => isRecord(issue) && issue.status !== "acknowledged" && issue.status !== "resolved",
    )
  ) {
    addIssue(
      issues,
      "invalid-value",
      "profile.status",
      "every profile issue must be acknowledged or resolved before a profile can be reviewed; open errors and warnings are blockers.",
    );
  }
  return { valid: issues.length === 0, issues };
}

function normalizeCanonicalCandidateProfileProvenanceReference(
  reference: CanonicalCandidateProfileProvenanceReferenceInput,
): CanonicalCandidateProfileProvenanceReference {
  return {
    storeId: reference.storeId.trim() as CandidateKnowledgeStoreId,
    knowledgeBaseId: reference.knowledgeBaseId.trim() as CandidateKnowledgeBaseId,
    sourceId: reference.sourceId.trim() as CandidateKnowledgeSourceId,
    versionId: reference.versionId.trim() as CandidateKnowledgeSourceVersionId,
    kind: reference.kind,
  };
}

function normalizeCanonicalCandidateProfileFactProvenanceReference(
  reference: CanonicalCandidateProfileFactProvenanceReferenceInput,
): CanonicalCandidateProfileFactProvenanceReference {
  return {
    ...normalizeCanonicalCandidateProfileProvenanceReference(reference),
    ...(reference.quote === undefined ? {} : { quote: reference.quote.trim() }),
  };
}

function normalizeCanonicalCandidateProfileFact(
  fact: CanonicalCandidateProfileFactInput,
): CanonicalCandidateProfileFact {
  const provenance = fact.provenance
    .map(normalizeCanonicalCandidateProfileFactProvenanceReference)
    .sort((left, right) =>
      compareCanonicalCandidateProfileStrings(
        canonicalCandidateProfileReferenceSortKey(left),
        canonicalCandidateProfileReferenceSortKey(right),
      ),
    );
  return {
    id: fact.id.trim(),
    category: fact.category,
    ...(fact.subjectId === undefined ? {} : { subjectId: fact.subjectId.trim() }),
    field: fact.field.trim(),
    value: fact.value.trim(),
    provenance,
  };
}

function normalizeCanonicalCandidateProfileIssue(
  issue: CanonicalCandidateProfileIssueInput,
): CanonicalCandidateProfileIssue {
  const factIds = (issue.factIds ?? []).map((factId) => factId.trim()).sort();
  const sourceRefs = (issue.sourceRefs ?? [])
    .map(normalizeCanonicalCandidateProfileProvenanceReference)
    .sort((left, right) =>
      compareCanonicalCandidateProfileStrings(
        canonicalCandidateProfileReferenceSortKey(left),
        canonicalCandidateProfileReferenceSortKey(right),
      ),
    );
  return {
    id: issue.id.trim(),
    code: issue.code,
    severity: issue.severity,
    status: issue.status,
    message: issue.message.trim(),
    factIds,
    sourceRefs,
  };
}

function normalizeCanonicalCandidateProfileExtraction(
  extraction: CanonicalCandidateProfileExtractionIdentity,
): CanonicalCandidateProfileExtractionIdentity {
  return {
    company: extraction.company.trim(),
    modelId: extraction.modelId.trim(),
    promptTemplateVersion: extraction.promptTemplateVersion.trim(),
    ...(extraction.extractionProfile === undefined
      ? {}
      : {
          extractionProfile: {
            id: extraction.extractionProfile.id.trim(),
            version: extraction.extractionProfile.version,
          },
        }),
    ...(extraction.sensitivity === undefined
      ? {}
      : {
          sensitivity: {
            excludedTiers: [...extraction.sensitivity.excludedTiers],
            rules: extraction.sensitivity.rules.map((rule) => ({
              storeId: rule.storeId.trim(),
              knowledgeBaseId: rule.knowledgeBaseId.trim(),
              rulesVersion: rule.rulesVersion,
              rulesChecksum: rule.rulesChecksum,
            })),
          },
        }),
  };
}

/**
 * Build an immutable canonical profile from an explicit CKB selection. The
 * selection is copied into the profile, so a later CKB change cannot rewrite
 * the provenance of an already-created profile version.
 */
export function createCanonicalCandidateProfile(
  input: CanonicalCandidateProfileInput,
): CanonicalCandidateProfile {
  const validation = validateCanonicalCandidateProfile(input);
  if (!validation.valid) {
    throw new SemanticValidationError(validation.issues);
  }

  const candidateKnowledgeSelection =
    input.candidateKnowledgeSelection === undefined
      ? undefined
      : createCandidateKnowledgeSelectionSnapshot(input.candidateKnowledgeSelection);
  const extraction =
    input.extraction === undefined
      ? undefined
      : normalizeCanonicalCandidateProfileExtraction(input.extraction);
  const facts = input.facts
    .map(normalizeCanonicalCandidateProfileFact)
    .sort((left, right) => compareCanonicalCandidateProfileStrings(left.id, right.id));
  const issues = (input.issues ?? [])
    .map(normalizeCanonicalCandidateProfileIssue)
    .sort((left, right) => compareCanonicalCandidateProfileStrings(left.id, right.id));

  return cloneAndFreeze({
    schemaVersion: canonicalCandidateProfileSchemaVersion,
    id: input.id.trim() as CanonicalCandidateProfileId,
    version: input.version,
    parentVersion: input.parentVersion,
    status: input.status,
    createdAt: input.createdAt.trim(),
    updatedAt: input.updatedAt.trim(),
    ...(input.reviewedAt === undefined ? {} : { reviewedAt: input.reviewedAt.trim() }),
    ...(candidateKnowledgeSelection === undefined ? {} : { candidateKnowledgeSelection }),
    ...(extraction === undefined ? {} : { extraction }),
    facts,
    issues,
  });
}
