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

export const contextSchemaVersion = 1 as const;
export type ContextSchemaVersion = typeof contextSchemaVersion;

export const requirementPriorities = ["critical", "high", "medium", "low"] as const;
export type RequirementPriority = (typeof requirementPriorities)[number];

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

export type ReadinessRubric = Readonly<Record<ReadinessDimension, number>>;
export type ReadinessRubricInput = Partial<ReadinessRubric>;

export const outputFormats = ["markdown", "plain-text", "json", "pdf", "docx"] as const;
export type OutputFormat = (typeof outputFormats)[number];

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
  readonly profileId?: ProfileId;
}

export interface WritingPolicy {
  /** Exact policy text applied to this run. */
  readonly content: string;
  /** SHA-256 of `content`, recorded for audit and change detection. */
  readonly checksum: string;
  /** Stable human-visible version derived from the checksum. */
  readonly version: string;
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
    if (!isRecord(candidate.writingPolicy)) {
      addIssue(issues, "invalid-value", "writingPolicy", "must be a writing policy object.");
    } else {
      const policy = candidate.writingPolicy as Partial<WritingPolicy>;
      if (!isNonEmptyString(policy.content)) {
        addIssue(issues, "invalid-value", "writingPolicy.content", "must not be empty.");
      }
      if (!isNonEmptyString(policy.checksum) || !/^[a-f0-9]{64}$/iu.test(policy.checksum)) {
        addIssue(issues, "invalid-value", "writingPolicy.checksum", "must be a SHA-256 checksum.");
      }
      if (!isNonEmptyString(policy.version)) {
        addIssue(issues, "invalid-value", "writingPolicy.version", "must not be empty.");
      }
    }
  }
  validateRequirements(candidate, issues);
  validateEvidenceManifest(candidate, issues);
  validateModelConfiguration(candidate, issues);
  validateRubric(candidate, issues);
  validateOutputConstraints(candidate, issues);

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
            content: input.writingPolicy.content.trim(),
            checksum: input.writingPolicy.checksum.toLowerCase(),
            version: input.writingPolicy.version.trim(),
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
