export const workflowStates = [
  "collecting",
  "ingesting",
  "drafting",
  "reviewing",
  "revising",
  "awaiting-approval",
  "approved",
  "exported",
  "paused",
  "stopped",
  "budget-exhausted",
] as const;

export type WorkflowState = (typeof workflowStates)[number];

type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type WorkspaceId = Brand<string, "WorkspaceId">;
export type ContextSnapshotId = Brand<string, "ContextSnapshotId">;
export type JobRequirementId = Brand<string, "JobRequirementId">;
export type EvidenceSourceId = Brand<string, "EvidenceSourceId">;
export type ArtifactId = Brand<string, "ArtifactId">;
export type AgentReferenceId = Brand<string, "AgentReferenceId">;
export type ProfileId = Brand<string, "ProfileId">;
/** Canonical profiles use the existing profile identity brand. */
export type CanonicalCandidateProfileId = ProfileId;
export type CandidateKnowledgeStoreId = Brand<string, "CandidateKnowledgeStoreId">;
export type CandidateKnowledgeBaseId = Brand<string, "CandidateKnowledgeBaseId">;
export type CandidateKnowledgeSourceId = Brand<string, "CandidateKnowledgeSourceId">;
export type CandidateKnowledgeSourceVersionId = Brand<string, "CandidateKnowledgeSourceVersionId">;

export interface WorkspaceIdentity {
  readonly id: WorkspaceId;
}

export interface Workspace extends WorkspaceIdentity {
  readonly state: WorkflowState;
}

export function createWorkspace(id: string): Workspace {
  if (id.trim() === "") {
    throw new Error("A workspace id is required.");
  }

  return { id: id as WorkspaceId, state: "collecting" };
}

/**
 * Legacy canonical-profile prototype retained for context compatibility.
 * Reusable source collections belong to CandidateKnowledgeBase instead.
 */
export interface CandidateProfile {
  readonly id: ProfileId;
  readonly name: string;
  readonly description: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CandidateProfileInput {
  readonly name: string;
  readonly description?: string;
}

export function createProfile(id: string, input: CandidateProfileInput): CandidateProfile {
  if (id.trim() === "") {
    throw new Error("A profile id is required.");
  }
  if (!input.name || input.name.trim() === "") {
    throw new Error("A profile name is required.");
  }
  const now = new Date().toISOString();
  return {
    id: id as ProfileId,
    name: input.name.trim(),
    description: (input.description ?? "").trim(),
    createdAt: now,
    updatedAt: now,
  };
}

export const candidateKnowledgeStoreSchemaVersion = 1 as const;

export interface CandidateKnowledgeStore {
  readonly schemaVersion: typeof candidateKnowledgeStoreSchemaVersion;
  readonly id: CandidateKnowledgeStoreId;
  readonly createdAt: string;
}

export function createCandidateKnowledgeStore(
  id: string,
  createdAt = new Date().toISOString(),
): CandidateKnowledgeStore {
  const normalizedId = id.trim();
  if (normalizedId === "") {
    throw new Error("A candidate knowledge store id is required.");
  }
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(createdAt) ||
    Number.isNaN(Date.parse(createdAt))
  ) {
    throw new Error("Candidate knowledge store createdAt must be a valid ISO timestamp.");
  }
  return {
    schemaVersion: candidateKnowledgeStoreSchemaVersion,
    id: normalizedId as CandidateKnowledgeStoreId,
    createdAt,
  };
}

export const candidateKnowledgeBaseStates = ["active", "archived"] as const;
export type CandidateKnowledgeBaseState = (typeof candidateKnowledgeBaseStates)[number];

export interface CandidateKnowledgeBase {
  readonly id: CandidateKnowledgeBaseId;
  readonly displayName: string;
  readonly description: string;
  readonly isDefault: boolean;
  readonly state: CandidateKnowledgeBaseState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt?: string;
}

export interface CandidateKnowledgeBaseInput {
  readonly displayName: string;
  readonly description?: string;
  readonly isDefault?: boolean;
}

function requireCandidateKnowledgeBaseText(value: string, field: "id" | "display name"): string {
  const normalized = value.trim();
  if (normalized === "") {
    throw new Error(`A candidate knowledge base ${field} is required.`);
  }
  return normalized;
}

function requireCandidateKnowledgeBaseTimestamp(value: string, field: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new Error(`Candidate knowledge base ${field} must be a valid ISO timestamp.`);
  }
  return value;
}

export function createCandidateKnowledgeBase(
  id: string,
  input: CandidateKnowledgeBaseInput,
  createdAt = new Date().toISOString(),
): CandidateKnowledgeBase {
  const normalizedCreatedAt = requireCandidateKnowledgeBaseTimestamp(createdAt, "createdAt");
  return {
    id: requireCandidateKnowledgeBaseText(id, "id") as CandidateKnowledgeBaseId,
    displayName: requireCandidateKnowledgeBaseText(input.displayName, "display name"),
    description: (input.description ?? "").trim(),
    isDefault: input.isDefault ?? false,
    state: "active",
    createdAt: normalizedCreatedAt,
    updatedAt: normalizedCreatedAt,
  };
}

export function renameCandidateKnowledgeBase(
  knowledgeBase: CandidateKnowledgeBase,
  displayName: string,
  updatedAt = new Date().toISOString(),
): CandidateKnowledgeBase {
  const normalizedUpdatedAt = requireCandidateKnowledgeBaseTimestamp(updatedAt, "updatedAt");
  if (Date.parse(normalizedUpdatedAt) < Date.parse(knowledgeBase.updatedAt)) {
    throw new Error("Candidate knowledge base updatedAt must not precede its current updatedAt.");
  }
  return {
    ...knowledgeBase,
    displayName: requireCandidateKnowledgeBaseText(displayName, "display name"),
    updatedAt: normalizedUpdatedAt,
  };
}

export function archiveCandidateKnowledgeBase(
  knowledgeBase: CandidateKnowledgeBase,
  archivedAt = new Date().toISOString(),
): CandidateKnowledgeBase {
  if (knowledgeBase.isDefault) {
    throw new Error("The default candidate knowledge base cannot be archived.");
  }
  if (knowledgeBase.state === "archived") {
    throw new Error("The candidate knowledge base is already archived.");
  }
  const normalizedArchivedAt = requireCandidateKnowledgeBaseTimestamp(archivedAt, "archivedAt");
  if (Date.parse(normalizedArchivedAt) < Date.parse(knowledgeBase.updatedAt)) {
    throw new Error("Candidate knowledge base archivedAt must not precede its current updatedAt.");
  }
  return {
    ...knowledgeBase,
    state: "archived",
    updatedAt: normalizedArchivedAt,
    archivedAt: normalizedArchivedAt,
  };
}

export const candidateKnowledgeSourceKinds = ["file", "url"] as const;
export type CandidateKnowledgeSourceKind = (typeof candidateKnowledgeSourceKinds)[number];

export interface CandidateKnowledgeSource {
  readonly id: CandidateKnowledgeSourceId;
  readonly knowledgeBaseId: CandidateKnowledgeBaseId;
  readonly kind: CandidateKnowledgeSourceKind;
  readonly displayName: string;
  readonly createdAt: string;
}

export interface CandidateKnowledgeSourceInput {
  readonly knowledgeBaseId: string;
  readonly kind: CandidateKnowledgeSourceKind;
  readonly displayName: string;
}

export const candidateKnowledgeSourceRetirementReasons = ["user-requested"] as const;
export type CandidateKnowledgeSourceRetirementReason =
  (typeof candidateKnowledgeSourceRetirementReasons)[number];

export const candidateKnowledgeRetentionClasses = [
  "raw-sources",
  "normalized-facts",
  "indexes",
  "run-snapshots",
  "exports",
  "backups",
] as const;
export type CandidateKnowledgeRetentionClass = (typeof candidateKnowledgeRetentionClasses)[number];

export const candidateKnowledgeRetentionRules = [
  "retain-until-deletion",
  "expire-after-days",
] as const;
export type CandidateKnowledgeRetentionRule = (typeof candidateKnowledgeRetentionRules)[number];

export const candidateKnowledgeRetentionOverrideKinds = [
  "legal-hold",
  "manual-preservation",
] as const;
export type CandidateKnowledgeRetentionOverrideKind =
  (typeof candidateKnowledgeRetentionOverrideKinds)[number];

export interface CandidateKnowledgeSourceRetirement {
  readonly sourceId: CandidateKnowledgeSourceId;
  readonly retiredAt: string;
  readonly reason: CandidateKnowledgeSourceRetirementReason;
}

export interface CandidateKnowledgeSourceRetirementInput {
  readonly sourceId: string;
  readonly retiredAt: string;
  readonly reason: CandidateKnowledgeSourceRetirementReason;
}

function requireCandidateKnowledgeSourceText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === "") {
    throw new Error(`A candidate knowledge source ${field} is required.`);
  }
  return normalized;
}

function requireCandidateKnowledgeSourceTimestamp(value: string, field: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new Error(`Candidate knowledge source ${field} must be a valid ISO timestamp.`);
  }
  return value;
}

export function createCandidateKnowledgeSource(
  id: string,
  input: CandidateKnowledgeSourceInput,
  createdAt = new Date().toISOString(),
): CandidateKnowledgeSource {
  if (!candidateKnowledgeSourceKinds.includes(input.kind)) {
    throw new Error(
      `Candidate knowledge source kind must be one of: ${candidateKnowledgeSourceKinds.join(", ")}.`,
    );
  }
  return {
    id: requireCandidateKnowledgeSourceText(id, "id") as CandidateKnowledgeSourceId,
    knowledgeBaseId: requireCandidateKnowledgeSourceText(
      input.knowledgeBaseId,
      "knowledge base id",
    ) as CandidateKnowledgeBaseId,
    kind: input.kind,
    displayName: requireCandidateKnowledgeSourceText(input.displayName, "display name"),
    createdAt: requireCandidateKnowledgeSourceTimestamp(createdAt, "createdAt"),
  };
}

export function createCandidateKnowledgeSourceRetirement(
  input: CandidateKnowledgeSourceRetirementInput,
): CandidateKnowledgeSourceRetirement {
  if (!candidateKnowledgeSourceRetirementReasons.includes(input.reason)) {
    throw new Error("Candidate knowledge source retirement reason must be user-requested.");
  }
  return {
    sourceId: requireCandidateKnowledgeSourceText(
      input.sourceId,
      "source id",
    ) as CandidateKnowledgeSourceId,
    retiredAt: requireCandidateKnowledgeSourceTimestamp(input.retiredAt, "retiredAt"),
    reason: input.reason,
  };
}

export interface CandidateKnowledgeSourceVersion {
  readonly id: CandidateKnowledgeSourceVersionId;
  readonly sourceId: CandidateKnowledgeSourceId;
  readonly version: number;
  readonly parentVersionId?: CandidateKnowledgeSourceVersionId;
  readonly mediaType: string;
  readonly checksum: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
}

export interface CandidateKnowledgeSourceVersionInput {
  readonly sourceId: string;
  readonly version: number;
  readonly parentVersionId?: string;
  readonly mediaType: string;
  readonly checksum: string;
  readonly sizeBytes: number;
}

export function createCandidateKnowledgeSourceVersion(
  id: string,
  input: CandidateKnowledgeSourceVersionInput,
  createdAt = new Date().toISOString(),
): CandidateKnowledgeSourceVersion {
  if (!Number.isInteger(input.version) || input.version <= 0) {
    throw new Error("Candidate knowledge source version must be a positive integer.");
  }
  const parentVersionId = input.parentVersionId?.trim();
  if (input.version === 1 && input.parentVersionId !== undefined) {
    throw new Error("Candidate knowledge source version 1 must not have a parent version.");
  }
  if (input.version > 1 && (parentVersionId === undefined || parentVersionId === "")) {
    throw new Error(
      "Candidate knowledge source versions after version 1 require a parent version.",
    );
  }
  if (!/^[a-f0-9]{64}$/iu.test(input.checksum)) {
    throw new Error("Candidate knowledge source version checksum must be a SHA-256 checksum.");
  }
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 0) {
    throw new Error("Candidate knowledge source version sizeBytes must be a nonnegative integer.");
  }
  return {
    id: requireCandidateKnowledgeSourceText(id, "version id") as CandidateKnowledgeSourceVersionId,
    sourceId: requireCandidateKnowledgeSourceText(
      input.sourceId,
      "source id",
    ) as CandidateKnowledgeSourceId,
    version: input.version,
    ...(parentVersionId
      ? {
          parentVersionId: parentVersionId as CandidateKnowledgeSourceVersionId,
        }
      : {}),
    mediaType: requireCandidateKnowledgeSourceText(input.mediaType, "media type"),
    checksum: input.checksum.toLowerCase(),
    sizeBytes: input.sizeBytes,
    createdAt: requireCandidateKnowledgeSourceTimestamp(createdAt, "version createdAt"),
  };
}

export const candidateKnowledgeSelectionSnapshotSchemaVersion = 1 as const;
export type CandidateKnowledgeSelectionSnapshotSchemaVersion =
  typeof candidateKnowledgeSelectionSnapshotSchemaVersion;

export const candidateKnowledgeSelectionLifecycleObservationStatuses = [
  "current",
  "changed",
  "missing",
  "inaccessible",
  "unbound",
] as const;
export type CandidateKnowledgeSelectionLifecycleObservationStatus =
  (typeof candidateKnowledgeSelectionLifecycleObservationStatuses)[number];

export interface CandidateKnowledgeSelectionLifecycleObservationRevision {
  readonly observedVersionId: string;
  readonly status: CandidateKnowledgeSelectionLifecycleObservationStatus;
  readonly checkedAt: string;
  readonly lastRefreshedVersionId: string | null;
  readonly lastRefreshedAt: string | null;
  readonly stale: boolean;
}

export interface CandidateKnowledgeSelectionLifecycleRetirementRevision {
  readonly retiredAt: string;
  readonly reason: "user-requested";
}

export interface CandidateKnowledgeSelectionLifecycleDirectoryRevision {
  readonly directoryId: string;
  readonly rootRevision: number;
  readonly rootBoundAt: string;
  readonly memberRevision: number;
  readonly memberBoundAt: string;
}

export interface CandidateKnowledgeSelectionLifecycleRevision {
  readonly knowledgeBaseState: CandidateKnowledgeBaseState;
  readonly knowledgeBaseArchivedAt: string | null;
  readonly versionId: string;
  readonly version: number;
  readonly createdAt: string;
  readonly managed: boolean;
  readonly originBoundAt: string | null;
  readonly observation: CandidateKnowledgeSelectionLifecycleObservationRevision | null;
  readonly retirement: CandidateKnowledgeSelectionLifecycleRetirementRevision | null;
  readonly provenanceFetchedAt: string | null;
  readonly directory: CandidateKnowledgeSelectionLifecycleDirectoryRevision | null;
}

export interface CandidateKnowledgeSelectionLifecycleRevisionInput
  extends CandidateKnowledgeSelectionLifecycleRevision {}

export interface CandidateKnowledgeSelectionSnapshotSourceInput {
  readonly sourceId: string;
  readonly versionId: string;
  readonly lifecycleRevision: CandidateKnowledgeSelectionLifecycleRevisionInput;
}

export interface CandidateKnowledgeSelectionSnapshotEntryInput {
  readonly storeId: string;
  readonly knowledgeBaseId: string;
  readonly sources: readonly CandidateKnowledgeSelectionSnapshotSourceInput[];
}

export interface CandidateKnowledgeSelectionSnapshotInput {
  readonly schemaVersion?: number;
  readonly capturedAt: string;
  readonly entries: readonly CandidateKnowledgeSelectionSnapshotEntryInput[];
}

export interface CandidateKnowledgeSelectionSnapshotSource {
  readonly sourceId: CandidateKnowledgeSourceId;
  readonly versionId: CandidateKnowledgeSourceVersionId;
  readonly lifecycleRevision: CandidateKnowledgeSelectionLifecycleRevision;
}

export interface CandidateKnowledgeSelectionSnapshotEntry {
  readonly storeId: CandidateKnowledgeStoreId;
  readonly knowledgeBaseId: CandidateKnowledgeBaseId;
  readonly sources: readonly CandidateKnowledgeSelectionSnapshotSource[];
}

export interface CandidateKnowledgeSelectionSnapshot {
  readonly schemaVersion: CandidateKnowledgeSelectionSnapshotSchemaVersion;
  readonly capturedAt: string;
  readonly entries: readonly CandidateKnowledgeSelectionSnapshotEntry[];
}

/** Version of the provider-independent canonical candidate profile contract. */
export const canonicalCandidateProfileSchemaVersion = 1 as const;
export type CanonicalCandidateProfileSchemaVersion = typeof canonicalCandidateProfileSchemaVersion;

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
export const maximumCanonicalCandidateProfileFactCount = 512 as const;
export const maximumCanonicalCandidateProfileIssueCount = 256 as const;
export const maximumCanonicalCandidateProfileProvenanceCount = 32 as const;
export const maximumCanonicalCandidateProfileIssueFactReferenceCount = 64 as const;
export const maximumCanonicalCandidateProfileIssueSourceReferenceCount = 64 as const;
export const maximumCanonicalCandidateProfileFactIdLength = 120 as const;
export const maximumCanonicalCandidateProfileSubjectIdLength = 120 as const;
export const maximumCanonicalCandidateProfileFieldLength = 120 as const;
export const maximumCanonicalCandidateProfileValueLength = 2_000 as const;
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

export interface CanonicalCandidateProfileFactInput {
  readonly id: string;
  readonly category: CanonicalCandidateProfileFactCategory;
  readonly subjectId?: string;
  readonly field: string;
  readonly value: string;
  readonly provenance: readonly CanonicalCandidateProfileProvenanceReferenceInput[];
}

export interface CanonicalCandidateProfileFact {
  readonly id: string;
  readonly category: CanonicalCandidateProfileFactCategory;
  readonly subjectId?: string;
  readonly field: string;
  readonly value: string;
  readonly provenance: readonly CanonicalCandidateProfileProvenanceReference[];
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
  readonly facts: readonly CanonicalCandidateProfileFact[];
  readonly issues: readonly CanonicalCandidateProfileIssue[];
}

export const contextSchemaVersion = 1 as const;
export type ContextSchemaVersion = typeof contextSchemaVersion;

export const requirementPriorities = ["critical", "high", "medium", "low"] as const;
export type RequirementPriority = (typeof requirementPriorities)[number];

/** Version of the provider-independent opportunity brief contract. */
export const opportunityBriefSchemaVersion = 1 as const;
export type OpportunityBriefSchemaVersion = typeof opportunityBriefSchemaVersion;

/** Version of the provider-independent opportunity extraction proposal. */
export const opportunityExtractionSchemaVersion = 1 as const;
export type OpportunityExtractionSchemaVersion = typeof opportunityExtractionSchemaVersion;

export const opportunityBriefStatuses = ["draft", "reviewed"] as const;
export type OpportunityBriefStatus = (typeof opportunityBriefStatuses)[number];

export const opportunityBriefSourceClassifications = [
  "job-posting",
  "social-announcement",
  "company-context",
  "candidate-instruction",
] as const;
export type OpportunityBriefSourceClassification =
  (typeof opportunityBriefSourceClassifications)[number];

export const opportunityBriefProvenanceKinds = [
  "approved-url",
  "local-file",
  "pasted-content",
  "candidate-input",
] as const;
export type OpportunityBriefProvenanceKind = (typeof opportunityBriefProvenanceKinds)[number];

export const opportunityBriefSourceStatuses = [
  "available",
  "inaccessible",
  "unsupported",
  "failed",
  "partial",
  "stale",
] as const;
export type OpportunityBriefSourceStatus = (typeof opportunityBriefSourceStatuses)[number];

export const opportunityBriefIssueCodes = [
  "inaccessible-source",
  "unsupported-source",
  "fetch-failure",
  "extraction-failure",
  "duplicate-source",
  "contradiction",
  "stale-source",
  "partial-fetch",
] as const;
export type OpportunityBriefIssueCode = (typeof opportunityBriefIssueCodes)[number];

export const opportunityExtractionContradictionFields = [
  "role",
  "employer",
  "responsibilities",
  "requirements",
  "priorities",
] as const;
export type OpportunityExtractionContradictionField =
  (typeof opportunityExtractionContradictionFields)[number];

export const opportunityBriefIssueStatuses = ["open", "acknowledged", "resolved"] as const;
export type OpportunityBriefIssueStatus = (typeof opportunityBriefIssueStatuses)[number];

export const opportunityBriefIssueSeverities = ["error", "warning"] as const;
export type OpportunityBriefIssueSeverity = (typeof opportunityBriefIssueSeverities)[number];

/** Bounds keep persisted opportunity briefs predictable without limiting normal prose. */
export const opportunityBriefMaximumIdLength = 120 as const;
export const opportunityBriefMaximumTextLength = 2_000 as const;
export const opportunityBriefMaximumMessageLength = 400 as const;
export const opportunityBriefMaximumSourceCount = 128 as const;
export const opportunityBriefMaximumCollectionEntries = 256 as const;
export const opportunityBriefMaximumSourceIds = 64 as const;

export interface JobRequirement {
  readonly id: JobRequirementId;
  readonly text: string;
  readonly priority: RequirementPriority;
}

export interface JobRequirementInput {
  readonly id?: string;
  readonly text?: string;
  /** Accepted as an input alias; snapshots always use the normalized `text` field. */
  readonly description?: string;
  readonly priority?: RequirementPriority;
}

export const readinessDimensions = [
  "relevance",
  "evidence",
  "accuracy",
  "differentiation",
  "clarity",
  "format",
  "credibility",
] as const;

export type ReadinessDimension = (typeof readinessDimensions)[number];

/** Version of the provider-independent independent-readiness report contract. */
export const independentReadinessReportSchemaVersion = 1 as const;
export type IndependentReadinessReportSchemaVersion =
  typeof independentReadinessReportSchemaVersion;

export const independentReadinessReportFindingOrigins = ["deterministic", "critic"] as const;
export type IndependentReadinessReportFindingOrigin =
  (typeof independentReadinessReportFindingOrigins)[number];

export const independentReadinessReportTargetKinds = [
  "artifact",
  "claim",
  "section",
  "requirement",
  "evidence",
  "rubric",
] as const;
export type IndependentReadinessReportTargetKind =
  (typeof independentReadinessReportTargetKinds)[number];

export const independentReadinessReportInputAssessmentStatuses = [
  "complete",
  "incomplete",
] as const;
export type IndependentReadinessReportInputAssessmentStatus =
  (typeof independentReadinessReportInputAssessmentStatuses)[number];

/** Version of the provider-independent author-adjudication plan contract. */
export const authorAdjudicationPlanSchemaVersion = 1 as const;
export type AuthorAdjudicationPlanSchemaVersion = typeof authorAdjudicationPlanSchemaVersion;

/** Version of the provider-independent adjudicated-revision trace contract. */
export const adjudicatedRevisionTraceSchemaVersion = 1 as const;
export type AdjudicatedRevisionTraceSchemaVersion = typeof adjudicatedRevisionTraceSchemaVersion;

export const authorAdjudicationDispositions = ["accept", "reject", "nuance"] as const;
export type AuthorAdjudicationDisposition = (typeof authorAdjudicationDispositions)[number];

export const authorAdjudicationEffectRequirements = [
  "revision-required",
  "disagreement-preserved",
] as const;
export type AuthorAdjudicationEffectRequirement =
  (typeof authorAdjudicationEffectRequirements)[number];

export const adjudicatedRevisionEffectStatuses = [
  "verified",
  "overridden",
  "missing",
  "disagreement-preserved",
] as const;
export type AdjudicatedRevisionEffectStatus = (typeof adjudicatedRevisionEffectStatuses)[number];

/** Version of the provider-independent application-readiness stopping contract. */
export const applicationReadinessStoppingDecisionSchemaVersion = 1 as const;
export type ApplicationReadinessStoppingDecisionSchemaVersion =
  typeof applicationReadinessStoppingDecisionSchemaVersion;

/** The explicit agreement recorded for each readiness dimension. */
export const readinessDimensionAgreementStatuses = ["agreed", "disputed"] as const;
export type ReadinessDimensionAgreementStatus =
  (typeof readinessDimensionAgreementStatuses)[number];

/** Reasons a bounded author–critic loop may stop. */
export const applicationReadinessStoppingDecisionStopReasons = [
  "application-ready",
  "stable-convergence",
  "max-rounds",
  "budget-exhausted",
  "cancelled",
  "continue",
] as const;
export type ApplicationReadinessStoppingDecisionStopReason =
  (typeof applicationReadinessStoppingDecisionStopReasons)[number];

/** Finite, content-free reasons that prevent application readiness. */
export const applicationReadinessStoppingDecisionBlockerCodes = [
  "incomplete-report-inputs",
  "independent-review-incomplete",
  "deterministic-error",
  "report-error",
  "unmet-rubric-threshold",
  "disputed-dimension",
  "missing-revision-effect",
] as const;
export type ApplicationReadinessStoppingDecisionBlockerCode =
  (typeof applicationReadinessStoppingDecisionBlockerCodes)[number];

/** Finite, content-free limitations that remain visible without blocking. */
export const applicationReadinessStoppingDecisionLimitationCodes = [
  "deterministic-warning",
  "report-warning",
  "revision-effect-overridden",
  "disagreement-preserved",
] as const;
export type ApplicationReadinessStoppingDecisionLimitationCode =
  (typeof applicationReadinessStoppingDecisionLimitationCodes)[number];

export interface ReadinessDimensionAgreement {
  readonly dimension: ReadinessDimension;
  readonly status: ReadinessDimensionAgreementStatus;
  readonly rationale: string;
}

export type ReadinessRubric = Readonly<Record<ReadinessDimension, number>>;
export type ReadinessRubricInput = Partial<ReadinessRubric>;

export const outputFormats = ["markdown", "plain-text", "json", "pdf", "docx"] as const;
export type OutputFormat = (typeof outputFormats)[number];

/** Version of the provider-independent rendering QA report contract. */
export const renderingQaReportSchemaVersion = 1 as const;
export type RenderingQaReportSchemaVersion = typeof renderingQaReportSchemaVersion;

/** The only layout profiles accepted by the controlled renderer. */
export const renderingLayoutProfileIds = ["compact-one-page", "standard-two-page"] as const;
export type RenderingLayoutProfileId = (typeof renderingLayoutProfileIds)[number];

/** Signals recorded by an independent viewer when it extracts a rendering. */
export const renderingQaVisibleContentOrderSignals = ["preserved", "mismatch"] as const;
export type RenderingQaVisibleContentOrderSignal =
  (typeof renderingQaVisibleContentOrderSignals)[number];

/** Finite content-free active-content signatures recognized by local QA. */
export const renderingQaActiveContentSignatures = [
  "docx-attached-template",
  "docx-embedded-object",
  "docx-external-link",
  "docx-macro-project",
  "html-event-handler",
  "html-iframe",
  "html-javascript-url",
  "html-script",
  "pdf-additional-action",
  "pdf-javascript",
  "pdf-launch-action",
  "pdf-open-action",
] as const;
export type RenderingQaActiveContentSignature = (typeof renderingQaActiveContentSignatures)[number];

/** Canonical, content-free rendering limitations. */
export const renderingQaLimitationCodes = [
  "deterministic-page-count-not-assessed",
  "independent-viewer-observation-not-run",
  "structured-images-unsupported",
  "structured-links-unsupported",
] as const;
export type RenderingQaLimitationCode = (typeof renderingQaLimitationCodes)[number];

export interface OutputConstraints {
  readonly format: OutputFormat;
  readonly maxWords?: number;
  readonly maxCharacters?: number;
  readonly maxLength?: number;
  readonly requiredSections: readonly string[];
  readonly tone?: string;
}

export interface OutputConstraintsInput {
  readonly format?: OutputFormat;
  readonly maxWords?: number;
  readonly maxCharacters?: number;
  readonly maxLength?: number;
  readonly requiredSections?: readonly string[];
  readonly tone?: string;
}

export interface EvidenceSource {
  readonly id: EvidenceSourceId;
  readonly path: string;
  readonly mediaType: string;
  readonly checksum: string;
  readonly profileId?: ProfileId;
}

export interface EvidenceSourceInput {
  readonly id?: string;
  readonly path?: string;
  readonly mediaType?: string;
  readonly checksum?: string;
  readonly profileId?: string;
}

export interface ScoredEvidenceChunk {
  readonly id: string;
  readonly workspaceId: string;
  readonly sourceId: string;
  readonly ordinal: number;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly checksum: string;
  readonly text: string;
  readonly rank: number;
}

export type EvidenceRetrievalStatus = "not-indexed" | "matched" | "fallback" | "no-query";

export interface EvidenceRetrievalInspection {
  readonly status: EvidenceRetrievalStatus;
  readonly indexedChunkCount: number;
  readonly selectedChunkCount: number;
  readonly selectedSourceCount: number;
  readonly hits: readonly ScoredEvidenceChunk[];
}

export interface RetrievalOptions {
  readonly workspaceId?: string;
  readonly profileId?: string;
  readonly limit?: number;
  readonly minScore?: number;
}

export interface RetrievalPort {
  readonly queryEvidence: (
    query: string,
    options?: RetrievalOptions,
  ) => Promise<readonly ScoredEvidenceChunk[]>;
}

export type AgentRole = "author" | "critic";
export type ModelCompany = "anthropic" | "openai" | (string & {});

/**
 * The longest accepted model-lineage label.
 *
 * A lineage is a short identifier a person types once and reads later; a bound
 * keeps a persisted snapshot and every surface that renders it predictable.
 */
export const maximumModelLineageLength = 200;

/**
 * The longest accepted independence-override rationale.
 *
 * Long enough for a paragraph explaining why a shared lineage is acceptable,
 * short enough that the value stays a note rather than a document.
 */
export const maximumIndependenceOverrideRationaleLength = 500;

export interface ModelSelection {
  readonly company: ModelCompany;
  readonly modelId: string;
  readonly role: AgentRole;
  readonly promptTemplateVersion: string;
  /**
   * The weights this selection descends from, as claimed by the operator.
   *
   * Optional: when absent a lineage is derived from company and model id, so a
   * workspace written before lineages existed keeps its current behaviour. See
   * `deriveModelLineage`.
   */
  readonly lineage?: string;
}

export interface ModelSelectionInput {
  readonly company?: string;
  readonly modelId?: string;
  readonly role?: AgentRole;
  readonly promptTemplateVersion?: string;
  readonly lineage?: string;
}

/**
 * What independence was claimed for a run, and whether the claim held.
 *
 * Recorded on the context snapshot rather than recomputed by readers: the
 * selections can be edited after a run, and an audit needs what was true when
 * the run was configured.
 */
export interface IndependentReviewRecord {
  readonly authorLineage: string;
  readonly criticLineage: string;
  readonly lineagesDistinct: boolean;
  /** Whether independent review was demanded for this run. */
  readonly required: boolean;
  /** Present only when a shared lineage was actually overridden. */
  readonly overrideRationale?: string;
}

export interface ModelConfiguration {
  readonly author: ModelSelection;
  readonly critic: ModelSelection;
  /**
   * Historic field name for "require independent review".
   *
   * Kept because it is persisted in every existing context snapshot; the
   * property it now gates is lineage distinctness, not company distinctness.
   */
  readonly requireProviderDiversity: boolean;
  /**
   * Absent on snapshots written before independence became a recorded property.
   */
  readonly independentReview?: IndependentReviewRecord;
}

export interface ModelConfigurationInput {
  readonly author?: ModelSelectionInput;
  readonly critic?: ModelSelectionInput;
  readonly requireProviderDiversity?: boolean;
  /**
   * Why a shared author and critic lineage is acceptable for this run.
   *
   * Supplying one is the only way past the independence gate; it is recorded
   * with the run so a reader of the artifact can judge the choice.
   */
  readonly independenceOverrideRationale?: string;
  /**
   * Accepted so a canonical snapshot re-validates as its own input.
   *
   * A snapshot that once passed the gate carries its override in the record
   * rather than in the raw field, and must not be refused on the way back in.
   */
  readonly independentReview?: IndependentReviewRecord;
}

/**
 * The exact reviewed opportunity brief version bound to a run.
 *
 * The reference carries identity and integrity metadata only. The brief's
 * raw sources and provenance remain local to the opportunity store and are
 * never part of a context snapshot.
 */
export interface OpportunityBriefReference {
  readonly briefId: string;
  readonly version: number;
  readonly checksum: string;
}

export interface OpportunityBriefReferenceInput {
  readonly briefId: string;
  readonly version: number;
  readonly checksum: string;
}

export interface ContextSnapshot {
  readonly schemaVersion: ContextSchemaVersion;
  readonly id: ContextSnapshotId;
  readonly workspaceId: WorkspaceId;
  readonly createdAt: string;
  readonly jobDescription: string;
  readonly requirements: readonly JobRequirement[];
  readonly candidateInstructions: string;
  readonly language: string;
  readonly outputConstraints: OutputConstraints;
  readonly truthfulnessPolicy: string;
  /** Explicit candidate-approved authoring policy, separate from claim evidence. */
  readonly writingPolicy?: WritingPolicy;
  readonly readinessRubric: ReadinessRubric;
  readonly evidenceManifest: readonly EvidenceSource[];
  readonly modelConfiguration: ModelConfiguration;
  /** Optional immutable evidence of the CKBs selected for this run. */
  readonly candidateKnowledgeSelection?: CandidateKnowledgeSelectionSnapshot;
  /** Optional exact reviewed opportunity brief version bound to this run. */
  readonly opportunityBriefReference?: OpportunityBriefReference;
  readonly profileId?: ProfileId;
}

/** Structured rule kinds compiled from a candidate-approved writing policy. */
export const writingPolicyRuleKinds = ["forbidden-term", "forbidden-characters"] as const;
export type WritingPolicyRuleKind = (typeof writingPolicyRuleKinds)[number];

/** Version of the structured writing-policy contract. */
export const writingPolicySchemaVersion = 1 as const;
export type WritingPolicySchemaVersion = typeof writingPolicySchemaVersion;

export const maximumWritingPolicyRules = 64;
export const writingPolicyRuleIdPrefix = "writing-policy-";
export const maximumWritingPolicyRuleIdHexLength = 24;
export const maximumWritingPolicyRuleIdLength =
  writingPolicyRuleIdPrefix.length + maximumWritingPolicyRuleIdHexLength;
export const writingPolicyRuleIdPattern = /^writing-policy-[a-f0-9]{24}$/u;
export const maximumWritingPolicyTermLength = 200;
export const maximumWritingPolicyCharactersLength = 32;
export const writingPolicyTones = ["professional", "warm", "direct", "conversational"] as const;
export type WritingPolicyTone = (typeof writingPolicyTones)[number];
export const writingPolicyVerbosityLevels = ["concise", "balanced", "detailed"] as const;
export type WritingPolicyVerbosity = (typeof writingPolicyVerbosityLevels)[number];

/** Page-count targets understood by the controlled rendering profiles. */
export const writingPolicyPageTargets = ["one-page", "two-page"] as const;
export type WritingPolicyPageTarget = (typeof writingPolicyPageTargets)[number];

/** Maximum number of entries in each bounded writing-policy preference list. */
export const maximumWritingPolicyPreferenceListEntries = 16;
/** Maximum number of Unicode characters accepted for one named preference. */
export const maximumWritingPolicyPreferenceNameLength = 120;
/** Stable aliases kept explicit for callers that name each preference list. */
export const maximumWritingPolicySectionOrderEntries = maximumWritingPolicyPreferenceListEntries;
export const maximumWritingPolicyEmphasisAreaEntries = maximumWritingPolicyPreferenceListEntries;
export const maximumWritingPolicySectionNameLength = maximumWritingPolicyPreferenceNameLength;
export const maximumWritingPolicyEmphasisAreaLength = maximumWritingPolicyPreferenceNameLength;

/**
 * The deterministic section-order check has no provider-generated rule id. Its
 * opaque identity is stable across runs and intentionally reveals no policy or
 * artifact content. The digest is SHA-256("section-order") truncated to the
 * same 24 hexadecimal characters used by compiler-generated policy rules.
 */
export const writingPolicySectionOrderRuleId = "writing-policy-4adab6e59968bb47b65c7c0f";

/**
 * Conservative, human-visible phrases for the application compiler to turn
 * into ordinary forbidden-term rules. This finite list deliberately contains
 * generic résumé clichés rather than a hidden detector, score, or model call.
 */
export const defaultAntiFormulaicTerms = Object.freeze([
  "results-driven",
  "dynamic professional",
  "think outside the box",
  "rockstar",
  "ninja",
  "game changer",
] as const);
/**
 * Conservative BCP-47-shaped syntax for spelling preferences. This is not a
 * locale registry or spell-checking claim; it only bounds and normalizes the
 * syntax accepted at the policy boundary.
 */
export const writingPolicySpellingLocalePattern =
  /^[A-Za-z]{2,8}(?:-[A-Za-z]{4})?(?:-(?:[A-Za-z]{2}|[0-9]{3}))?$/u;
export const maximumWritingPolicySpellingLocaleLength = 16;
const writingPolicyPreferenceKeys = [
  "tone",
  "spellingLocale",
  "verbosity",
  "pageTarget",
  "sectionOrder",
  "emphasisAreas",
] as const;

export interface WritingPolicyForbiddenTermRule {
  readonly id: string;
  readonly kind: "forbidden-term";
  readonly term: string;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
}

export interface WritingPolicyForbiddenCharactersRule {
  readonly id: string;
  readonly kind: "forbidden-characters";
  readonly characters: string;
}

export type WritingPolicyRule =
  | WritingPolicyForbiddenTermRule
  | WritingPolicyForbiddenCharactersRule;

export interface WritingPolicyIdentity {
  readonly version: string;
  readonly checksum: string;
}

export interface WorkspaceWritingPolicyLineage {
  readonly kind: "workspace";
}

export interface OpportunityWritingPolicyLineage {
  readonly kind: "opportunity-override";
  /** Immutable workspace policy identity from which the override was derived. */
  readonly base: WritingPolicyIdentity;
  /** Exact identity of the explicit opportunity override. */
  readonly override: WritingPolicyIdentity;
}

export type WritingPolicyLineage = WorkspaceWritingPolicyLineage | OpportunityWritingPolicyLineage;

export interface WritingPolicyPreferences {
  readonly tone?: WritingPolicyTone;
  readonly spellingLocale?: string;
  readonly verbosity?: WritingPolicyVerbosity;
  readonly pageTarget?: WritingPolicyPageTarget;
  /** Ordered display headings or semantic section kinds. */
  readonly sectionOrder?: readonly string[];
  /** Candidate-approved areas to emphasize; advisory only. */
  readonly emphasisAreas?: readonly string[];
}

export interface WritingPolicy {
  /** Optional on legacy snapshots; normalized to 1 for new snapshots. */
  readonly schemaVersion?: WritingPolicySchemaVersion;
  /** Exact policy text applied to this run. */
  readonly content: string;
  /** SHA-256 of `content`, recorded for audit and change detection. */
  readonly checksum: string;
  /** Stable human-visible version derived from the checksum. */
  readonly version: string;
  /** Optional structured rules; absent on legacy snapshots. */
  readonly rules?: readonly WritingPolicyRule[];
  /** Optional advisory style preferences; absent on legacy snapshots. */
  readonly preferences?: WritingPolicyPreferences;
  /** Source lineage; legacy snapshots may omit it. */
  readonly lineage?: WritingPolicyLineage;
}

export interface ContextSnapshotInput {
  readonly schemaVersion?: number;
  readonly id?: string;
  readonly workspaceId?: string;
  readonly createdAt?: string;
  readonly jobDescription?: string;
  readonly requirements?: readonly JobRequirementInput[];
  /** Accepted for callers migrating from the original workspace input contract. */
  readonly normalizedRequirements?: readonly JobRequirementInput[];
  readonly candidateInstructions?: string;
  /** Accepted for callers migrating from the original workspace input contract. */
  readonly instructions?: string;
  readonly language?: string;
  readonly outputConstraints?: OutputConstraintsInput;
  readonly truthfulnessPolicy?: string;
  readonly writingPolicy?: WritingPolicy;
  readonly readinessRubric?: ReadinessRubricInput;
  readonly evidenceManifest?: readonly EvidenceSourceInput[];
  readonly modelConfiguration?: ModelConfigurationInput;
  readonly candidateKnowledgeSelection?: CandidateKnowledgeSelectionSnapshotInput;
  /** Optional exact reviewed opportunity brief version to bind to this run. */
  readonly opportunityBriefReference?: OpportunityBriefReferenceInput;
  readonly profileId?: string;
}

export interface AgentContextReference {
  readonly contextSnapshotId: ContextSnapshotId;
  readonly role: AgentRole;
  readonly model: ModelSelection;
}

export type SemanticValidationCode =
  | "invalid-input"
  | "missing-required-input"
  | "invalid-value"
  | "provider-diversity-required";

export interface SemanticValidationIssue {
  readonly code: SemanticValidationCode;
  readonly field: string;
  readonly message: string;
}

export interface SemanticValidationResult {
  readonly valid: boolean;
  readonly issues: readonly SemanticValidationIssue[];
}

export class SemanticValidationError extends Error {
  readonly issues: readonly SemanticValidationIssue[];

  constructor(issues: readonly SemanticValidationIssue[]) {
    super(issues.map((issue) => `${issue.field}: ${issue.message}`).join(" "));
    this.name = "SemanticValidationError";
    this.issues = issues;
  }
}

function selectionValidationIssue(
  issues: SemanticValidationIssue[],
  field: string,
  message: string,
): void {
  addIssue(issues, "invalid-value", field, message);
}

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validateCandidateKnowledgeSelectionLifecycleRevision(
  value: unknown,
  field: string,
  issues: SemanticValidationIssue[],
): value is CandidateKnowledgeSelectionLifecycleRevisionInput {
  if (!isRecord(value)) {
    selectionValidationIssue(issues, field, "a lifecycle revision object is required.");
    return false;
  }
  const revision = value as Partial<CandidateKnowledgeSelectionLifecycleRevisionInput>;
  if (
    !candidateKnowledgeBaseStates.includes(
      revision.knowledgeBaseState as CandidateKnowledgeBaseState,
    )
  ) {
    selectionValidationIssue(issues, `${field}.knowledgeBaseState`, "must be active or archived.");
  }
  if (revision.knowledgeBaseState === "active" && revision.knowledgeBaseArchivedAt !== null) {
    selectionValidationIssue(
      issues,
      `${field}.knowledgeBaseArchivedAt`,
      "must be null for an active knowledge base.",
    );
  }
  if (
    revision.knowledgeBaseState === "archived" &&
    !isIsoTimestamp(revision.knowledgeBaseArchivedAt)
  ) {
    selectionValidationIssue(
      issues,
      `${field}.knowledgeBaseArchivedAt`,
      "must be a valid timestamp for an archived knowledge base.",
    );
  }
  if (revision.knowledgeBaseState !== "active" || revision.knowledgeBaseArchivedAt !== null) {
    selectionValidationIssue(
      issues,
      field,
      "selected lifecycle evidence requires an active knowledge base.",
    );
  }
  if (!isNonEmptyString(revision.versionId)) {
    selectionValidationIssue(issues, `${field}.versionId`, "a version id is required.");
  }
  if (!isSafePositiveInteger(revision.version)) {
    selectionValidationIssue(issues, `${field}.version`, "must be a positive safe integer.");
  }
  if (!isIsoTimestamp(revision.createdAt)) {
    selectionValidationIssue(issues, `${field}.createdAt`, "must be a valid ISO timestamp.");
  }
  if (typeof revision.managed !== "boolean") {
    selectionValidationIssue(issues, `${field}.managed`, "must be a boolean.");
  } else if (!revision.managed) {
    selectionValidationIssue(
      issues,
      `${field}.managed`,
      "selected lifecycle evidence requires a managed latest version.",
    );
  }
  if (revision.originBoundAt !== null && !isIsoTimestamp(revision.originBoundAt)) {
    selectionValidationIssue(
      issues,
      `${field}.originBoundAt`,
      "must be null or a valid ISO timestamp.",
    );
  }
  if (revision.provenanceFetchedAt !== null && !isIsoTimestamp(revision.provenanceFetchedAt)) {
    selectionValidationIssue(
      issues,
      `${field}.provenanceFetchedAt`,
      "must be null or a valid ISO timestamp.",
    );
  }
  if (revision.originBoundAt !== null && revision.provenanceFetchedAt !== null) {
    selectionValidationIssue(
      issues,
      field,
      "must not contain both file-origin and URL-provenance evidence.",
    );
  }
  if (
    revision.managed === true &&
    revision.originBoundAt === null &&
    revision.provenanceFetchedAt === null
  ) {
    selectionValidationIssue(
      issues,
      field,
      "managed lifecycle evidence requires an origin or URL provenance timestamp.",
    );
  }

  if (revision.observation !== null) {
    if (!isRecord(revision.observation)) {
      selectionValidationIssue(
        issues,
        `${field}.observation`,
        "must be null or an observation object.",
      );
    } else {
      const observation =
        revision.observation as Partial<CandidateKnowledgeSelectionLifecycleObservationRevision>;
      if (!isNonEmptyString(observation.observedVersionId)) {
        selectionValidationIssue(
          issues,
          `${field}.observation.observedVersionId`,
          "an observed version id is required.",
        );
      }
      if (
        !candidateKnowledgeSelectionLifecycleObservationStatuses.includes(
          observation.status as CandidateKnowledgeSelectionLifecycleObservationStatus,
        )
      ) {
        selectionValidationIssue(
          issues,
          `${field}.observation.status`,
          "must be a recognized refresh status.",
        );
      }
      if (observation.status !== "current" || observation.stale !== false) {
        selectionValidationIssue(
          issues,
          `${field}.observation`,
          "selected lifecycle evidence requires a current, non-stale observation.",
        );
      }
      if (!isIsoTimestamp(observation.checkedAt)) {
        selectionValidationIssue(
          issues,
          `${field}.observation.checkedAt`,
          "must be a valid ISO timestamp.",
        );
      }
      if (
        observation.lastRefreshedVersionId !== null &&
        !isNonEmptyString(observation.lastRefreshedVersionId)
      ) {
        selectionValidationIssue(
          issues,
          `${field}.observation.lastRefreshedVersionId`,
          "must be null or a non-empty version id.",
        );
      }
      if (observation.lastRefreshedAt !== null && !isIsoTimestamp(observation.lastRefreshedAt)) {
        selectionValidationIssue(
          issues,
          `${field}.observation.lastRefreshedAt`,
          "must be null or a valid ISO timestamp.",
        );
      }
      if (
        (observation.lastRefreshedVersionId === null) !==
        (observation.lastRefreshedAt === null)
      ) {
        selectionValidationIssue(
          issues,
          `${field}.observation`,
          "last-refreshed version and timestamp must be paired.",
        );
      }
      if (typeof observation.stale !== "boolean") {
        selectionValidationIssue(issues, `${field}.observation.stale`, "must be a boolean.");
      }
      if (
        isIsoTimestamp(observation.lastRefreshedAt) &&
        isIsoTimestamp(observation.checkedAt) &&
        Date.parse(observation.lastRefreshedAt) > Date.parse(observation.checkedAt)
      ) {
        selectionValidationIssue(
          issues,
          `${field}.observation`,
          "last-refreshed timestamp must not follow checkedAt.",
        );
      }
    }
  }

  if (revision.retirement !== null) {
    selectionValidationIssue(
      issues,
      `${field}.retirement`,
      "selected lifecycle evidence must not be retired.",
    );
    if (!isRecord(revision.retirement)) {
      selectionValidationIssue(
        issues,
        `${field}.retirement`,
        "must be null or a retirement object.",
      );
    } else {
      const retirement =
        revision.retirement as Partial<CandidateKnowledgeSelectionLifecycleRetirementRevision>;
      if (!isIsoTimestamp(retirement.retiredAt)) {
        selectionValidationIssue(
          issues,
          `${field}.retirement.retiredAt`,
          "must be a valid ISO timestamp.",
        );
      }
      if (retirement.reason !== "user-requested") {
        selectionValidationIssue(issues, `${field}.retirement.reason`, "must be user-requested.");
      }
    }
  }

  if (revision.directory !== null) {
    if (!isRecord(revision.directory)) {
      selectionValidationIssue(
        issues,
        `${field}.directory`,
        "must be null or a directory revision object.",
      );
    } else {
      const directory =
        revision.directory as Partial<CandidateKnowledgeSelectionLifecycleDirectoryRevision>;
      if (!isNonEmptyString(directory.directoryId)) {
        selectionValidationIssue(issues, `${field}.directory.directoryId`, "an id is required.");
      }
      if (!isSafePositiveInteger(directory.rootRevision)) {
        selectionValidationIssue(
          issues,
          `${field}.directory.rootRevision`,
          "must be a positive safe integer.",
        );
      }
      if (!isSafePositiveInteger(directory.memberRevision)) {
        selectionValidationIssue(
          issues,
          `${field}.directory.memberRevision`,
          "must be a positive safe integer.",
        );
      }
      if (!isIsoTimestamp(directory.rootBoundAt)) {
        selectionValidationIssue(
          issues,
          `${field}.directory.rootBoundAt`,
          "must be a valid ISO timestamp.",
        );
      }
      if (!isIsoTimestamp(directory.memberBoundAt)) {
        selectionValidationIssue(
          issues,
          `${field}.directory.memberBoundAt`,
          "must be a valid ISO timestamp.",
        );
      }
      if (revision.originBoundAt === null || revision.provenanceFetchedAt !== null) {
        selectionValidationIssue(
          issues,
          `${field}.directory`,
          "directory evidence requires a file origin binding.",
        );
      }
    }
  }
  return true;
}

function validateCandidateKnowledgeSelectionSnapshotInput(
  value: unknown,
  issues: SemanticValidationIssue[],
): value is CandidateKnowledgeSelectionSnapshotInput {
  if (!isRecord(value)) {
    selectionValidationIssue(issues, "candidateKnowledgeSelection", "an object is required.");
    return false;
  }
  const snapshot = value as Partial<CandidateKnowledgeSelectionSnapshotInput>;
  if (
    snapshot.schemaVersion !== undefined &&
    snapshot.schemaVersion !== candidateKnowledgeSelectionSnapshotSchemaVersion
  ) {
    selectionValidationIssue(
      issues,
      "candidateKnowledgeSelection.schemaVersion",
      "only schema version 1 is supported.",
    );
  }
  if (!isIsoTimestamp(snapshot.capturedAt)) {
    selectionValidationIssue(
      issues,
      "candidateKnowledgeSelection.capturedAt",
      "must be a valid ISO timestamp.",
    );
  }
  if (!Array.isArray(snapshot.entries) || snapshot.entries.length === 0) {
    selectionValidationIssue(
      issues,
      "candidateKnowledgeSelection.entries",
      "at least one knowledge-base entry is required.",
    );
    return false;
  }
  const logicalEntries = new Set<string>();
  for (const [entryIndex, entryValue] of snapshot.entries.entries()) {
    const field = `candidateKnowledgeSelection.entries[${entryIndex}]`;
    if (!isRecord(entryValue)) {
      selectionValidationIssue(issues, field, "must be an object.");
      continue;
    }
    const entry = entryValue as Partial<CandidateKnowledgeSelectionSnapshotEntryInput>;
    const storeId = typeof entry.storeId === "string" ? entry.storeId.trim() : "";
    const knowledgeBaseId =
      typeof entry.knowledgeBaseId === "string" ? entry.knowledgeBaseId.trim() : "";
    if (storeId === "") selectionValidationIssue(issues, `${field}.storeId`, "an id is required.");
    if (knowledgeBaseId === "") {
      selectionValidationIssue(issues, `${field}.knowledgeBaseId`, "an id is required.");
    }
    const logicalKey = `${storeId}\u0000${knowledgeBaseId}`;
    if (logicalEntries.has(logicalKey)) {
      selectionValidationIssue(
        issues,
        field,
        "store and knowledge-base selections must be unique.",
      );
    }
    logicalEntries.add(logicalKey);
    if (!Array.isArray(entry.sources) || entry.sources.length === 0) {
      selectionValidationIssue(
        issues,
        `${field}.sources`,
        "at least one lifecycle-ready source is required.",
      );
      continue;
    }
    const sourceIds = new Set<string>();
    for (const [sourceIndex, sourceValue] of entry.sources.entries()) {
      const sourceField = `${field}.sources[${sourceIndex}]`;
      if (!isRecord(sourceValue)) {
        selectionValidationIssue(issues, sourceField, "must be an object.");
        continue;
      }
      const source = sourceValue as Partial<CandidateKnowledgeSelectionSnapshotSourceInput>;
      const sourceId = typeof source.sourceId === "string" ? source.sourceId.trim() : "";
      const versionId = typeof source.versionId === "string" ? source.versionId.trim() : "";
      if (sourceId === "")
        selectionValidationIssue(issues, `${sourceField}.sourceId`, "an id is required.");
      if (versionId === "") {
        selectionValidationIssue(issues, `${sourceField}.versionId`, "an id is required.");
      }
      if (sourceIds.has(sourceId)) {
        selectionValidationIssue(issues, `${sourceField}.sourceId`, "source ids must be unique.");
      }
      sourceIds.add(sourceId);
      validateCandidateKnowledgeSelectionLifecycleRevision(
        source.lifecycleRevision,
        `${sourceField}.lifecycleRevision`,
        issues,
      );
      if (
        isRecord(source.lifecycleRevision) &&
        typeof source.lifecycleRevision.versionId === "string" &&
        source.lifecycleRevision.versionId.trim() !== "" &&
        source.lifecycleRevision.versionId.trim() !== versionId
      ) {
        selectionValidationIssue(
          issues,
          `${sourceField}.versionId`,
          "must match lifecycleRevision.versionId.",
        );
      }
    }
  }
  return true;
}

export function validateCandidateKnowledgeSelectionSnapshot(
  value: unknown,
): SemanticValidationResult {
  const issues: SemanticValidationIssue[] = [];
  validateCandidateKnowledgeSelectionSnapshotInput(value, issues);
  return { valid: issues.length === 0, issues };
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
const canonicalCandidateProfileProvenanceKeys = new Set([
  "storeId",
  "knowledgeBaseId",
  "sourceId",
  "versionId",
  "kind",
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
): value is CanonicalCandidateProfileProvenanceReferenceInput {
  if (!isRecord(value)) {
    addIssue(issues, "invalid-value", field, "must be a provenance reference object.");
    return false;
  }
  validateCanonicalCandidateProfileKeys(
    value,
    canonicalCandidateProfileProvenanceKeys,
    field,
    issues,
  );
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

const opportunityBriefReferenceKeys = new Set(["briefId", "version", "checksum"]);

function validateOpportunityBriefReference(
  value: unknown,
  issues: SemanticValidationIssue[],
): value is OpportunityBriefReferenceInput {
  const field = "opportunityBriefReference";
  if (!isRecord(value)) {
    addIssue(issues, "invalid-value", field, "must be an object when provided.");
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!opportunityBriefReferenceKeys.has(key)) {
      addIssue(issues, "invalid-value", `${field}.${key}`, "is not supported.");
    }
  }
  const reference = value as Partial<OpportunityBriefReferenceInput>;
  if (!isNonEmptyString(reference.briefId)) {
    addIssue(issues, "invalid-value", `${field}.briefId`, "must be a non-empty id.");
  } else if (reference.briefId.trim().length > opportunityBriefMaximumIdLength) {
    addIssue(
      issues,
      "invalid-value",
      `${field}.briefId`,
      `must be at most ${opportunityBriefMaximumIdLength} characters.`,
    );
  }
  if (!isSafePositiveInteger(reference.version)) {
    addIssue(issues, "invalid-value", `${field}.version`, "must be a positive safe integer.");
  }
  if (typeof reference.checksum !== "string" || !/^[a-f0-9]{64}$/u.test(reference.checksum)) {
    addIssue(issues, "invalid-value", `${field}.checksum`, "must be a SHA-256 checksum.");
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.trim()) &&
    !Number.isNaN(Date.parse(value.trim()))
  );
}

function addIssue(
  issues: SemanticValidationIssue[],
  code: SemanticValidationCode,
  field: string,
  message: string,
): void {
  issues.push({ code, field, message });
}

function validateOptionalString(
  value: unknown,
  field: string,
  issues: SemanticValidationIssue[],
  requireNonEmpty = false,
): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "string") {
    addIssue(issues, "invalid-value", field, "must be a string.");
    return;
  }
  if (requireNonEmpty && value.trim() === "") {
    addIssue(issues, "invalid-value", field, "must not be empty.");
  }
}

function validateRequirements(
  input: ContextSnapshotInput,
  issues: SemanticValidationIssue[],
): void {
  const requirements = input.requirements ?? input.normalizedRequirements;
  if (!Array.isArray(requirements) || requirements.length === 0) {
    addIssue(
      issues,
      "missing-required-input",
      "requirements",
      "at least one normalized job requirement is required.",
    );
    return;
  }

  const requirementIds = new Set<string>();
  requirements.forEach((requirement, index) => {
    const field = `requirements[${index}]`;
    if (!isRecord(requirement)) {
      addIssue(issues, "invalid-value", field, "must be an object.");
      return;
    }

    if (!isNonEmptyString(requirement.id)) {
      addIssue(
        issues,
        "invalid-value",
        `${field}.id`,
        "a non-empty stable requirement id is required.",
      );
    } else if (requirementIds.has(requirement.id.trim())) {
      addIssue(issues, "invalid-value", `${field}.id`, "requirement ids must be unique.");
    } else {
      requirementIds.add(requirement.id.trim());
    }
    const text = requirement.text ?? requirement.description;
    if (!isNonEmptyString(text)) {
      addIssue(
        issues,
        "invalid-value",
        `${field}.text`,
        "a non-empty normalized requirement is required.",
      );
    }
    if (!requirementPriorities.includes(requirement.priority as RequirementPriority)) {
      addIssue(
        issues,
        "invalid-value",
        `${field}.priority`,
        `must be one of: ${requirementPriorities.join(", ")}.`,
      );
    }
  });
}

function isValidChecksum(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?:[a-f0-9]{40}|[a-f0-9]{64}|[a-f0-9]{128}|sha1:[a-f0-9]{40}|sha256:[a-f0-9]{64}|sha512:[a-f0-9]{128})$/i.test(
      value,
    )
  );
}

function validateEvidenceManifest(
  input: ContextSnapshotInput,
  issues: SemanticValidationIssue[],
): void {
  if (!Array.isArray(input.evidenceManifest) || input.evidenceManifest.length === 0) {
    addIssue(
      issues,
      "missing-required-input",
      "evidenceManifest",
      "at least one evidence source is required.",
    );
    return;
  }

  const sourceIds = new Set<string>();
  input.evidenceManifest.forEach((source, index) => {
    const field = `evidenceManifest[${index}]`;
    if (!isRecord(source)) {
      addIssue(issues, "invalid-value", field, "must be an object.");
      return;
    }
    if (!isNonEmptyString(source.id)) {
      addIssue(issues, "invalid-value", `${field}.id`, "a non-empty stable source id is required.");
    } else if (sourceIds.has(source.id.trim())) {
      addIssue(issues, "invalid-value", `${field}.id`, "evidence source ids must be unique.");
    } else {
      sourceIds.add(source.id.trim());
    }
    if (!isNonEmptyString(source.path)) {
      addIssue(
        issues,
        "invalid-value",
        `${field}.path`,
        "a non-empty local source path is required.",
      );
    }
    if (!isNonEmptyString(source.mediaType)) {
      addIssue(
        issues,
        "invalid-value",
        `${field}.mediaType`,
        "a non-empty media type is required.",
      );
    }
    if (!isValidChecksum(source.checksum)) {
      addIssue(
        issues,
        "invalid-value",
        `${field}.checksum`,
        "must be a SHA-1, SHA-256, or SHA-512 checksum.",
      );
    }
  });
}

function validateModelSelection(
  selection: unknown,
  role: AgentRole,
  field: string,
  issues: SemanticValidationIssue[],
): selection is ModelSelectionInput {
  if (!isRecord(selection)) {
    addIssue(issues, "missing-required-input", field, `${role} model selection is required.`);
    return false;
  }

  if (!isNonEmptyString(selection.company)) {
    addIssue(issues, "invalid-value", `${field}.company`, "a model company is required.");
  }
  if (!isNonEmptyString(selection.modelId)) {
    addIssue(issues, "invalid-value", `${field}.modelId`, "an exact model id is required.");
  }
  if (selection.role !== role) {
    addIssue(issues, "invalid-value", `${field}.role`, `must be the ${role} role.`);
  }
  if (!isNonEmptyString(selection.promptTemplateVersion)) {
    addIssue(
      issues,
      "invalid-value",
      `${field}.promptTemplateVersion`,
      "a prompt-template version is required.",
    );
  }
  if (selection.lineage !== undefined) {
    // Deliberately does not echo the value: this message reaches logs and UI.
    if (!isNonEmptyString(selection.lineage)) {
      addIssue(
        issues,
        "invalid-value",
        `${field}.lineage`,
        "must be a non-empty model lineage when provided.",
      );
    } else if (selection.lineage.trim().length > maximumModelLineageLength) {
      addIssue(
        issues,
        "invalid-value",
        `${field}.lineage`,
        `must be at most ${maximumModelLineageLength} characters.`,
      );
    }
  }
  return true;
}

function validateModelConfiguration(
  input: ContextSnapshotInput,
  issues: SemanticValidationIssue[],
): void {
  const configuration = input.modelConfiguration;
  if (!isRecord(configuration)) {
    addIssue(
      issues,
      "missing-required-input",
      "modelConfiguration",
      "author and critic model configuration is required before a provider call.",
    );
    return;
  }

  const hasAuthor = validateModelSelection(
    configuration.author,
    "author",
    "modelConfiguration.author",
    issues,
  );
  const hasCritic = validateModelSelection(
    configuration.critic,
    "critic",
    "modelConfiguration.critic",
    issues,
  );
  const requireDiversity = configuration.requireProviderDiversity ?? true;
  if (typeof requireDiversity !== "boolean") {
    addIssue(
      issues,
      "invalid-value",
      "modelConfiguration.requireProviderDiversity",
      "must be a boolean.",
    );
  }

  const rationaleInput = configuration.independenceOverrideRationale;
  const rationaleProblem = independenceOverrideRationaleProblem(rationaleInput);
  if (rationaleProblem !== undefined) {
    addIssue(
      issues,
      "invalid-value",
      "modelConfiguration.independenceOverrideRationale",
      rationaleProblem,
    );
  }
  const recordedRationale = recordedOverrideRationale(configuration);

  if (requireDiversity !== true || !hasAuthor || !hasCritic) return;
  const author = configuration.author as ModelSelectionInput;
  const critic = configuration.critic as ModelSelectionInput;
  if (!isNonEmptyString(author.company) || !isNonEmptyString(critic.company)) return;
  if (!isNonEmptyString(author.modelId) || !isNonEmptyString(critic.modelId)) return;
  if (deriveModelLineage(author) !== deriveModelLineage(critic)) return;
  if (rationaleProblem === undefined && isNonEmptyString(rationaleInput)) return;
  if (recordedRationale !== undefined) return;
  addIssue(issues, "provider-diversity-required", "modelConfiguration", sharedLineageMessage);
}

function validateRubric(input: ContextSnapshotInput, issues: SemanticValidationIssue[]): void {
  if (!isRecord(input.readinessRubric)) {
    addIssue(
      issues,
      "missing-required-input",
      "readinessRubric",
      "a readiness rubric is required.",
    );
    return;
  }
  for (const dimension of readinessDimensions) {
    const score = input.readinessRubric[dimension];
    if (!isFiniteNumber(score) || score < 0 || score > 1) {
      addIssue(
        issues,
        "invalid-value",
        `readinessRubric.${dimension}`,
        "must be a finite number between 0 and 1.",
      );
    }
  }
}

function validateOutputConstraints(
  input: ContextSnapshotInput,
  issues: SemanticValidationIssue[],
): void {
  if (input.outputConstraints === undefined) {
    return;
  }
  if (!isRecord(input.outputConstraints)) {
    addIssue(issues, "invalid-value", "outputConstraints", "must be an object.");
    return;
  }
  const constraints = input.outputConstraints as OutputConstraintsInput;
  validateOptionalString(constraints.tone, "outputConstraints.tone", issues, true);
  if (
    constraints.format !== undefined &&
    !outputFormats.includes(constraints.format as OutputFormat)
  ) {
    addIssue(
      issues,
      "invalid-value",
      "outputConstraints.format",
      `must be one of: ${outputFormats.join(", ")}.`,
    );
  }
  for (const key of ["maxWords", "maxCharacters", "maxLength"] as const) {
    const value = constraints[key];
    if (value !== undefined && (!isFiniteNumber(value) || value <= 0)) {
      addIssue(
        issues,
        "invalid-value",
        `outputConstraints.${key}`,
        "must be a positive finite number.",
      );
    }
  }
  if (constraints.requiredSections !== undefined) {
    if (!Array.isArray(constraints.requiredSections)) {
      addIssue(issues, "invalid-value", "outputConstraints.requiredSections", "must be an array.");
    } else if (constraints.requiredSections.some((section) => !isNonEmptyString(section))) {
      addIssue(
        issues,
        "invalid-value",
        "outputConstraints.requiredSections",
        "must contain only non-empty section names.",
      );
    }
  }
}

function isForbiddenWritingPolicyCharacter(value: string): boolean {
  return !/[\p{L}\p{N}\s]/u.test(value);
}

function isWritingPolicyTone(value: unknown): value is WritingPolicyTone {
  return (
    typeof value === "string" &&
    writingPolicyTones.includes(value.trim().toLowerCase() as WritingPolicyTone)
  );
}

function isWritingPolicyVerbosity(value: unknown): value is WritingPolicyVerbosity {
  return (
    typeof value === "string" &&
    writingPolicyVerbosityLevels.includes(value.trim().toLowerCase() as WritingPolicyVerbosity)
  );
}

function isWritingPolicySpellingLocale(value: unknown): value is string {
  return (
    isNonEmptyString(value) &&
    [...value.trim()].length <= maximumWritingPolicySpellingLocaleLength &&
    writingPolicySpellingLocalePattern.test(value.trim())
  );
}

function normalizeWritingPolicyPreferenceName(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function writingPolicyPreferenceIdentity(value: string): string {
  return normalizeWritingPolicyPreferenceName(value).normalize("NFKC").toLowerCase();
}

function validateWritingPolicyPreferenceNames(
  value: unknown,
  field: string,
  issues: SemanticValidationIssue[],
  label: string,
): value is readonly string[] {
  if (!Array.isArray(value)) {
    addIssue(issues, "invalid-value", field, `must be an array of ${label}.`);
    return false;
  }
  if (value.length === 0) {
    addIssue(issues, "invalid-value", field, `must contain at least one ${label}.`);
  }
  if (value.length > maximumWritingPolicyPreferenceListEntries) {
    addIssue(
      issues,
      "invalid-value",
      field,
      `must contain at most ${maximumWritingPolicyPreferenceListEntries} entries.`,
    );
  }
  const identities = new Set<string>();
  value.forEach((entry, index) => {
    const entryField = `${field}[${index}]`;
    if (!isNonEmptyString(entry)) {
      addIssue(issues, "invalid-value", entryField, `${label} must not be empty.`);
      return;
    }
    if ([...entry.trim()].length > maximumWritingPolicyPreferenceNameLength) {
      addIssue(
        issues,
        "invalid-value",
        entryField,
        `${label} must be at most ${maximumWritingPolicyPreferenceNameLength} characters.`,
      );
    }
    const identity = writingPolicyPreferenceIdentity(entry);
    if (identities.has(identity)) {
      addIssue(issues, "invalid-value", entryField, `${label} must be unique.`);
    }
    identities.add(identity);
  });
  return true;
}

/** Normalize the conservative locale syntax without consulting a registry. */
export function normalizeWritingPolicySpellingLocale(value: string): string {
  return value
    .trim()
    .split("-")
    .map((part, index) => {
      if (index === 0) return part.toLowerCase();
      if (part.length === 4) {
        return `${part[0]?.toUpperCase() ?? ""}${part.slice(1).toLowerCase()}`;
      }
      if (part.length === 2) return part.toUpperCase();
      return part;
    })
    .join("-");
}

function validateWritingPolicyIdentity(
  value: unknown,
  field: string,
  issues: SemanticValidationIssue[],
): value is WritingPolicyIdentity {
  if (!isRecord(value)) {
    addIssue(issues, "invalid-value", field, "must be a writing policy identity object.");
    return false;
  }
  const identity = value as Partial<WritingPolicyIdentity>;
  let valid = true;
  if (!isNonEmptyString(identity.version)) {
    addIssue(issues, "invalid-value", `${field}.version`, "must not be empty.");
    valid = false;
  }
  if (!isNonEmptyString(identity.checksum) || !/^[a-f0-9]{64}$/iu.test(identity.checksum)) {
    addIssue(issues, "invalid-value", `${field}.checksum`, "must be a SHA-256 checksum.");
    valid = false;
  }
  for (const key of Object.keys(identity)) {
    if (key !== "version" && key !== "checksum") {
      addIssue(issues, "invalid-value", `${field}.${key}`, "is not supported.");
      valid = false;
    }
  }
  return valid;
}

function validateWritingPolicyLineage(
  value: unknown,
  field: string,
  policy: Partial<WritingPolicy>,
  issues: SemanticValidationIssue[],
): value is WritingPolicyLineage {
  if (!isRecord(value)) {
    addIssue(issues, "invalid-value", field, "must be a writing policy lineage object.");
    return false;
  }
  if (value.kind === "workspace") {
    for (const key of Object.keys(value)) {
      if (key !== "kind") {
        addIssue(issues, "invalid-value", `${field}.${key}`, "is not supported.");
      }
    }
    return true;
  }
  if (value.kind !== "opportunity-override") {
    addIssue(
      issues,
      "invalid-value",
      `${field}.kind`,
      "must be workspace or opportunity-override.",
    );
    return false;
  }
  for (const key of Object.keys(value)) {
    if (key !== "kind" && key !== "base" && key !== "override") {
      addIssue(issues, "invalid-value", `${field}.${key}`, "is not supported.");
    }
  }
  const hasBase = validateWritingPolicyIdentity(value.base, `${field}.base`, issues);
  const hasOverride = validateWritingPolicyIdentity(value.override, `${field}.override`, issues);
  if (hasBase && hasOverride) {
    const base = value.base as WritingPolicyIdentity;
    const override = value.override as WritingPolicyIdentity;
    if (base.checksum.trim().toLowerCase() === override.checksum.trim().toLowerCase()) {
      addIssue(
        issues,
        "invalid-value",
        `${field}.override.checksum`,
        "must differ from the immutable base policy checksum.",
      );
    }
    if (isNonEmptyString(policy.version) && override.version.trim() !== policy.version.trim()) {
      addIssue(
        issues,
        "invalid-value",
        `${field}.override.version`,
        "must match the current policy version.",
      );
    }
    if (
      isNonEmptyString(policy.checksum) &&
      override.checksum.trim().toLowerCase() !== policy.checksum.trim().toLowerCase()
    ) {
      addIssue(
        issues,
        "invalid-value",
        `${field}.override.checksum`,
        "must match the current policy checksum.",
      );
    }
  }
  return true;
}

function validateWritingPolicyPreferences(
  value: unknown,
  field: string,
  issues: SemanticValidationIssue[],
): value is WritingPolicyPreferences {
  if (!isRecord(value)) {
    addIssue(issues, "invalid-value", field, "must be a writing policy preferences object.");
    return false;
  }
  const preferences = value as Partial<WritingPolicyPreferences>;
  for (const key of Object.keys(preferences)) {
    if (
      !writingPolicyPreferenceKeys.includes(key as (typeof writingPolicyPreferenceKeys)[number])
    ) {
      addIssue(issues, "invalid-value", `${field}.${key}`, "is not a supported preference.");
    }
  }
  if (preferences.tone !== undefined && !isWritingPolicyTone(preferences.tone)) {
    addIssue(issues, "invalid-value", `${field}.tone`, "must be a supported writing policy tone.");
  }
  if (
    preferences.spellingLocale !== undefined &&
    !isWritingPolicySpellingLocale(preferences.spellingLocale)
  ) {
    addIssue(
      issues,
      "invalid-value",
      `${field}.spellingLocale`,
      "must be a bounded BCP-47-shaped spelling locale.",
    );
  }
  if (preferences.verbosity !== undefined && !isWritingPolicyVerbosity(preferences.verbosity)) {
    addIssue(
      issues,
      "invalid-value",
      `${field}.verbosity`,
      "must be a supported writing policy verbosity.",
    );
  }
  if (
    preferences.pageTarget !== undefined &&
    (typeof preferences.pageTarget !== "string" ||
      !writingPolicyPageTargets.includes(
        preferences.pageTarget.trim().toLowerCase() as WritingPolicyPageTarget,
      ))
  ) {
    addIssue(issues, "invalid-value", `${field}.pageTarget`, "must be one-page or two-page.");
  }
  if (preferences.sectionOrder !== undefined) {
    validateWritingPolicyPreferenceNames(
      preferences.sectionOrder,
      `${field}.sectionOrder`,
      issues,
      "section names",
    );
  }
  if (preferences.emphasisAreas !== undefined) {
    validateWritingPolicyPreferenceNames(
      preferences.emphasisAreas,
      `${field}.emphasisAreas`,
      issues,
      "emphasis areas",
    );
  }
  return true;
}

function validateWritingPolicy(
  value: unknown,
  field: string,
  issues: SemanticValidationIssue[],
): value is WritingPolicy {
  if (!isRecord(value)) {
    addIssue(issues, "invalid-value", field, "must be a writing policy object.");
    return false;
  }
  const policy = value as Partial<WritingPolicy>;
  for (const key of Object.keys(policy)) {
    if (
      key !== "schemaVersion" &&
      key !== "content" &&
      key !== "checksum" &&
      key !== "version" &&
      key !== "rules" &&
      key !== "preferences" &&
      key !== "lineage"
    ) {
      addIssue(issues, "invalid-value", `${field}.${key}`, "is not supported.");
    }
  }
  if (policy.schemaVersion !== undefined && policy.schemaVersion !== writingPolicySchemaVersion) {
    addIssue(
      issues,
      "invalid-value",
      `${field}.schemaVersion`,
      `only writing policy schema version ${writingPolicySchemaVersion} is supported.`,
    );
  }
  if (!isNonEmptyString(policy.content)) {
    addIssue(issues, "invalid-value", `${field}.content`, "must not be empty.");
  }
  if (!isNonEmptyString(policy.checksum) || !/^[a-f0-9]{64}$/iu.test(policy.checksum)) {
    addIssue(issues, "invalid-value", `${field}.checksum`, "must be a SHA-256 checksum.");
  }
  if (!isNonEmptyString(policy.version)) {
    addIssue(issues, "invalid-value", `${field}.version`, "must not be empty.");
  }
  if (policy.lineage !== undefined) {
    validateWritingPolicyLineage(policy.lineage, `${field}.lineage`, policy, issues);
  }
  if (policy.preferences !== undefined) {
    validateWritingPolicyPreferences(policy.preferences, `${field}.preferences`, issues);
  }
  if (policy.rules === undefined) return true;
  if (!Array.isArray(policy.rules)) {
    addIssue(issues, "invalid-value", `${field}.rules`, "must be an array when provided.");
    return true;
  }
  if (policy.rules.length > maximumWritingPolicyRules) {
    addIssue(
      issues,
      "invalid-value",
      `${field}.rules`,
      `must contain at most ${maximumWritingPolicyRules} rules.`,
    );
  }
  const ruleIds = new Set<string>();
  for (const [index, value] of policy.rules.entries()) {
    const ruleField = `${field}.rules[${index}]`;
    if (!isRecord(value)) {
      addIssue(issues, "invalid-value", ruleField, "must be a rule object.");
      continue;
    }
    const rule = value as Partial<WritingPolicyRule>;
    if (!isNonEmptyString(rule.id)) {
      addIssue(issues, "invalid-value", `${ruleField}.id`, "must not be empty.");
    } else {
      if (!writingPolicyRuleIdPattern.test(rule.id.trim())) {
        addIssue(issues, "invalid-value", `${ruleField}.id`, "must be an opaque compiler rule id.");
      }
      const normalizedId = rule.id.trim();
      if (ruleIds.has(normalizedId)) {
        addIssue(issues, "invalid-value", `${ruleField}.id`, "rule ids must be unique.");
      }
      ruleIds.add(normalizedId);
    }
    if (!writingPolicyRuleKinds.includes(rule.kind as WritingPolicyRuleKind)) {
      addIssue(issues, "invalid-value", `${ruleField}.kind`, "must be a recognized rule kind.");
      continue;
    }
    if (rule.kind === "forbidden-term") {
      if (!isNonEmptyString(rule.term)) {
        addIssue(issues, "invalid-value", `${ruleField}.term`, "must not be empty.");
      } else if (rule.term.trim().length > maximumWritingPolicyTermLength) {
        addIssue(
          issues,
          "invalid-value",
          `${ruleField}.term`,
          `must be at most ${maximumWritingPolicyTermLength} characters.`,
        );
      }
      if (typeof rule.caseSensitive !== "boolean") {
        addIssue(issues, "invalid-value", `${ruleField}.caseSensitive`, "must be a boolean.");
      }
      if (typeof rule.wholeWord !== "boolean") {
        addIssue(issues, "invalid-value", `${ruleField}.wholeWord`, "must be a boolean.");
      }
    } else if (rule.kind === "forbidden-characters") {
      if (typeof rule.characters !== "string" || rule.characters.length === 0) {
        addIssue(issues, "invalid-value", `${ruleField}.characters`, "must not be empty.");
        continue;
      }
      const characters = [...rule.characters];
      if (characters.length > maximumWritingPolicyCharactersLength) {
        addIssue(
          issues,
          "invalid-value",
          `${ruleField}.characters`,
          `must contain at most ${maximumWritingPolicyCharactersLength} characters.`,
        );
      }
      if (new Set(characters).size !== characters.length) {
        addIssue(
          issues,
          "invalid-value",
          `${ruleField}.characters`,
          "must contain unique characters.",
        );
      }
      if (characters.some((character) => !isForbiddenWritingPolicyCharacter(character))) {
        addIssue(
          issues,
          "invalid-value",
          `${ruleField}.characters`,
          "must contain only non-alphanumeric, non-whitespace characters.",
        );
      }
    }
  }
  return true;
}

/** Validate one policy without requiring callers to construct a full context. */
export function validateWritingPolicyInput(value: unknown): SemanticValidationResult {
  const issues: SemanticValidationIssue[] = [];
  validateWritingPolicy(value, "writingPolicy", issues);
  return { valid: issues.length === 0, issues };
}

export function validateContextSnapshotInput(input: unknown): SemanticValidationResult {
  const issues: SemanticValidationIssue[] = [];
  if (!isRecord(input)) {
    return {
      valid: false,
      issues: [
        {
          code: "invalid-input",
          field: "input",
          message: "a context snapshot input object is required.",
        },
      ],
    };
  }

  const candidate = input as ContextSnapshotInput;
  if (candidate.schemaVersion !== undefined && candidate.schemaVersion !== contextSchemaVersion) {
    addIssue(issues, "invalid-value", "schemaVersion", "only schema version 1 is supported.");
  }
  if (!isNonEmptyString(candidate.id)) {
    addIssue(
      issues,
      "missing-required-input",
      "id",
      "a caller-provided context snapshot id is required.",
    );
  }
  if (!isNonEmptyString(candidate.workspaceId)) {
    addIssue(issues, "missing-required-input", "workspaceId", "a workspace id is required.");
  }
  if (!isIsoTimestamp(candidate.createdAt)) {
    addIssue(issues, "invalid-value", "createdAt", "a valid creation timestamp is required.");
  }
  if (!isNonEmptyString(candidate.jobDescription)) {
    addIssue(
      issues,
      "missing-required-input",
      "jobDescription",
      "a non-empty job description is required.",
    );
  }
  if (!isNonEmptyString(candidate.language)) {
    addIssue(
      issues,
      "missing-required-input",
      "language",
      "a non-empty output language is required.",
    );
  }
  validateOptionalString(candidate.candidateInstructions, "candidateInstructions", issues);
  validateOptionalString(candidate.instructions, "instructions", issues);
  validateOptionalString(candidate.truthfulnessPolicy, "truthfulnessPolicy", issues, true);
  if (candidate.writingPolicy !== undefined) {
    validateWritingPolicy(candidate.writingPolicy, "writingPolicy", issues);
  }
  validateRequirements(candidate, issues);
  validateEvidenceManifest(candidate, issues);
  validateModelConfiguration(candidate, issues);
  validateRubric(candidate, issues);
  validateOutputConstraints(candidate, issues);
  if (candidate.candidateKnowledgeSelection !== undefined) {
    const selectionValidation = validateCandidateKnowledgeSelectionSnapshot(
      candidate.candidateKnowledgeSelection,
    );
    for (const issue of selectionValidation.issues) {
      addIssue(issues, issue.code, issue.field, issue.message);
    }
  }
  if (candidate.opportunityBriefReference !== undefined) {
    validateOpportunityBriefReference(candidate.opportunityBriefReference, issues);
  }

  return { valid: issues.length === 0, issues };
}

function cloneAndFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    const clone = value.map((item) => cloneAndFreeze(item));
    return Object.freeze(clone) as T;
  }
  if (isRecord(value)) {
    const clone: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      clone[key] = cloneAndFreeze(item);
    }
    return Object.freeze(clone) as T;
  }
  return value;
}

function normalizeWritingPolicyRule(rule: WritingPolicyRule): WritingPolicyRule {
  if (rule.kind === "forbidden-term") {
    return {
      id: rule.id.trim(),
      kind: rule.kind,
      term: rule.term.trim(),
      caseSensitive: rule.caseSensitive,
      wholeWord: rule.wholeWord,
    };
  }
  return {
    id: rule.id.trim(),
    kind: rule.kind,
    characters: rule.characters,
  };
}

function normalizeWritingPolicyPreferences(
  preferences: WritingPolicyPreferences,
): WritingPolicyPreferences {
  return {
    ...(preferences.tone === undefined
      ? {}
      : { tone: preferences.tone.trim().toLowerCase() as WritingPolicyTone }),
    ...(preferences.spellingLocale === undefined
      ? {}
      : { spellingLocale: normalizeWritingPolicySpellingLocale(preferences.spellingLocale) }),
    ...(preferences.verbosity === undefined
      ? {}
      : { verbosity: preferences.verbosity.trim().toLowerCase() as WritingPolicyVerbosity }),
    ...(preferences.pageTarget === undefined
      ? {}
      : { pageTarget: preferences.pageTarget.trim().toLowerCase() as WritingPolicyPageTarget }),
    ...(preferences.sectionOrder === undefined
      ? {}
      : {
          sectionOrder: preferences.sectionOrder.map(normalizeWritingPolicyPreferenceName),
        }),
    ...(preferences.emphasisAreas === undefined
      ? {}
      : {
          emphasisAreas: preferences.emphasisAreas.map(normalizeWritingPolicyPreferenceName),
        }),
  };
}

function normalizeWritingPolicyIdentity(identity: WritingPolicyIdentity): WritingPolicyIdentity {
  return {
    version: identity.version.trim(),
    checksum: identity.checksum.trim().toLowerCase(),
  };
}

function normalizeWritingPolicyLineage(lineage: WritingPolicyLineage): WritingPolicyLineage {
  if (lineage.kind === "workspace") return { kind: "workspace" };
  return {
    kind: "opportunity-override",
    base: normalizeWritingPolicyIdentity(lineage.base),
    override: normalizeWritingPolicyIdentity(lineage.override),
  };
}

function normalizeSelectionLifecycleRevision(
  revision: CandidateKnowledgeSelectionLifecycleRevisionInput,
): CandidateKnowledgeSelectionLifecycleRevision {
  return {
    knowledgeBaseState: revision.knowledgeBaseState,
    knowledgeBaseArchivedAt:
      revision.knowledgeBaseArchivedAt === null ? null : revision.knowledgeBaseArchivedAt.trim(),
    versionId: revision.versionId.trim(),
    version: revision.version,
    createdAt: revision.createdAt.trim(),
    managed: revision.managed,
    originBoundAt: revision.originBoundAt === null ? null : revision.originBoundAt.trim(),
    observation:
      revision.observation === null
        ? null
        : {
            observedVersionId: revision.observation.observedVersionId.trim(),
            status: revision.observation.status,
            checkedAt: revision.observation.checkedAt.trim(),
            lastRefreshedVersionId:
              revision.observation.lastRefreshedVersionId === null
                ? null
                : revision.observation.lastRefreshedVersionId.trim(),
            lastRefreshedAt:
              revision.observation.lastRefreshedAt === null
                ? null
                : revision.observation.lastRefreshedAt.trim(),
            stale: revision.observation.stale,
          },
    retirement:
      revision.retirement === null
        ? null
        : {
            retiredAt: revision.retirement.retiredAt.trim(),
            reason: revision.retirement.reason,
          },
    provenanceFetchedAt:
      revision.provenanceFetchedAt === null ? null : revision.provenanceFetchedAt.trim(),
    directory:
      revision.directory === null
        ? null
        : {
            directoryId: revision.directory.directoryId.trim(),
            rootRevision: revision.directory.rootRevision,
            rootBoundAt: revision.directory.rootBoundAt.trim(),
            memberRevision: revision.directory.memberRevision,
            memberBoundAt: revision.directory.memberBoundAt.trim(),
          },
  };
}

function normalizeOpportunityBriefReference(
  reference: OpportunityBriefReferenceInput,
): OpportunityBriefReference {
  return {
    briefId: reference.briefId.trim(),
    version: reference.version,
    checksum: reference.checksum.toLowerCase(),
  };
}

export function createCandidateKnowledgeSelectionSnapshot(
  input: CandidateKnowledgeSelectionSnapshotInput,
): CandidateKnowledgeSelectionSnapshot {
  const validation = validateCandidateKnowledgeSelectionSnapshot(input);
  if (!validation.valid) {
    throw new SemanticValidationError(validation.issues);
  }

  const entries = input.entries
    .map((entry) => ({
      storeId: entry.storeId.trim() as CandidateKnowledgeStoreId,
      knowledgeBaseId: entry.knowledgeBaseId.trim() as CandidateKnowledgeBaseId,
      sources: entry.sources
        .map((source) => ({
          sourceId: source.sourceId.trim() as CandidateKnowledgeSourceId,
          versionId: source.versionId.trim() as CandidateKnowledgeSourceVersionId,
          lifecycleRevision: normalizeSelectionLifecycleRevision(source.lifecycleRevision),
        }))
        .sort((left, right) => {
          const sourceOrder =
            left.sourceId < right.sourceId ? -1 : left.sourceId > right.sourceId ? 1 : 0;
          if (sourceOrder !== 0) return sourceOrder;
          return left.versionId < right.versionId ? -1 : left.versionId > right.versionId ? 1 : 0;
        }),
    }))
    .sort((left, right) => {
      if (left.storeId !== right.storeId) return left.storeId < right.storeId ? -1 : 1;
      if (left.knowledgeBaseId !== right.knowledgeBaseId) {
        return left.knowledgeBaseId < right.knowledgeBaseId ? -1 : 1;
      }
      return 0;
    });

  return cloneAndFreeze({
    schemaVersion: candidateKnowledgeSelectionSnapshotSchemaVersion,
    capturedAt: input.capturedAt.trim(),
    entries,
  });
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

function normalizeCanonicalCandidateProfileFact(
  fact: CanonicalCandidateProfileFactInput,
): CanonicalCandidateProfileFact {
  const provenance = fact.provenance
    .map(normalizeCanonicalCandidateProfileProvenanceReference)
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
    facts,
    issues,
  });
}

function normalizeRequirement(requirement: JobRequirementInput): JobRequirement {
  return {
    id: requirement.id?.trim() as JobRequirementId,
    text: (requirement.text ?? requirement.description)?.trim() as string,
    priority: requirement.priority as RequirementPriority,
  };
}

function normalizeEvidenceSource(source: EvidenceSourceInput): EvidenceSource {
  return {
    id: source.id?.trim() as EvidenceSourceId,
    path: source.path?.trim() as string,
    mediaType: source.mediaType?.trim() as string,
    checksum: source.checksum as string,
    ...(source.profileId ? { profileId: source.profileId.trim() as ProfileId } : {}),
  };
}

function normalizeModelSelection(selection: ModelSelectionInput): ModelSelection {
  return {
    company: selection.company?.trim() as ModelCompany,
    modelId: selection.modelId?.trim() as string,
    role: selection.role as AgentRole,
    promptTemplateVersion: selection.promptTemplateVersion?.trim() as string,
    ...(isNonEmptyString(selection.lineage)
      ? { lineage: normalizeLineageLabel(selection.lineage) }
      : {}),
  };
}

function normalizeModelConfiguration(configuration: ModelConfigurationInput): ModelConfiguration {
  const author = normalizeModelSelection(configuration.author as ModelSelectionInput);
  const critic = normalizeModelSelection(configuration.critic as ModelSelectionInput);
  const required = configuration.requireProviderDiversity ?? true;
  const rationale =
    configuration.independenceOverrideRationale ??
    recordedOverrideRationale(configuration as unknown as Record<string, unknown>);
  return {
    author,
    critic,
    requireProviderDiversity: required,
    independentReview: describeIndependentReview(author, critic, {
      required,
      ...(rationale === undefined ? {} : { overrideRationale: rationale }),
    }),
  };
}

/**
 * Fold away differences that are spelling rather than lineage.
 *
 * `Local-A`, `local-a `, and `local  a` are one claim, not three; without this
 * a typo would read as independence, which is the failure mode this whole
 * mechanism exists to avoid.
 */
export function normalizeLineageLabel(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

/** The fields a lineage can be read or derived from, declared or persisted. */
export interface ModelLineageSource {
  readonly company?: string | undefined;
  readonly modelId?: string | undefined;
  readonly lineage?: string | undefined;
}

/**
 * Region segments a cloud route can prefix onto a model id.
 *
 * A cross-region inference profile says where a request is served, which is
 * routing and not weights: `us.anthropic.claude-...` and
 * `eu.anthropic.claude-...` are one model reached twice.
 */
const cloudRouteRegions: ReadonlySet<string> = new Set(["us", "us-gov", "eu", "apac", "global"]);

/**
 * Vendor segments a marketplace route can qualify a model id with.
 *
 * These are the namespaces a reseller uses to say whose weights it serves, as
 * in `anthropic.claude-...` or `meta.llama3-...`. Recovering the vendor is what
 * lets a resold route meet the direct one: the reseller's company string
 * (`bedrock`) records who bills for the call, not who trained the model.
 *
 * A name that does not belong here can only affect a model id literally shaped
 * `name.rest`, and the result is always recoverable by declaring a lineage.
 */
const cloudRouteVendors: ReadonlySet<string> = new Set([
  "ai21",
  "amazon",
  "anthropic",
  "cohere",
  "deepseek",
  "google",
  "meta",
  "mistral",
  "openai",
  "qwen",
]);

/** A model id with recognized provider-route decoration removed. */
export interface CanonicalModelId {
  /** The vendor the route named, when it named one. */
  readonly vendor?: string;
  /** What remains of the id once recognized decoration is stripped. */
  readonly baseModelId: string;
}

/** Whether a stripped remainder is still a model id rather than a fragment. */
function keepsAModelName(rest: string): boolean {
  return /[a-z]/u.test(rest);
}

/**
 * Recover the base model id a provider route decorates.
 *
 * Route decoration is everything a host adds to say how it serves a model
 * rather than which model it is: a region segment, a vendor segment, a
 * deployment version, a dated snapshot, a moving `latest` pointer. Stripping it
 * is what makes `claude-sonnet-4-5`, `claude-sonnet-4-5-20250929`, and
 * `us.anthropic.claude-sonnet-4-5-20250929-v1:0` one lineage.
 *
 * Every rule is anchored on a literal shape, never on a guess about what a
 * family name means, because over-merging is the worse failure here: it refuses
 * a legitimate pairing. Nothing that distinguishes family, size, or major
 * version is ever stripped, so `claude-opus-5` and `claude-sonnet-4-5` stay
 * apart, as do `llama-3-8b` and `llama-4-70b`.
 */
export function canonicalizeModelId(modelId: string): CanonicalModelId {
  const normalized = normalizeLineageLabel(modelId);
  if (normalized === "") return { baseModelId: "" };

  // Route prefix. Segments are consumed left to right and only when they are
  // recognized, so an id whose dots are version punctuation — `gpt-4.1`,
  // `llama-3.1-8b` — keeps every segment it has.
  const segments = normalized.split(".");
  let index = 0;
  let vendor: string | undefined;
  const segmentAt = (position: number): string =>
    segments.length - position >= 2 ? (segments[position] ?? "") : "";
  if (cloudRouteRegions.has(segmentAt(index))) {
    index += 1;
  }
  const vendorSegment = segmentAt(index);
  if (cloudRouteVendors.has(vendorSegment)) {
    vendor = vendorSegment;
    index += 1;
  }
  // Dots that were not route segments are left alone. `gpt-5.6-luna` and
  // `llama3.2` spell a version with a dot, and rewriting that punctuation would
  // change the recorded lineage of ids that carry no route decoration at all.
  let rest = segments.slice(index).join(".");

  // Suffix decoration, innermost last. The loop reruns because a real id can
  // carry several layers at once, as in `...-20250929-v1:0`.
  for (;;) {
    // A deployment version tag such as `:0`, or a context variant such as
    // `:200k`. Both name a way of serving one set of weights.
    const withoutVersionTag = rest.replace(/:[a-z0-9]+$/u, "");
    if (withoutVersionTag !== rest && withoutVersionTag !== "") {
      rest = withoutVersionTag;
      continue;
    }
    // A marketplace revision such as `-v1`. Guarded on the remainder still
    // carrying a digit, so the `-v2` in `claude-v2` — which is the model's own
    // version, not the route's — survives.
    const withoutRevision = rest.replace(/-v\d+$/u, "");
    if (withoutRevision !== rest && /\d/u.test(withoutRevision)) {
      rest = withoutRevision;
      continue;
    }
    // A dated snapshot, compact (`-20250929`) or dashed (`-2024-08-06`). Both
    // are pinned releases of the id that precedes them.
    const withoutDate = rest
      .replace(/-(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/u, "")
      .replace(/-(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u, "");
    if (withoutDate !== rest && keepsAModelName(withoutDate)) {
      rest = withoutDate;
      continue;
    }
    // A moving pointer. `-latest` names whichever snapshot is current, so it
    // belongs with the snapshots rather than beside them.
    const withoutPointer = rest.replace(/-latest$/u, "");
    if (withoutPointer !== rest && keepsAModelName(withoutPointer)) {
      rest = withoutPointer;
      continue;
    }
    break;
  }

  return { ...(vendor === undefined ? {} : { vendor }), baseModelId: rest };
}

/**
 * Model ids whose lineage the id itself cannot reveal.
 *
 * Keyed on the normalized model id and valued with the lineage it resolves to,
 * whatever company serves it: an alias identifies weights, and who bills for
 * the call does not change them. Route decoration needs no entry here —
 * `canonicalizeModelId` recovers it — so this table is only for names that
 * share no visible structure with the model they serve.
 *
 * The bar for an entry is evidence, not plausibility. A wrong entry refuses a
 * legitimate pairing, and mappings between vendor ids and base weights go stale
 * quickly, so an entry is added only with a comment saying what it is based on.
 *
 * The table is empty. That is a statement about the evidence available here,
 * not about the world: **an absent entry is not evidence that two models are
 * independent**, only that this table cannot say. Two hosts serving one base
 * model under unrelated names still pass the gate, which is why the lineage
 * claim is recorded at the approval boundary rather than trusted.
 */
const curatedModelLineages: ReadonlyMap<string, string> = new Map<string, string>([]);

/**
 * The curated lineage for a model id, or undefined when the table has none.
 *
 * Undefined means unknown, never independent; see `curatedModelLineages`.
 */
export function curatedModelLineage(modelId: string): string | undefined {
  return curatedModelLineages.get(normalizeLineageLabel(modelId));
}

/**
 * The lineage a selection claims, declared or derived.
 *
 * Precedence is declared, then curated, then derived. A declared lineage always
 * wins, so a curated answer an operator disagrees with is recoverable by
 * declaring one; the derived form is the fallback for everything unrecognized.
 *
 * The derived form is `<company>:<modelId>`, which is what keeps existing
 * workspaces working without migration: `anthropic` and `openai` selections
 * still differ, and `claude-opus-5` differs from `claude-haiku-4-5`. The
 * curated layer rewrites either half of that form when the id says so — a route
 * that names its vendor replaces the company, because `bedrock` describes the
 * bill and `anthropic` describes the weights — and leaves both halves alone for
 * an id it does not recognize.
 *
 * This is the only place a lineage is computed. A lineage is a claim, never a
 * measurement: nothing here can tell whether two labels denote the same
 * weights, which is why the claim is recorded rather than trusted. The curated
 * layer narrows the gap between the claim and the weights; it does not close
 * it, and two models it cannot relate are not thereby independent.
 */
export function deriveModelLineage(selection: ModelLineageSource): string {
  const declared = selection.lineage;
  if (typeof declared === "string" && declared.trim() !== "") {
    return normalizeLineageLabel(declared);
  }
  const modelId = normalizeLineageLabel(selection.modelId ?? "");
  const curated = curatedModelLineage(modelId);
  if (curated !== undefined) return curated;
  const { vendor, baseModelId } = canonicalizeModelId(modelId);
  return `${vendor ?? normalizeLineageLabel(selection.company ?? "")}:${baseModelId}`;
}

const sharedLineageMessage =
  "author and critic must use different model lineages; record an independence override rationale to proceed with one lineage.";

function independenceOverrideRationaleProblem(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  // No branch echoes the value: it is user prose that travels into logs and UI.
  if (typeof value !== "string" || value.trim() === "") {
    return "must be a non-empty rationale when provided.";
  }
  if (value.trim().length > maximumIndependenceOverrideRationaleLength) {
    return `must be at most ${maximumIndependenceOverrideRationaleLength} characters.`;
  }
  return undefined;
}

/**
 * Normalize a rationale for persistence, or throw when it is unusable.
 */
export function normalizeIndependenceOverrideRationale(value: string): string {
  const problem = independenceOverrideRationaleProblem(value);
  if (problem !== undefined) {
    throw new SemanticValidationError([
      {
        code: "invalid-value",
        field: "modelConfiguration.independenceOverrideRationale",
        message: problem,
      },
    ]);
  }
  return value.trim();
}

/**
 * The override a configuration already carries in its recorded independence.
 *
 * Undefined when there is none, or when the recorded value is unusable, so a
 * malformed record can never widen the gate.
 */
function recordedOverrideRationale(configuration: Record<string, unknown>): string | undefined {
  const record = configuration.independentReview;
  if (!isRecord(record)) return undefined;
  const rationale = record.overrideRationale;
  if (independenceOverrideRationaleProblem(rationale) !== undefined) return undefined;
  return typeof rationale === "string" ? rationale.trim() : undefined;
}

export interface IndependentReviewOptions {
  readonly required?: boolean;
  readonly overrideRationale?: string;
}

/** Whether the critic descends from different weights than the author. */
export function hasIndependentReview(author: ModelSelection, critic: ModelSelection): boolean {
  return deriveModelLineage(author) !== deriveModelLineage(critic);
}

/**
 * What to record about independence for a given pairing.
 *
 * `overrideRationale` is present only when an override was load-bearing, so a
 * reader never sees a rationale implying a block that never happened.
 */
export function describeIndependentReview(
  author: ModelSelection,
  critic: ModelSelection,
  options: IndependentReviewOptions = {},
): IndependentReviewRecord {
  const required = options.required ?? true;
  const authorLineage = deriveModelLineage(author);
  const criticLineage = deriveModelLineage(critic);
  const lineagesDistinct = authorLineage !== criticLineage;
  const overridden = required && !lineagesDistinct && options.overrideRationale !== undefined;
  return {
    authorLineage,
    criticLineage,
    lineagesDistinct,
    required,
    ...(overridden
      ? {
          overrideRationale: normalizeIndependenceOverrideRationale(
            options.overrideRationale as string,
          ),
        }
      : {}),
  };
}

export function assertIndependentReview(
  author: ModelSelection,
  critic: ModelSelection,
  options: IndependentReviewOptions = {},
): void {
  const required = options.required ?? true;
  if (!required || hasIndependentReview(author, critic)) return;
  if (options.overrideRationale !== undefined) {
    // Throws when the rationale is unusable, so an unusable one never counts
    // as an override.
    normalizeIndependenceOverrideRationale(options.overrideRationale);
    return;
  }
  throw new SemanticValidationError([
    {
      code: "provider-diversity-required",
      field: "modelConfiguration",
      message: sharedLineageMessage,
    },
  ]);
}

export function createContextSnapshot(input: ContextSnapshotInput): ContextSnapshot {
  const validation = validateContextSnapshotInput(input);
  if (!validation.valid) {
    throw new SemanticValidationError(validation.issues);
  }

  const requirements = input.requirements ?? input.normalizedRequirements ?? [];
  const modelConfiguration = input.modelConfiguration as ModelConfigurationInput;
  const outputConstraints = input.outputConstraints ?? {};
  const snapshot: ContextSnapshot = {
    schemaVersion: contextSchemaVersion,
    id: input.id?.trim() as ContextSnapshotId,
    workspaceId: input.workspaceId?.trim() as WorkspaceId,
    createdAt: input.createdAt?.trim() as string,
    jobDescription: input.jobDescription?.trim() as string,
    requirements: requirements.map(normalizeRequirement),
    candidateInstructions: (input.candidateInstructions ?? input.instructions ?? "").trim(),
    language: input.language?.trim() as string,
    outputConstraints: {
      format: outputConstraints.format ?? "markdown",
      ...(outputConstraints.maxWords === undefined ? {} : { maxWords: outputConstraints.maxWords }),
      ...(outputConstraints.maxCharacters === undefined
        ? {}
        : { maxCharacters: outputConstraints.maxCharacters }),
      ...(outputConstraints.maxLength === undefined
        ? {}
        : { maxLength: outputConstraints.maxLength }),
      requiredSections: (outputConstraints.requiredSections ?? []).map((section) => section.trim()),
      ...(outputConstraints.tone === undefined ? {} : { tone: outputConstraints.tone.trim() }),
    },
    truthfulnessPolicy: (input.truthfulnessPolicy ?? "Do not add unsupported claims.").trim(),
    ...(input.writingPolicy === undefined
      ? {}
      : {
          writingPolicy: {
            schemaVersion: writingPolicySchemaVersion,
            content: input.writingPolicy.content.trim(),
            checksum: input.writingPolicy.checksum.toLowerCase(),
            version: input.writingPolicy.version.trim(),
            ...(input.writingPolicy.rules === undefined
              ? {}
              : { rules: input.writingPolicy.rules.map(normalizeWritingPolicyRule) }),
            ...(input.writingPolicy.preferences === undefined
              ? {}
              : {
                  preferences: normalizeWritingPolicyPreferences(input.writingPolicy.preferences),
                }),
            lineage:
              input.writingPolicy.lineage === undefined
                ? { kind: "workspace" }
                : normalizeWritingPolicyLineage(input.writingPolicy.lineage),
          },
        }),
    readinessRubric: {
      relevance: input.readinessRubric?.relevance as number,
      evidence: input.readinessRubric?.evidence as number,
      accuracy: input.readinessRubric?.accuracy as number,
      differentiation: input.readinessRubric?.differentiation as number,
      clarity: input.readinessRubric?.clarity as number,
      format: input.readinessRubric?.format as number,
      credibility: input.readinessRubric?.credibility as number,
    },
    evidenceManifest: (input.evidenceManifest ?? []).map(normalizeEvidenceSource),
    modelConfiguration: normalizeModelConfiguration(modelConfiguration),
    ...(input.candidateKnowledgeSelection === undefined
      ? {}
      : {
          candidateKnowledgeSelection: createCandidateKnowledgeSelectionSnapshot(
            input.candidateKnowledgeSelection,
          ),
        }),
    ...(input.opportunityBriefReference === undefined
      ? {}
      : {
          opportunityBriefReference: normalizeOpportunityBriefReference(
            input.opportunityBriefReference,
          ),
        }),
    ...(input.profileId ? { profileId: input.profileId.trim() as ProfileId } : {}),
  };

  return cloneAndFreeze(snapshot);
}

export function createAgentContextReference(
  snapshot: ContextSnapshot,
  selection: ModelSelection,
): AgentContextReference {
  if (selection.role !== "author" && selection.role !== "critic") {
    throw new SemanticValidationError([
      {
        code: "invalid-value",
        field: "selection.role",
        message: "an agent context reference requires an author or critic role.",
      },
    ]);
  }

  return cloneAndFreeze({
    contextSnapshotId: snapshot.id,
    role: selection.role,
    model: selection,
  });
}
