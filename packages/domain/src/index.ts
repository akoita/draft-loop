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
 * A candidate profile is a persistent, independently managed collection of
 * ingested professional materials (files, URLs, portfolios). Profiles live
 * across workspaces so the same evidence can be reused for multiple job
 * applications without re-importing.
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

export interface ModelSelection {
  readonly company: ModelCompany;
  readonly modelId: string;
  readonly role: AgentRole;
  readonly promptTemplateVersion: string;
}

export interface ModelSelectionInput {
  readonly company?: string;
  readonly modelId?: string;
  readonly role?: AgentRole;
  readonly promptTemplateVersion?: string;
}

export interface ModelConfiguration {
  readonly author: ModelSelection;
  readonly critic: ModelSelection;
  readonly requireProviderDiversity: boolean;
}

export interface ModelConfigurationInput {
  readonly author?: ModelSelectionInput;
  readonly critic?: ModelSelectionInput;
  readonly requireProviderDiversity?: boolean;
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
  readonly readinessRubric: ReadinessRubric;
  readonly evidenceManifest: readonly EvidenceSource[];
  readonly modelConfiguration: ModelConfiguration;
  readonly profileId?: ProfileId;
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
  const authorCompany = (configuration.author as ModelSelectionInput).company;
  const criticCompany = (configuration.critic as ModelSelectionInput).company;
  if (typeof requireDiversity !== "boolean") {
    addIssue(
      issues,
      "invalid-value",
      "modelConfiguration.requireProviderDiversity",
      "must be a boolean.",
    );
  }
  if (
    requireDiversity === true &&
    hasAuthor &&
    hasCritic &&
    isNonEmptyString(authorCompany) &&
    isNonEmptyString(criticCompany) &&
    authorCompany.trim() === criticCompany.trim()
  ) {
    addIssue(
      issues,
      "provider-diversity-required",
      "modelConfiguration",
      "author and critic must use different model companies in cross-company mode.",
    );
  }
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
  };
}

export function hasProviderDiversity(author: ModelSelection, critic: ModelSelection): boolean {
  return author.company.trim() !== critic.company.trim();
}

export function assertProviderDiversity(
  author: ModelSelection,
  critic: ModelSelection,
  required = true,
): void {
  if (required && !hasProviderDiversity(author, critic)) {
    throw new SemanticValidationError([
      {
        code: "provider-diversity-required",
        field: "modelConfiguration",
        message: "author and critic must use different model companies in cross-company mode.",
      },
    ]);
  }
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
    modelConfiguration: {
      author: normalizeModelSelection(modelConfiguration.author as ModelSelectionInput),
      critic: normalizeModelSelection(modelConfiguration.critic as ModelSelectionInput),
      requireProviderDiversity: modelConfiguration.requireProviderDiversity ?? true,
    },
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
