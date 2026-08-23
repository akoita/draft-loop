/**
 * Renderer-safe contracts for the desktop capability boundary.
 *
 * This module deliberately contains no filesystem, shell, provider SDK, or
 * credential implementation. A packaged host can implement NativeBridge
 * behind this contract; the renderer only receives bounded, serializable
 * projections.
 */

import type {
  DesktopReviewState,
  IndependentReviewView,
  ProviderExposureView,
  ProviderFailureView,
  ReviewAction,
} from "./model.js";

export const bridgeCapabilities = [
  "workspace.open",
  "workspace.create",
  "workspace.configure-models",
  "knowledge.create",
  "knowledge.open",
  "knowledge.list",
  "knowledge.readiness",
  "knowledge.sources",
  "knowledge.duplicates",
  "knowledge.inventory",
  "knowledge.import-file",
  "knowledge.select",
  "knowledge.create-base",
  "knowledge.rename-base",
  "knowledge.archive-base",
  "run.status",
  "run.start",
  "run.pause",
  "run.resume",
  "run.stop",
  "review.load",
  "review.dispatch",
  "file.select",
  "source.add-url",
  "export.write",
  "credential.status",
  "credential.set",
  "credential.remove",
  "models.list",
  "models.preview-independence",
] as const;

export type BridgeCapability = (typeof bridgeCapabilities)[number];

export const supportedFileExtensions = [
  ".docx",
  ".htm",
  ".html",
  ".markdown",
  ".md",
  ".pdf",
  ".text",
  ".txt",
] as const;

export type SupportedFileExtension = (typeof supportedFileExtensions)[number];

export const supportedMediaTypes = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/html",
  "text/markdown",
  "text/plain",
] as const;

export type SupportedMediaType = (typeof supportedMediaTypes)[number];

export const exportFormats = ["docx", "markdown", "pdf"] as const;
export type ExportFormat = (typeof exportFormats)[number];

export const credentialProviders = ["anthropic", "openai"] as const;
export type CredentialProvider = (typeof credentialProviders)[number];

/**
 * The provider companies a workspace can be configured to use.
 *
 * This is the application's own allowlist, not a preference: the local driver
 * refuses to build an adapter for any other company, so a company outside this
 * list is invalid input rather than an option this host declined to offer.
 */
export const modelCompanies = ["anthropic", "openai", "local"] as const;
export type ModelCompany = (typeof modelCompanies)[number];

/**
 * The companies whose catalogue can be listed.
 *
 * Wider than `credentialProviders` because `local` has no credential: its
 * catalogue comes from a server on this machine, named by the workspace. It is
 * `modelCompanies` itself rather than a copy of it, because a catalogue exists
 * only to fill in a workspace's model choice: a company that could be listed
 * but not configured, or configured but not listed, would be a defect in one
 * of the two rather than a distinction worth encoding.
 */
export const modelDiscoveryProviders = modelCompanies;
export type ModelDiscoveryProvider = (typeof modelDiscoveryProviders)[number];

export const credentialSources = ["app", "env", "user-session", "none"] as const;
export type CredentialSource = (typeof credentialSources)[number];

export const credentialProtections = [
  "os-backed",
  "basic-text",
  "local-aes-gcm",
  "environment",
  "session-memory",
  "provider-managed-session",
  "none",
] as const;
export type CredentialProtection = (typeof credentialProtections)[number];

export const runStates = [
  "collecting",
  "ingesting",
  "drafting",
  "reviewing",
  "revising",
  "awaiting-approval",
  "approved",
  "exported",
  "paused",
  "provider-error",
  "stopped",
  "budget-exhausted",
] as const;

export type BridgeRunState = (typeof runStates)[number];
export type RunApproval = "pending" | "approved" | "rejected";

/**
 * Binds a validator's runtime key list to its input interface.
 *
 * The runtime list stays the single source of truth (types are erased, so it
 * cannot be derived from `keyof`), and this helper makes drift a compile error
 * in both directions: an interface key missing from the list, and a list entry
 * the interface does not declare. `keyof` reports optional and readonly keys
 * too, so `?` and `readonly` members are covered.
 */
function inputKeys<Input extends object>() {
  return <const Keys extends readonly (keyof Input & string)[]>(
    keys: Keys & {
      readonly [Key in Exclude<keyof Input, Keys[number]>]: "add this key to the runtime key list";
    },
  ): Keys => keys;
}

/**
 * The same guard, for the allowlists that police host responses.
 *
 * An alias rather than a second copy: the drift and the failure are identical,
 * only the direction of travel differs. Without it a field added to a result
 * interface reaches the renderer through an allowlist that has never heard of
 * it, and the host's honest answer is rejected as invalid at runtime with
 * nothing in the build to say so.
 */
const resultKeys = inputKeys;

export interface WorkspaceOpenInput {
  /** The native host owns the folder picker; no filesystem path crosses this API. */
  readonly selection?: "native-dialog";
}

const workspaceOpenKeys = inputKeys<WorkspaceOpenInput>()(["selection"]);

export interface KnowledgeStoreCreateInput {
  /** The native host owns the folder picker; no filesystem path crosses this API. */
  readonly selection?: "native-dialog";
  /** A new folder name beneath the directory selected by the native host. */
  readonly name: string;
  readonly displayName?: string;
  readonly description?: string;
}

const knowledgeStoreCreateKeys = inputKeys<KnowledgeStoreCreateInput>()([
  "selection",
  "name",
  "displayName",
  "description",
]);

export type KnowledgeStoreOpenInput = WorkspaceOpenInput;
const knowledgeStoreOpenKeys = workspaceOpenKeys;

export interface KnowledgeStoreListInput {
  readonly storeId: string;
}

const knowledgeStoreListKeys = inputKeys<KnowledgeStoreListInput>()(["storeId"]);

export interface KnowledgeReadinessInput extends KnowledgeStoreListInput {
  readonly knowledgeBaseId: string;
}

const knowledgeReadinessKeys = inputKeys<KnowledgeReadinessInput>()(["storeId", "knowledgeBaseId"]);

export type KnowledgeSourcesInput = KnowledgeReadinessInput;
const knowledgeSourcesKeys = knowledgeReadinessKeys;

export type KnowledgeDuplicatesInput = KnowledgeReadinessInput;
const knowledgeDuplicatesKeys = knowledgeReadinessKeys;

export type KnowledgeInventoryInput = KnowledgeStoreListInput;
const knowledgeInventoryKeys = knowledgeStoreListKeys;

export interface KnowledgeFileImportInput extends KnowledgeReadinessInput {
  /** The native host owns the file picker; no filesystem path crosses this API. */
  readonly selection: "native-dialog";
  readonly displayName?: string;
}

const knowledgeFileImportKeys = inputKeys<KnowledgeFileImportInput>()([
  "storeId",
  "knowledgeBaseId",
  "selection",
  "displayName",
]);

export interface KnowledgeSelectionEntry {
  readonly storeId: string;
  readonly knowledgeBaseId: string;
}

export interface KnowledgeSelectionInput {
  readonly workspaceId: string;
  readonly entries: readonly KnowledgeSelectionEntry[];
  /** Explicit approval required when more than one CKB is selected. */
  readonly combinationApproved?: boolean;
}

const knowledgeSelectionEntryKeys = inputKeys<KnowledgeSelectionEntry>()([
  "storeId",
  "knowledgeBaseId",
]);
const knowledgeSelectionInputKeys = inputKeys<KnowledgeSelectionInput>()([
  "workspaceId",
  "entries",
  "combinationApproved",
]);

export interface KnowledgeBaseCreateInput extends KnowledgeStoreListInput {
  readonly displayName: string;
  readonly description?: string;
}

export interface KnowledgeBaseRenameInput extends KnowledgeReadinessInput {
  readonly displayName: string;
}

export interface KnowledgeBaseArchiveInput extends KnowledgeReadinessInput {
  /** Archival has no inverse in the current contract and must be visibly confirmed. */
  readonly confirmed: boolean;
}

const knowledgeBaseCreateKeys = inputKeys<KnowledgeBaseCreateInput>()([
  "storeId",
  "displayName",
  "description",
]);
const knowledgeBaseRenameKeys = inputKeys<KnowledgeBaseRenameInput>()([
  "storeId",
  "knowledgeBaseId",
  "displayName",
]);
const knowledgeBaseArchiveKeys = inputKeys<KnowledgeBaseArchiveInput>()([
  "storeId",
  "knowledgeBaseId",
  "confirmed",
]);

/**
 * Everything a new workspace can be told about its models.
 *
 * Every field is optional and every omitted field keeps the workspace default,
 * so a host that is handed nothing still creates the same workspace it always
 * did. The names match `InitializeWorkspaceCommand` deliberately: this input
 * exists to fill that command in, and the desktop should be able to express
 * exactly what `draft-loop init` can.
 */
export interface WorkspaceCreateInput {
  /** A display name only. The native host owns the destination folder picker. */
  readonly name: string;
  /** Real workspaces are empty; demo mode is explicit and deterministic. */
  readonly mode?: "real" | "demo";
  /** Author provider company, matching the CLI's `--author-company`. */
  readonly authorCompany?: ModelCompany;
  /**
   * Exact author model id. Omitted uses the workspace default, matching the
   * CLI's `--author-model`.
   */
  readonly authorModel?: string;
  /** Critic provider company, matching the CLI's `--critic-company`. */
  readonly criticCompany?: ModelCompany;
  /** Exact critic model id. Omitted uses the workspace default. */
  readonly criticModel?: string;
  /**
   * The weights the author descends from, as claimed by the operator. Omitted
   * lets the domain derive one; nothing here derives it.
   */
  readonly authorLineage?: string;
  /** The weights the critic descends from, on the same terms. */
  readonly criticLineage?: string;
  /** Loopback base URL of the model server used when a company is `local`. */
  readonly localEndpoint?: string;
  /** Why one lineage on both sides is acceptable; recorded with every run. */
  readonly independenceOverrideRationale?: string;
  /**
   * Sections the CV must contain, matching the CLI's `--required-sections`.
   * Omitted uses the workspace default.
   */
  readonly requiredSections?: readonly string[];
  /** Maximum author-critic rounds before the run returns to human review. */
  readonly maxRounds?: number;
}

const workspaceCreateKeys = inputKeys<WorkspaceCreateInput>()([
  "name",
  "mode",
  "authorCompany",
  "authorModel",
  "criticCompany",
  "criticModel",
  "authorLineage",
  "criticLineage",
  "localEndpoint",
  "independenceOverrideRationale",
  "requiredSections",
  "maxRounds",
]);

/**
 * The models an already-created workspace should use from its next run.
 *
 * Unlike `WorkspaceCreateInput` the pairing is required in full, because the
 * host replaces the configuration whole rather than merging it. An omitted
 * lineage or rationale means "this pairing has none": a rationale justifies one
 * specific pairing, so letting one survive a change of models would leave a
 * justification standing for a choice nobody made. A renderer that wants to
 * change one side still sends both, which is also what the person is looking at.
 */
export interface WorkspaceConfigureModelsInput {
  readonly workspaceId: string;
  readonly authorCompany: ModelCompany;
  readonly authorModel: string;
  readonly criticCompany: ModelCompany;
  readonly criticModel: string;
  /** The weights the author descends from; the domain derives one when absent. */
  readonly authorLineage?: string;
  /** The weights the critic descends from, on the same terms. */
  readonly criticLineage?: string;
  /** Loopback base URL of the model server used when a company is `local`. */
  readonly localEndpoint?: string;
  /** Why one lineage on both sides is acceptable for this pairing. */
  readonly independenceOverrideRationale?: string;
}

const workspaceConfigureModelsKeys = inputKeys<WorkspaceConfigureModelsInput>()([
  "workspaceId",
  "authorCompany",
  "authorModel",
  "criticCompany",
  "criticModel",
  "authorLineage",
  "criticLineage",
  "localEndpoint",
  "independenceOverrideRationale",
]);

export interface RunStatusInput {
  readonly workspaceId: string;
  readonly runId?: string;
}

const runStatusKeys = inputKeys<RunStatusInput>()(["workspaceId", "runId"]);

export interface RunStartInput {
  readonly workspaceId: string;
}

const runStartKeys = inputKeys<RunStartInput>()(["workspaceId"]);

export interface RunLifecycleInput {
  readonly workspaceId: string;
  readonly runId: string;
}

const runLifecycleKeys = inputKeys<RunLifecycleInput>()(["workspaceId", "runId"]);

export interface ReviewLoadInput {
  readonly workspaceId?: string;
  readonly runId?: string;
}

const reviewLoadKeys = inputKeys<ReviewLoadInput>()(["workspaceId", "runId"]);

export interface ReviewDispatchInput {
  readonly workspaceId: string;
  readonly runId: string;
  readonly action: ReviewAction;
}

const reviewDispatchKeys = inputKeys<ReviewDispatchInput>()(["workspaceId", "runId", "action"]);

export interface FileSelectInput {
  readonly workspaceId: string;
  readonly extensions?: readonly SupportedFileExtension[];
  readonly multiple?: boolean;
  readonly target?: "evidence" | "job-description" | "writing-policy";
}

const fileSelectKeys = inputKeys<FileSelectInput>()([
  "workspaceId",
  "extensions",
  "multiple",
  "target",
]);

export interface SourceAddUrlInput {
  readonly workspaceId: string;
  readonly url: string;
  readonly target: "evidence" | "job-description";
  /** The renderer can only request a fetch after the user confirms it. */
  readonly approved: boolean;
}

const sourceAddUrlKeys = inputKeys<SourceAddUrlInput>()([
  "workspaceId",
  "url",
  "target",
  "approved",
]);

export interface ExportWriteInput {
  readonly workspaceId: string;
  readonly runId: string;
  readonly format: ExportFormat;
  /** Workspace-relative and, when supplied, restricted to the exports folder. */
  readonly relativePath?: string;
}

const exportWriteKeys = inputKeys<ExportWriteInput>()([
  "workspaceId",
  "runId",
  "format",
  "relativePath",
]);

export interface CredentialStatusInput {
  readonly provider: CredentialProvider;
}

export interface CredentialSetInput {
  readonly provider: CredentialProvider;
  readonly apiKey: string;
}

const credentialSetKeys = inputKeys<CredentialSetInput>()(["provider", "apiKey"]);

export interface CredentialRemoveInput {
  readonly provider: CredentialProvider;
}

/**
 * credential.status and credential.remove share one validator, so the guard
 * covers both interfaces: either one gaining a key breaks the build.
 */
const credentialKeys = inputKeys<CredentialStatusInput & CredentialRemoveInput>()(["provider"]);

export interface ModelsListInput {
  readonly provider: ModelDiscoveryProvider;
  /**
   * Which open workspace names the local server to ask. Only meaningful for
   * `local`; the hosted providers are reached at their own fixed address.
   */
  readonly workspaceId?: string;
  /** Ask the provider again rather than answering from the host's short cache. */
  readonly refresh?: boolean;
}

const modelsListKeys = inputKeys<ModelsListInput>()(["provider", "workspaceId", "refresh"]);

/**
 * A model someone is considering, before any workspace has been created.
 *
 * The company is a bounded label rather than one of `modelCompanies`, because
 * the question asked of it is about weights and not about configuration: a
 * reseller's namespace such as `bedrock` names a route to a model this
 * workspace could reach another way, and answering "these are the same
 * weights" for that pairing is the whole point. Refusing to answer would leave
 * the question to be worked out somewhere with no right to it.
 */
export interface ModelCandidate {
  readonly company: string;
  readonly modelId: string;
  /**
   * The operator's own claim about the weights. Present only when they made
   * one; absent lets the derivation speak.
   */
  readonly lineage?: string;
}

/**
 * A candidate pairing, asked about before it is committed to.
 *
 * The question this carries -- "would these two count as independent?" -- has
 * exactly one correct answer, and it lives in the domain. The renderer asks
 * rather than works it out, because a surface that recomputes the rule goes on
 * showing the old answer after the rule changes.
 */
export interface ModelsPreviewIndependenceInput {
  readonly author: ModelCandidate;
  readonly critic: ModelCandidate;
}

const modelCandidateKeys = inputKeys<ModelCandidate>()(["company", "modelId", "lineage"]);
const modelsPreviewIndependenceKeys = inputKeys<ModelsPreviewIndependenceInput>()([
  "author",
  "critic",
]);

export interface WorkspaceSummary {
  readonly id: string;
  readonly name: string;
}

export interface WorkspaceResult {
  readonly workspace: WorkspaceSummary;
}

const workspaceResultKeys = resultKeys<WorkspaceResult>()(["workspace"]);
const workspaceSummaryKeys = resultKeys<WorkspaceSummary>()(["id", "name"]);

export interface KnowledgeBaseSummary {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly state: "active" | "archived";
  readonly isDefault: boolean;
}

export interface KnowledgeStoreResult {
  readonly storeId: string;
  readonly knowledgeBases: readonly KnowledgeBaseSummary[];
}

export interface KnowledgeReadinessResult {
  readonly storeId: string;
  readonly knowledgeBaseId: string;
  readonly state: "active" | "archived";
  readonly sourceCount: number;
  readonly readyCount: number;
  readonly blockedCount: number;
  readonly blockerReasons: readonly string[];
}

export interface KnowledgeSourceSummary {
  readonly sourceId: string;
  readonly kind: "file" | "url";
  readonly latestVersionId: string | null;
  readonly versionCount: number;
}

export interface KnowledgeSourcesResult {
  readonly storeId: string;
  readonly knowledgeBaseId: string;
  readonly sourceCount: number;
  readonly sources: readonly KnowledgeSourceSummary[];
  readonly truncated: boolean;
}

export interface KnowledgeDuplicateMember {
  readonly sourceId: string;
  readonly versionId: string;
}

export interface KnowledgeDuplicateGroupSummary {
  readonly memberCount: number;
  readonly members: readonly KnowledgeDuplicateMember[];
  readonly truncated: boolean;
}

export interface KnowledgeDuplicatesResult {
  readonly storeId: string;
  readonly knowledgeBaseId: string;
  readonly groupCount: number;
  readonly groups: readonly KnowledgeDuplicateGroupSummary[];
  readonly truncated: boolean;
}

export interface KnowledgeInventoryUnknownEntries {
  readonly intakeShapedFilesAtSourcesRoot: number;
  readonly opaqueEntriesAtSourcesRoot: number;
  readonly entriesInsideManagedSourceDirectories: number;
  readonly symbolicLinks: number;
  readonly otherEntries: number;
}

export interface KnowledgeInventoryResult {
  readonly storeId: string;
  readonly schemaVersion: 1;
  readonly verifiedManagedFileCount: number;
  readonly scannedEntryCount: number;
  readonly unknownEntries: KnowledgeInventoryUnknownEntries;
  readonly complete: boolean;
  readonly scanLimitReached: boolean;
}

export interface KnowledgeFileImportResult {
  readonly storeId: string;
  readonly knowledgeBaseId: string;
  readonly sourceId: string;
  readonly kind: "file";
  readonly versionId: string;
  readonly version: number;
  readonly created: boolean;
}

export interface KnowledgeSelectionResult {
  readonly workspaceId: string;
  readonly entries: readonly KnowledgeSelectionEntry[];
}

const knowledgeBaseSummaryKeys = resultKeys<KnowledgeBaseSummary>()([
  "id",
  "displayName",
  "description",
  "state",
  "isDefault",
]);
const knowledgeStoreResultKeys = resultKeys<KnowledgeStoreResult>()(["storeId", "knowledgeBases"]);
const knowledgeReadinessResultKeys = resultKeys<KnowledgeReadinessResult>()([
  "storeId",
  "knowledgeBaseId",
  "state",
  "sourceCount",
  "readyCount",
  "blockedCount",
  "blockerReasons",
]);
const knowledgeSourceSummaryKeys = resultKeys<KnowledgeSourceSummary>()([
  "sourceId",
  "kind",
  "latestVersionId",
  "versionCount",
]);
const knowledgeSourcesResultKeys = resultKeys<KnowledgeSourcesResult>()([
  "storeId",
  "knowledgeBaseId",
  "sourceCount",
  "sources",
  "truncated",
]);
const knowledgeDuplicateMemberKeys = resultKeys<KnowledgeDuplicateMember>()([
  "sourceId",
  "versionId",
]);
const knowledgeDuplicateGroupSummaryKeys = resultKeys<KnowledgeDuplicateGroupSummary>()([
  "memberCount",
  "members",
  "truncated",
]);
const knowledgeDuplicatesResultKeys = resultKeys<KnowledgeDuplicatesResult>()([
  "storeId",
  "knowledgeBaseId",
  "groupCount",
  "groups",
  "truncated",
]);
const knowledgeInventoryUnknownEntriesKeys = resultKeys<KnowledgeInventoryUnknownEntries>()([
  "intakeShapedFilesAtSourcesRoot",
  "opaqueEntriesAtSourcesRoot",
  "entriesInsideManagedSourceDirectories",
  "symbolicLinks",
  "otherEntries",
]);
const knowledgeInventoryResultKeys = resultKeys<KnowledgeInventoryResult>()([
  "storeId",
  "schemaVersion",
  "verifiedManagedFileCount",
  "scannedEntryCount",
  "unknownEntries",
  "complete",
  "scanLimitReached",
]);
const knowledgeFileImportResultKeys = resultKeys<KnowledgeFileImportResult>()([
  "storeId",
  "knowledgeBaseId",
  "sourceId",
  "kind",
  "versionId",
  "version",
  "created",
]);
const knowledgeSelectionResultKeys = resultKeys<KnowledgeSelectionResult>()([
  "workspaceId",
  "entries",
]);

/**
 * The pairing a workspace is configured with after a change.
 *
 * Reported back rather than assumed, so a renderer shows what was written
 * instead of what it asked for; the two differ whenever the host trimmed,
 * refused, or dropped something. `localEndpoint` is here because "local" is a
 * claim about where candidate material goes, and a surface that says so must be
 * able to name the address.
 */
export interface WorkspaceModelsResult {
  readonly workspaceId: string;
  readonly authorCompany: ModelCompany;
  readonly authorModel: string;
  readonly criticCompany: ModelCompany;
  readonly criticModel: string;
  readonly localEndpoint: string | null;
}

const workspaceModelsResultKeys = resultKeys<WorkspaceModelsResult>()([
  "workspaceId",
  "authorCompany",
  "authorModel",
  "criticCompany",
  "criticModel",
  "localEndpoint",
]);

export interface RunStatus {
  readonly workspaceId: string;
  readonly runId: string | null;
  readonly state: BridgeRunState;
  readonly round: number;
  readonly approval: RunApproval;
}

const runStatusResultKeys = resultKeys<RunStatus>()([
  "workspaceId",
  "runId",
  "state",
  "round",
  "approval",
]);

/**
 * The review state crosses the bridge whole rather than field by field, so
 * these guard the parts this module actually inspects. `providerExposure` is
 * inspected because it carries the independence claim a person reads just
 * before approving, and prose that reaches that panel is validated like any
 * other value from the host.
 */
const providerExposureResultKeys = resultKeys<ProviderExposureView>()([
  "author",
  "critic",
  "transmissionAllowed",
  "sensitiveData",
  "requestedRetention",
  "independentReview",
]);

const independentReviewResultKeys = resultKeys<IndependentReviewView>()([
  "authorLineage",
  "criticLineage",
  "lineagesDistinct",
  "required",
  "overrideRationale",
]);

const providerFailureResultKeys = resultKeys<ProviderFailureView>()([
  "code",
  "explanation",
  "provider",
  "model",
  "step",
  "attempt",
  "maxAttempts",
  "retryAvailable",
  "retryNotBefore",
  "availableActions",
  "diagnostics",
]);

export type ReviewStateResult = DesktopReviewState;

export interface SelectedFile {
  readonly id: string;
  readonly name: string;
  readonly relativePath: string;
  readonly mediaType: SupportedMediaType;
  readonly byteLength: number;
}

export interface FileSelectResult {
  readonly files: readonly SelectedFile[];
}

const fileSelectResultKeys = resultKeys<FileSelectResult>()(["files"]);
const selectedFileKeys = resultKeys<SelectedFile>()([
  "id",
  "name",
  "relativePath",
  "mediaType",
  "byteLength",
]);

export interface SourceAddUrlResult {
  readonly sourcePath: string;
  readonly originalUrl: string;
  readonly finalUrl: string;
  readonly kind: string;
  readonly extractionStatus: "extracted" | "generic-fallback";
  readonly mediaType: SupportedMediaType;
}

const sourceAddUrlResultKeys = resultKeys<SourceAddUrlResult>()([
  "sourcePath",
  "originalUrl",
  "finalUrl",
  "kind",
  "extractionStatus",
  "mediaType",
]);

export interface ExportResult {
  readonly exportId: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly format: ExportFormat;
  readonly relativePath: string;
}

const exportResultKeys = resultKeys<ExportResult>()([
  "exportId",
  "workspaceId",
  "runId",
  "format",
  "relativePath",
]);

export interface CredentialStatus {
  readonly provider: CredentialProvider;
  readonly configured: boolean;
  readonly source: CredentialSource;
  /** Non-secret description of how the active credential is protected. */
  readonly protection: CredentialProtection;
}

export type CredentialResult = CredentialStatus;

const credentialResultKeys = resultKeys<CredentialResult>()([
  "provider",
  "configured",
  "source",
  "protection",
]);

/**
 * A model id the provider says the configured credential can reach.
 *
 * Ids only. Display names and pricing are not carried: neither is needed to
 * name a model correctly, and every extra field is another string from a
 * provider that this boundary would have to police.
 */
export interface DiscoveredModelSummary {
  readonly id: string;
}

export interface ModelsListResult {
  readonly provider: ModelDiscoveryProvider;
  readonly models: readonly DiscoveredModelSummary[];
  /** Whether the provider had more to report than this list carries. */
  readonly truncated: boolean;
  /** Whether the host asked the provider or answered from its short cache. */
  readonly source: "live" | "cache";
  /** When the underlying provider call happened, so a cached list can say so. */
  readonly retrievedAt: string;
}

const modelsListResultKeys = resultKeys<ModelsListResult>()([
  "provider",
  "models",
  "truncated",
  "source",
  "retrievedAt",
]);

const discoveredModelKeys = resultKeys<DiscoveredModelSummary>()(["id"]);

/**
 * What a candidate pairing would record about independence.
 *
 * The field names are those of `IndependentReviewView` on purpose: the words a
 * person reads while choosing models are the words they will read again at the
 * approval gate, and the answer behind both is derived in one place.
 */
export interface ModelsPreviewIndependenceResult {
  readonly authorLineage: string;
  readonly criticLineage: string;
  readonly lineagesDistinct: boolean;
}

const modelsPreviewIndependenceResultKeys = resultKeys<ModelsPreviewIndependenceResult>()([
  "authorLineage",
  "criticLineage",
  "lineagesDistinct",
]);

/**
 * This boundary's own ceiling on a discovered catalogue.
 *
 * The provider layer caps at the same number; repeating it rather than
 * importing it keeps this module free of provider dependencies and means a
 * host that skipped the cap still cannot hand the renderer an unbounded list.
 */
const maximumDiscoveredModels = 200;

export interface BridgeCommandInputMap {
  "workspace.open": WorkspaceOpenInput;
  "workspace.create": WorkspaceCreateInput;
  "workspace.configure-models": WorkspaceConfigureModelsInput;
  "knowledge.create": KnowledgeStoreCreateInput;
  "knowledge.open": KnowledgeStoreOpenInput;
  "knowledge.list": KnowledgeStoreListInput;
  "knowledge.readiness": KnowledgeReadinessInput;
  "knowledge.sources": KnowledgeSourcesInput;
  "knowledge.duplicates": KnowledgeDuplicatesInput;
  "knowledge.inventory": KnowledgeInventoryInput;
  "knowledge.import-file": KnowledgeFileImportInput;
  "knowledge.select": KnowledgeSelectionInput;
  "knowledge.create-base": KnowledgeBaseCreateInput;
  "knowledge.rename-base": KnowledgeBaseRenameInput;
  "knowledge.archive-base": KnowledgeBaseArchiveInput;
  "run.status": RunStatusInput;
  "run.start": RunStartInput;
  "run.pause": RunLifecycleInput;
  "run.resume": RunLifecycleInput;
  "run.stop": RunLifecycleInput;
  "review.load": ReviewLoadInput;
  "review.dispatch": ReviewDispatchInput;
  "file.select": FileSelectInput;
  "source.add-url": SourceAddUrlInput;
  "export.write": ExportWriteInput;
  "credential.status": CredentialStatusInput;
  "credential.set": CredentialSetInput;
  "credential.remove": CredentialRemoveInput;
  "models.list": ModelsListInput;
  "models.preview-independence": ModelsPreviewIndependenceInput;
}

export interface BridgeCommandOutputMap {
  "workspace.open": WorkspaceResult;
  "workspace.create": WorkspaceResult;
  "workspace.configure-models": WorkspaceModelsResult;
  "knowledge.create": KnowledgeStoreResult;
  "knowledge.open": KnowledgeStoreResult;
  "knowledge.list": KnowledgeStoreResult;
  "knowledge.readiness": KnowledgeReadinessResult;
  "knowledge.sources": KnowledgeSourcesResult;
  "knowledge.duplicates": KnowledgeDuplicatesResult;
  "knowledge.inventory": KnowledgeInventoryResult;
  "knowledge.import-file": KnowledgeFileImportResult;
  "knowledge.select": KnowledgeSelectionResult;
  "knowledge.create-base": KnowledgeStoreResult;
  "knowledge.rename-base": KnowledgeStoreResult;
  "knowledge.archive-base": KnowledgeStoreResult;
  "run.status": RunStatus;
  "run.start": RunStatus;
  "run.pause": RunStatus;
  "run.resume": RunStatus;
  "run.stop": RunStatus;
  "review.load": ReviewStateResult;
  "review.dispatch": ReviewStateResult;
  "file.select": FileSelectResult;
  "source.add-url": SourceAddUrlResult;
  "export.write": ExportResult;
  "credential.status": CredentialStatus;
  "credential.set": CredentialResult;
  "credential.remove": CredentialResult;
  "models.list": ModelsListResult;
  "models.preview-independence": ModelsPreviewIndependenceResult;
}

export type BridgeCommandName = keyof BridgeCommandInputMap;

export type BridgeCommand = {
  [Name in BridgeCommandName]: {
    readonly type: Name;
    readonly input: BridgeCommandInputMap[Name];
  };
}[BridgeCommandName];

export type BridgeOutput<Command extends BridgeCommand> = BridgeCommandOutputMap[Command["type"]];

export type BridgeErrorCode =
  | "invalid-command"
  | "invalid-input"
  | "capability-unavailable"
  | "permission-denied"
  | "not-found"
  | "operation-failed";

export interface BridgeError {
  readonly code: BridgeErrorCode;
  readonly message: string;
  readonly capability?: BridgeCapability;
}

export type BridgeResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: BridgeError };

export interface NativeBridge {
  /** Hosts may advertise only capabilities from bridgeCapabilities. */
  readonly capabilities: ReadonlySet<BridgeCapability> | readonly BridgeCapability[];
  readonly invoke: (command: BridgeCommand) => Promise<BridgeResult<unknown>>;
}

export interface CapabilityPort {
  readonly capabilities: readonly BridgeCapability[];
  readonly hasCapability: (capability: BridgeCapability) => boolean;
  readonly execute: <Command extends BridgeCommand>(
    command: Command,
  ) => Promise<BridgeResult<BridgeOutput<Command>>>;
}

const errorMessages: Readonly<Record<BridgeErrorCode, string>> = {
  "invalid-command": "The desktop command is not supported.",
  "invalid-input": "The desktop command input is invalid.",
  "capability-unavailable": "This desktop capability is unavailable in the current host.",
  "permission-denied": "The desktop host denied this operation.",
  "not-found": "The requested desktop resource was not found.",
  "operation-failed": "The desktop operation could not be completed.",
};

const bridgeErrorCodes = Object.freeze(Object.keys(errorMessages) as BridgeErrorCode[]);
const maxBridgeErrorMessageLength = 500;

const fileMediaTypeByExtension: Readonly<Record<SupportedFileExtension, SupportedMediaType>> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".htm": "text/html",
  ".html": "text/html",
  ".markdown": "text/markdown",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".text": "text/plain",
  ".txt": "text/plain",
};

const exportExtensionByFormat: Readonly<Record<ExportFormat, string>> = {
  docx: ".docx",
  markdown: ".md",
  pdf: ".pdf",
};

const commandNames = new Set<BridgeCommandName>(bridgeCapabilities);

/**
 * Ceilings for the recorded independence claim.
 *
 * The domain owns the real limits; these are this module's own bound on how
 * much host-supplied text may reach the trust panel. The lineage ceiling is
 * deliberately looser than the domain's 200-character limit on a *declared*
 * lineage, because a derived one is `company:modelId` and is bounded only by
 * those two fields. Refusing a lineage the domain accepted would fail the
 * whole review load over a label. The rationale ceiling is the domain's own
 * and bounds the claim in both directions: a renderer may send no more than
 * the domain would keep.
 */
const maximumLineageLength = 512;
const maximumOverrideRationaleLength = 500;

/**
 * The longest lineage this boundary accepts from a renderer.
 *
 * Unlike the ceiling above, which bounds a lineage the host derived, this
 * bounds one a person declared, so it mirrors the domain's
 * `maximumModelLineageLength` exactly: accepting a longer one would only defer
 * the same refusal to workspace creation.
 */
const maximumDeclaredLineageLength = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(record).every((key) => allowed.has(key));
}

function invalidInput(): never {
  throw new BridgeValidationError("invalid-input");
}

function invalidCommand(): never {
  throw new BridgeValidationError("invalid-command");
}

function stringValue(value: unknown, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    return invalidInput();
  }
  if ([...value].some((character) => character < " " || character === "\u007f")) {
    return invalidInput();
  }
  return value;
}

/**
 * A bounded paragraph of operator prose.
 *
 * Unlike `stringValue` this admits newlines and tabs: the independence
 * override rationale is something a person wrote for an auditor, and the
 * domain trims it rather than flattening it, so refusing a line break here
 * would reject a claim the domain already accepted. Every other control
 * character is still refused.
 */
function proseValue(value: unknown, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    return invalidInput();
  }
  if (
    [...value].some(
      (character) =>
        (character < " " && character !== "\n" && character !== "\t") || character === "\u007f",
    )
  ) {
    return invalidInput();
  }
  return value;
}

function urlValue(value: unknown): string {
  const result = stringValue(value, 2_048);
  try {
    const parsed = new URL(result);
    if (parsed.protocol !== "https:") return invalidInput();
  } catch {
    return invalidInput();
  }
  return result;
}

function identifier(value: unknown): string {
  const result = stringValue(value, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$/u.test(result)) {
    return invalidInput();
  }
  return result;
}

/**
 * An exact provider model id such as `claude-haiku-4-5`, `gpt-5.6-luna`, or a
 * provider-qualified `us.anthropic.claude-...`. These strings reach a provider
 * adapter, so the charset stays conservative.
 */
function modelId(value: unknown): string {
  const result = stringValue(value, 128).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(result)) {
    return invalidInput();
  }
  // A namespaced id such as `hf.co/user/model:Q4` is a name, never a path. It
  // reaches a provider only as the `model` field of a JSON body, but an id that
  // cannot be mistaken for a traversal keeps that true if it is ever placed
  // somewhere that resolves one.
  if (result.includes("..") || result.includes("//") || result.endsWith("/")) {
    return invalidInput();
  }
  return result;
}

/**
 * A human-readable CV section title such as `Summary` or `Work Experience`.
 * Titles are compared against generated headings, so the charset stays close
 * to what a heading can hold.
 */
function sectionTitle(value: unknown): string {
  const result = stringValue(value, 64).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 -]{0,63}$/u.test(result)) {
    return invalidInput();
  }
  return result;
}

/**
 * An empty list is rejected rather than accepted as "no requirements": the
 * application-layer config check only rejects bad entries, so an empty list
 * would pass it and silently disable the completeness check. Duplicates fail
 * loudly instead of being de-duplicated, because a caller sending them has a
 * bug.
 */
function sectionTitles(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) {
    return invalidInput();
  }
  const titles = value.map((entry) => sectionTitle(entry));
  if (new Set(titles).size !== titles.length) {
    return invalidInput();
  }
  return titles;
}

function workspaceName(value: unknown): string {
  const result = stringValue(value, 120);
  if (
    result.trim() !== result ||
    result === "." ||
    result === ".." ||
    result.includes("/") ||
    result.includes("\\")
  ) {
    return invalidInput();
  }
  return result;
}

function relativePath(value: unknown): string {
  const result = stringValue(value, 512);
  if (
    result.startsWith("/") ||
    result.includes("\\") ||
    /^[A-Za-z]:/u.test(result) ||
    result.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    return invalidInput();
  }
  return result;
}

function pathSegment(value: unknown): string {
  const result = stringValue(value, 256);
  if (
    result === "." ||
    result === ".." ||
    result.includes("/") ||
    result.includes("\\") ||
    result.includes("\u0000")
  ) {
    return invalidInput();
  }
  return result;
}

function enumValue<Value extends string>(value: unknown, values: readonly Value[]): Value {
  if (typeof value !== "string" || !values.includes(value as Value)) {
    return invalidInput();
  }
  return value as Value;
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== "boolean") {
    return invalidInput();
  }
  return value;
}

function optionalBooleanValue(value: unknown): boolean | undefined {
  return value === undefined ? undefined : booleanValue(value);
}

function optionalIdentifier(value: unknown): string | undefined {
  return value === undefined ? undefined : identifier(value);
}

function optionalModelId(value: unknown): string | undefined {
  return value === undefined ? undefined : modelId(value);
}

function optionalSectionTitles(value: unknown): readonly string[] | undefined {
  return value === undefined ? undefined : sectionTitles(value);
}

function optionalMaxRounds(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 20) {
    return invalidInput();
  }
  return value;
}

/**
 * A lineage label an operator declared, bounded the way the domain bounds one.
 *
 * The domain accepts any non-empty label of at most
 * `maximumModelLineageLength` characters once trimmed, and normalizes it
 * itself; this applies that same ceiling to the string as sent, so nothing
 * reaches workspace creation that would be refused there. It deliberately
 * computes nothing else: deriving a lineage is the domain's job alone.
 */
function lineageLabel(value: unknown): string {
  const result = stringValue(value, maximumDeclaredLineageLength).trim();
  if (result === "") return invalidInput();
  return result;
}

function optionalLineageLabel(value: unknown): string | undefined {
  return value === undefined ? undefined : lineageLabel(value);
}

function optionalModelCompany(value: unknown): ModelCompany | undefined {
  return value === undefined ? undefined : enumValue(value, modelCompanies);
}

function optionalOverrideRationale(value: unknown): string | undefined {
  return value === undefined ? undefined : proseValue(value, maximumOverrideRationaleLength).trim();
}

/**
 * The base URL of a model server on this machine.
 *
 * `local` is a promise that nothing leaves the machine, and an address this
 * boundary cannot prove is loopback is refused here rather than after a
 * workspace exists to hold it. The application's `isLoopbackEndpoint` stays the
 * authority and re-checks every configured endpoint; this repeats its rule
 * rather than importing it, because this module carries no application
 * dependency, and because a renderer form should be told no before a directory
 * is created. Refusing embedded credentials matters as much as the host: they
 * are unnecessary for a local server and the classic way to make a remote host
 * read as a local one.
 */
function localEndpointUrl(value: unknown): string {
  const result = stringValue(value, 512).trim();
  let url: URL;
  try {
    url = new URL(result);
  } catch {
    return invalidInput();
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return invalidInput();
  if (url.username !== "" || url.password !== "") return invalidInput();
  const hostname = url.hostname.toLowerCase();
  const octets = hostname.split(".");
  const loopbackIpv4 =
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => /^\d{1,3}$/u.test(octet) && Number(octet) <= 255);
  if (hostname !== "localhost" && hostname !== "[::1]" && !loopbackIpv4) return invalidInput();
  return result;
}

function optionalLocalEndpointUrl(value: unknown): string | undefined {
  return value === undefined ? undefined : localEndpointUrl(value);
}

function optionalRelativePath(value: unknown): string | undefined {
  return value === undefined ? undefined : relativePath(value);
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return invalidInput();
  }
  return value;
}

function validateWorkspaceOpenInput(value: unknown): WorkspaceOpenInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, workspaceOpenKeys)) return invalidInput();
  const selection = input.selection;
  if (selection !== undefined && selection !== "native-dialog") return invalidInput();
  return selection === undefined ? {} : { selection };
}

function nativeDialogSelection(value: unknown): "native-dialog" | undefined {
  if (value !== undefined && value !== "native-dialog") return invalidInput();
  return value;
}

function optionalDisplayName(value: unknown): string | undefined {
  return value === undefined ? undefined : displayName(value);
}

function optionalDescription(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const result = stringValue(value, 500).trim();
  if (result === "") return invalidInput();
  return result;
}

function validateKnowledgeStoreCreateInput(value: unknown): KnowledgeStoreCreateInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, knowledgeStoreCreateKeys)) return invalidInput();
  const selection = nativeDialogSelection(input.selection);
  const selectedDisplayName = optionalDisplayName(input.displayName);
  const description = optionalDescription(input.description);
  return {
    name: workspaceName(input.name),
    ...(selection === undefined ? {} : { selection }),
    ...(selectedDisplayName === undefined ? {} : { displayName: selectedDisplayName }),
    ...(description === undefined ? {} : { description }),
  };
}

function validateKnowledgeStoreOpenInput(value: unknown): KnowledgeStoreOpenInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, knowledgeStoreOpenKeys)) return invalidInput();
  const selection = nativeDialogSelection(input.selection);
  return selection === undefined ? {} : { selection };
}

function validateKnowledgeStoreListInput(value: unknown): KnowledgeStoreListInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, knowledgeStoreListKeys)) return invalidInput();
  return { storeId: identifier(input.storeId) };
}

function validateKnowledgeReadinessInput(value: unknown): KnowledgeReadinessInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, knowledgeReadinessKeys)) return invalidInput();
  return {
    storeId: identifier(input.storeId),
    knowledgeBaseId: identifier(input.knowledgeBaseId),
  };
}

function validateKnowledgeSourcesInput(value: unknown): KnowledgeSourcesInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, knowledgeSourcesKeys)) return invalidInput();
  return {
    storeId: identifier(input.storeId),
    knowledgeBaseId: identifier(input.knowledgeBaseId),
  };
}

function validateKnowledgeDuplicatesInput(value: unknown): KnowledgeDuplicatesInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, knowledgeDuplicatesKeys)) return invalidInput();
  return {
    storeId: identifier(input.storeId),
    knowledgeBaseId: identifier(input.knowledgeBaseId),
  };
}

function validateKnowledgeInventoryInput(value: unknown): KnowledgeInventoryInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, knowledgeInventoryKeys)) return invalidInput();
  return { storeId: identifier(input.storeId) };
}

function validateKnowledgeFileImportInput(value: unknown): KnowledgeFileImportInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, knowledgeFileImportKeys) || input.selection !== "native-dialog") {
    return invalidInput();
  }
  const selectedDisplayName = optionalDisplayName(input.displayName);
  return {
    storeId: identifier(input.storeId),
    knowledgeBaseId: identifier(input.knowledgeBaseId),
    selection: "native-dialog",
    ...(selectedDisplayName === undefined ? {} : { displayName: selectedDisplayName }),
  };
}

const maximumKnowledgeSelections = 32;

function validateKnowledgeSelectionEntry(value: unknown): KnowledgeSelectionEntry {
  const entry = requireRecord(value);
  if (!hasOnlyKeys(entry, knowledgeSelectionEntryKeys)) return invalidInput();
  return {
    storeId: identifier(entry.storeId),
    knowledgeBaseId: identifier(entry.knowledgeBaseId),
  };
}

function validateKnowledgeSelectionInput(value: unknown): KnowledgeSelectionInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, knowledgeSelectionInputKeys) || !Array.isArray(input.entries)) {
    return invalidInput();
  }
  if (input.entries.length === 0 || input.entries.length > maximumKnowledgeSelections) {
    return invalidInput();
  }
  const entries = input.entries.map(validateKnowledgeSelectionEntry);
  const logicalSelections = entries.map(
    (entry) => `${entry.storeId}\u0000${entry.knowledgeBaseId}`,
  );
  if (new Set(logicalSelections).size !== entries.length) return invalidInput();
  const combinationApproved = optionalBooleanValue(input.combinationApproved);
  return {
    workspaceId: identifier(input.workspaceId),
    entries,
    ...(combinationApproved === undefined ? {} : { combinationApproved }),
  };
}

function validateKnowledgeBaseCreateInput(value: unknown): KnowledgeBaseCreateInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, knowledgeBaseCreateKeys)) return invalidInput();
  const description = optionalDescription(input.description);
  return {
    storeId: identifier(input.storeId),
    displayName: displayName(input.displayName),
    ...(description === undefined ? {} : { description }),
  };
}

function validateKnowledgeBaseRenameInput(value: unknown): KnowledgeBaseRenameInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, knowledgeBaseRenameKeys)) return invalidInput();
  return {
    storeId: identifier(input.storeId),
    knowledgeBaseId: identifier(input.knowledgeBaseId),
    displayName: displayName(input.displayName),
  };
}

function validateKnowledgeBaseArchiveInput(value: unknown): KnowledgeBaseArchiveInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, knowledgeBaseArchiveKeys)) return invalidInput();
  return {
    storeId: identifier(input.storeId),
    knowledgeBaseId: identifier(input.knowledgeBaseId),
    confirmed: booleanValue(input.confirmed),
  };
}

function validateWorkspaceCreateInput(value: unknown): WorkspaceCreateInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, workspaceCreateKeys)) return invalidInput();
  const mode =
    input.mode === undefined ? undefined : enumValue(input.mode, ["real", "demo"] as const);
  const authorCompany = optionalModelCompany(input.authorCompany);
  const authorModel = optionalModelId(input.authorModel);
  const criticCompany = optionalModelCompany(input.criticCompany);
  const criticModel = optionalModelId(input.criticModel);
  const authorLineage = optionalLineageLabel(input.authorLineage);
  const criticLineage = optionalLineageLabel(input.criticLineage);
  const localEndpoint = optionalLocalEndpointUrl(input.localEndpoint);
  const independenceOverrideRationale = optionalOverrideRationale(
    input.independenceOverrideRationale,
  );
  const requiredSections = optionalSectionTitles(input.requiredSections);
  const maxRounds = optionalMaxRounds(input.maxRounds);
  return {
    name: workspaceName(input.name),
    ...(mode === undefined ? {} : { mode }),
    ...(authorCompany === undefined ? {} : { authorCompany }),
    ...(authorModel === undefined ? {} : { authorModel }),
    ...(criticCompany === undefined ? {} : { criticCompany }),
    ...(criticModel === undefined ? {} : { criticModel }),
    ...(authorLineage === undefined ? {} : { authorLineage }),
    ...(criticLineage === undefined ? {} : { criticLineage }),
    ...(localEndpoint === undefined ? {} : { localEndpoint }),
    ...(independenceOverrideRationale === undefined ? {} : { independenceOverrideRationale }),
    ...(requiredSections === undefined ? {} : { requiredSections }),
    ...(maxRounds === undefined ? {} : { maxRounds }),
  };
}

/**
 * The whole pairing, or nothing.
 *
 * Every part of the model configuration is required here even though the
 * application would accept fewer fields, because this command replaces rather
 * than merges: accepting a partial input at the boundary would invite a caller
 * to send one side and expect the other to be kept.
 */
function validateWorkspaceConfigureModelsInput(value: unknown): WorkspaceConfigureModelsInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, workspaceConfigureModelsKeys)) return invalidInput();
  const authorLineage = optionalLineageLabel(input.authorLineage);
  const criticLineage = optionalLineageLabel(input.criticLineage);
  const localEndpoint = optionalLocalEndpointUrl(input.localEndpoint);
  const independenceOverrideRationale = optionalOverrideRationale(
    input.independenceOverrideRationale,
  );
  return {
    workspaceId: identifier(input.workspaceId),
    authorCompany: enumValue(input.authorCompany, modelCompanies),
    authorModel: modelId(input.authorModel),
    criticCompany: enumValue(input.criticCompany, modelCompanies),
    criticModel: modelId(input.criticModel),
    ...(authorLineage === undefined ? {} : { authorLineage }),
    ...(criticLineage === undefined ? {} : { criticLineage }),
    ...(localEndpoint === undefined ? {} : { localEndpoint }),
    ...(independenceOverrideRationale === undefined ? {} : { independenceOverrideRationale }),
  };
}

function validateRunStatusInput(value: unknown): RunStatusInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, runStatusKeys)) return invalidInput();
  const runId = optionalIdentifier(input.runId);
  return {
    workspaceId: identifier(input.workspaceId),
    ...(runId === undefined ? {} : { runId }),
  };
}

function validateRunStartInput(value: unknown): RunStartInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, runStartKeys)) return invalidInput();
  return { workspaceId: identifier(input.workspaceId) };
}

function validateRunLifecycleInput(value: unknown): RunLifecycleInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, runLifecycleKeys)) return invalidInput();
  return {
    workspaceId: identifier(input.workspaceId),
    runId: identifier(input.runId),
  };
}

function validateReviewLoadInput(value: unknown): ReviewLoadInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, reviewLoadKeys)) return invalidInput();
  const workspaceId = optionalIdentifier(input.workspaceId);
  const runId = optionalIdentifier(input.runId);
  return {
    ...(workspaceId === undefined ? {} : { workspaceId }),
    ...(runId === undefined ? {} : { runId }),
  };
}

function validateReviewAction(value: unknown): ReviewAction {
  const action = requireRecord(value);
  if (typeof action.type !== "string") return invalidInput();
  switch (action.type) {
    case "finding-decision": {
      if (!hasOnlyKeys(action, ["type", "findingId", "decision", "rationale"]))
        return invalidInput();
      const rationale =
        action.rationale === undefined ? undefined : stringValue(action.rationale, 1_000).trim();
      if (action.decision === "overridden" && rationale === "") return invalidInput();
      return {
        type: action.type,
        findingId: identifier(action.findingId),
        decision: enumValue(action.decision, [
          "pending",
          "accepted",
          "rejected",
          "deferred",
          "overridden",
        ] as const),
        ...(rationale === undefined ? {} : { rationale }),
      };
    }
    case "edit-block":
      if (!hasOnlyKeys(action, ["type", "blockId", "text"])) return invalidInput();
      return {
        type: action.type,
        blockId: identifier(action.blockId),
        text: stringValue(action.text, 20_000),
      };
    case "acknowledge-provider-transmission": {
      if (!hasOnlyKeys(action, ["type", "fingerprint"])) return invalidInput();
      const fingerprint = stringValue(action.fingerprint, 64);
      if (!/^[a-f0-9]{64}$/u.test(fingerprint)) return invalidInput();
      return { type: action.type, fingerprint };
    }
    case "pause":
    case "start":
    case "resume":
    case "recover-to-review":
    case "recover-round-limit":
    case "stop":
    case "request-revision":
    case "approve":
    case "export":
      if (!hasOnlyKeys(action, ["type"])) return invalidInput();
      return { type: action.type };
    default:
      return invalidInput();
  }
}

function validateReviewDispatchInput(value: unknown): ReviewDispatchInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, reviewDispatchKeys)) return invalidInput();
  return {
    workspaceId: identifier(input.workspaceId),
    runId: identifier(input.runId),
    action: validateReviewAction(input.action),
  };
}

function validateFileSelectInput(value: unknown): FileSelectInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, fileSelectKeys)) return invalidInput();
  const extensions = input.extensions;
  if (extensions !== undefined && !Array.isArray(extensions)) return invalidInput();
  const normalizedExtensions = extensions?.map((extension) =>
    enumValue(extension, supportedFileExtensions),
  );
  if (
    normalizedExtensions !== undefined &&
    new Set(normalizedExtensions).size !== normalizedExtensions.length
  ) {
    return invalidInput();
  }
  const multiple = optionalBooleanValue(input.multiple);
  const target =
    input.target === undefined
      ? undefined
      : enumValue(input.target, ["evidence", "job-description", "writing-policy"] as const);
  return {
    workspaceId: identifier(input.workspaceId),
    ...(normalizedExtensions === undefined ? {} : { extensions: normalizedExtensions }),
    ...(multiple === undefined ? {} : { multiple }),
    ...(target === undefined ? {} : { target }),
  };
}

function validateSourceAddUrlInput(value: unknown): SourceAddUrlInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, sourceAddUrlKeys)) return invalidInput();
  if (input.approved !== true) return invalidInput();
  return {
    workspaceId: identifier(input.workspaceId),
    url: urlValue(input.url),
    target: enumValue(input.target, ["evidence", "job-description"] as const),
    approved: true,
  };
}

function validateExportWriteInput(value: unknown): ExportWriteInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, exportWriteKeys)) return invalidInput();
  const path = optionalRelativePath(input.relativePath);
  if (path !== undefined && !path.startsWith("exports/")) return invalidInput();
  const format = enumValue(input.format, exportFormats);
  if (path !== undefined && !path.toLowerCase().endsWith(exportExtensionByFormat[format])) {
    return invalidInput();
  }
  return {
    workspaceId: identifier(input.workspaceId),
    runId: identifier(input.runId),
    format,
    ...(path === undefined ? {} : { relativePath: path }),
  };
}

function validateCredentialInput(value: unknown): CredentialStatusInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, credentialKeys)) return invalidInput();
  return { provider: enumValue(input.provider, credentialProviders) };
}

function validateCredentialSetInput(value: unknown): CredentialSetInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, credentialSetKeys)) return invalidInput();
  const provider = enumValue(input.provider, credentialProviders);
  if (typeof input.apiKey !== "string" || input.apiKey.trim().length === 0) return invalidInput();
  return { provider, apiKey: input.apiKey.trim() };
}

function validateModelsListInput(value: unknown): ModelsListInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, modelsListKeys)) return invalidInput();
  const workspaceId = optionalIdentifier(input.workspaceId);
  const refresh = optionalBooleanValue(input.refresh);
  return {
    provider: enumValue(input.provider, modelDiscoveryProviders),
    ...(workspaceId === undefined ? {} : { workspaceId }),
    ...(refresh === undefined ? {} : { refresh }),
  };
}

function validateModelCandidate(value: unknown): ModelCandidate {
  const candidate = requireRecord(value);
  if (!hasOnlyKeys(candidate, modelCandidateKeys)) return invalidInput();
  const lineage = optionalLineageLabel(candidate.lineage);
  return {
    company: identifier(candidate.company),
    modelId: modelId(candidate.modelId),
    ...(lineage === undefined ? {} : { lineage }),
  };
}

function validateModelsPreviewIndependenceInput(value: unknown): ModelsPreviewIndependenceInput {
  const input = requireRecord(value);
  if (!hasOnlyKeys(input, modelsPreviewIndependenceKeys)) return invalidInput();
  return {
    author: validateModelCandidate(input.author),
    critic: validateModelCandidate(input.critic),
  };
}

/** Parses untrusted renderer input into one of the allowlisted bridge commands. */
export function validateBridgeCommand(value: unknown): BridgeCommand {
  const command = requireRecord(value);
  if (typeof command.type !== "string" || !commandNames.has(command.type as BridgeCommandName)) {
    return invalidCommand();
  }
  switch (command.type as BridgeCommandName) {
    case "workspace.open":
      return { type: "workspace.open", input: validateWorkspaceOpenInput(command.input) };
    case "workspace.create":
      return { type: "workspace.create", input: validateWorkspaceCreateInput(command.input) };
    case "workspace.configure-models":
      return {
        type: "workspace.configure-models",
        input: validateWorkspaceConfigureModelsInput(command.input),
      };
    case "knowledge.create":
      return { type: "knowledge.create", input: validateKnowledgeStoreCreateInput(command.input) };
    case "knowledge.open":
      return { type: "knowledge.open", input: validateKnowledgeStoreOpenInput(command.input) };
    case "knowledge.list":
      return { type: "knowledge.list", input: validateKnowledgeStoreListInput(command.input) };
    case "knowledge.readiness":
      return { type: "knowledge.readiness", input: validateKnowledgeReadinessInput(command.input) };
    case "knowledge.sources":
      return { type: "knowledge.sources", input: validateKnowledgeSourcesInput(command.input) };
    case "knowledge.duplicates":
      return {
        type: "knowledge.duplicates",
        input: validateKnowledgeDuplicatesInput(command.input),
      };
    case "knowledge.inventory":
      return {
        type: "knowledge.inventory",
        input: validateKnowledgeInventoryInput(command.input),
      };
    case "knowledge.import-file":
      return {
        type: "knowledge.import-file",
        input: validateKnowledgeFileImportInput(command.input),
      };
    case "knowledge.select":
      return { type: "knowledge.select", input: validateKnowledgeSelectionInput(command.input) };
    case "knowledge.create-base":
      return {
        type: "knowledge.create-base",
        input: validateKnowledgeBaseCreateInput(command.input),
      };
    case "knowledge.rename-base":
      return {
        type: "knowledge.rename-base",
        input: validateKnowledgeBaseRenameInput(command.input),
      };
    case "knowledge.archive-base":
      return {
        type: "knowledge.archive-base",
        input: validateKnowledgeBaseArchiveInput(command.input),
      };
    case "run.status":
      return { type: "run.status", input: validateRunStatusInput(command.input) };
    case "run.start":
      return { type: "run.start", input: validateRunStartInput(command.input) };
    case "run.pause":
      return { type: "run.pause", input: validateRunLifecycleInput(command.input) };
    case "run.resume":
      return { type: "run.resume", input: validateRunLifecycleInput(command.input) };
    case "run.stop":
      return { type: "run.stop", input: validateRunLifecycleInput(command.input) };
    case "review.load":
      return { type: "review.load", input: validateReviewLoadInput(command.input) };
    case "review.dispatch":
      return { type: "review.dispatch", input: validateReviewDispatchInput(command.input) };
    case "file.select":
      return { type: "file.select", input: validateFileSelectInput(command.input) };
    case "source.add-url":
      return { type: "source.add-url", input: validateSourceAddUrlInput(command.input) };
    case "export.write":
      return { type: "export.write", input: validateExportWriteInput(command.input) };
    case "credential.status":
      return { type: "credential.status", input: validateCredentialInput(command.input) };
    case "credential.set":
      return { type: "credential.set", input: validateCredentialSetInput(command.input) };
    case "credential.remove":
      return { type: "credential.remove", input: validateCredentialInput(command.input) };
    case "models.list":
      return { type: "models.list", input: validateModelsListInput(command.input) };
    case "models.preview-independence":
      return {
        type: "models.preview-independence",
        input: validateModelsPreviewIndependenceInput(command.input),
      };
  }
}

export function bridgeError(
  code: BridgeErrorCode,
  capability?: BridgeCapability,
  customMessage?: string,
): BridgeError {
  const message = bridgeErrorMessage(customMessage);
  return {
    code,
    message: message ?? errorMessages[code],
    ...(capability === undefined ? {} : { capability }),
  };
}

export function unavailableResult<Value>(capability: BridgeCapability): BridgeResult<Value> {
  return { ok: false, error: bridgeError("capability-unavailable", capability) };
}

export function safeBridgeError(error: unknown, capability?: BridgeCapability): BridgeError {
  if (error instanceof BridgeValidationError) {
    return bridgeError(error.code, capability);
  }
  const customMessage =
    isRecord(error) && error.name === "NativeHostError"
      ? bridgeErrorMessage(error.message)
      : undefined;
  if (isRecord(error) && isBridgeErrorCode(error.code)) {
    return bridgeError(error.code, capability, customMessage);
  }
  return bridgeError("operation-failed", capability);
}

function bridgeErrorMessage(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxBridgeErrorMessageLength ||
    value.trim().length === 0
  ) {
    return undefined;
  }
  if (
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 0x20 || codePoint === 0x7f || (codePoint >= 0x80 && codePoint <= 0x9f);
    })
  ) {
    return undefined;
  }
  return value;
}

function isBridgeErrorCode(value: unknown): value is BridgeErrorCode {
  return typeof value === "string" && bridgeErrorCodes.includes(value as BridgeErrorCode);
}

function safeSerializedBridgeError(error: unknown, capability?: BridgeCapability): BridgeError {
  if (!isRecord(error) || !hasOnlyKeys(error, ["code", "message", "capability"])) {
    return safeBridgeError(error, capability);
  }
  const message = bridgeErrorMessage(error.message);
  if (
    !isBridgeErrorCode(error.code) ||
    message === undefined ||
    (error.capability !== undefined &&
      (!bridgeCapabilities.includes(error.capability as BridgeCapability) ||
        error.capability !== capability))
  ) {
    return safeBridgeError(error, capability);
  }
  return bridgeError(error.code, capability, message);
}

class BridgeValidationError extends Error {
  public readonly code: "invalid-command" | "invalid-input";

  public constructor(code: "invalid-command" | "invalid-input") {
    super(errorMessages[code]);
    this.name = "BridgeValidationError";
    this.code = code;
  }
}

function normalizeCapabilities(
  capabilities: ReadonlySet<BridgeCapability> | readonly BridgeCapability[],
): readonly BridgeCapability[] {
  const advertised = Array.from(capabilities);
  return Object.freeze(bridgeCapabilities.filter((capability) => advertised.includes(capability)));
}

function finiteInteger(value: unknown, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max) {
    return invalidInput();
  }
  return value;
}

function displayName(value: unknown): string {
  const result = stringValue(value, 120);
  if (result.trim() !== result || result.includes("\n") || result.includes("\r")) {
    return invalidInput();
  }
  return result;
}

function normalizeWorkspaceResult(value: unknown): WorkspaceResult {
  const result = requireRecord(value);
  if (!hasOnlyKeys(result, workspaceResultKeys)) return invalidInput();
  const workspace = requireRecord(result.workspace);
  if (!hasOnlyKeys(workspace, workspaceSummaryKeys)) return invalidInput();
  return {
    workspace: {
      id: identifier(workspace.id),
      name: displayName(workspace.name),
    },
  };
}

const knowledgeBlockerReasons = [
  "knowledge-base-archived",
  "source-retired",
  "latest-version-unmanaged",
  "source-origin-unbound",
  "directory-origin-conflict",
  "refresh-stale",
  "refresh-changed",
  "refresh-missing",
  "refresh-inaccessible",
  "refresh-unbound",
] as const;
const maximumKnowledgeInspectionEntries = 256;

function normalizeKnowledgeStoreResult(value: unknown): KnowledgeStoreResult {
  const result = requireRecord(value);
  if (!hasOnlyKeys(result, knowledgeStoreResultKeys) || !Array.isArray(result.knowledgeBases)) {
    return invalidInput();
  }
  if (result.knowledgeBases.length > 100) return invalidInput();
  const knowledgeBases = result.knowledgeBases.map((value) => {
    const base = requireRecord(value);
    if (!hasOnlyKeys(base, knowledgeBaseSummaryKeys)) return invalidInput();
    return {
      id: identifier(base.id),
      displayName: displayName(base.displayName),
      description: base.description === "" ? "" : stringValue(base.description, 500),
      state: enumValue(base.state, ["active", "archived"] as const),
      isDefault: booleanValue(base.isDefault),
    } satisfies KnowledgeBaseSummary;
  });
  if (new Set(knowledgeBases.map((base) => base.id)).size !== knowledgeBases.length) {
    return invalidInput();
  }
  return { storeId: identifier(result.storeId), knowledgeBases };
}

function normalizeKnowledgeReadinessResult(value: unknown): KnowledgeReadinessResult {
  const result = requireRecord(value);
  if (!hasOnlyKeys(result, knowledgeReadinessResultKeys) || !Array.isArray(result.blockerReasons)) {
    return invalidInput();
  }
  if (result.blockerReasons.length > knowledgeBlockerReasons.length) return invalidInput();
  const sourceCount = finiteInteger(result.sourceCount, 1_000_000);
  const readyCount = finiteInteger(result.readyCount, sourceCount);
  const blockedCount = finiteInteger(result.blockedCount, sourceCount);
  if (readyCount + blockedCount !== sourceCount) return invalidInput();
  const blockerReasons = result.blockerReasons.map((reason) =>
    enumValue(reason, knowledgeBlockerReasons),
  );
  if (new Set(blockerReasons).size !== blockerReasons.length) return invalidInput();
  return {
    storeId: identifier(result.storeId),
    knowledgeBaseId: identifier(result.knowledgeBaseId),
    state: enumValue(result.state, ["active", "archived"] as const),
    sourceCount,
    readyCount,
    blockedCount,
    blockerReasons,
  };
}

function normalizeKnowledgeSourcesResult(value: unknown): KnowledgeSourcesResult {
  const result = requireRecord(value);
  if (!hasOnlyKeys(result, knowledgeSourcesResultKeys) || !Array.isArray(result.sources)) {
    return invalidInput();
  }
  if (result.sources.length > maximumKnowledgeInspectionEntries) return invalidInput();
  const sourceCount = finiteInteger(result.sourceCount, 1_000_000);
  const sources = result.sources.map((value) => {
    const source = requireRecord(value);
    if (!hasOnlyKeys(source, knowledgeSourceSummaryKeys)) return invalidInput();
    return {
      sourceId: identifier(source.sourceId),
      kind: enumValue(source.kind, ["file", "url"] as const),
      latestVersionId: source.latestVersionId === null ? null : identifier(source.latestVersionId),
      versionCount: finiteInteger(source.versionCount, 1_000_000),
    } satisfies KnowledgeSourceSummary;
  });
  if (
    sourceCount < sources.length ||
    booleanValue(result.truncated) !== sourceCount > sources.length ||
    sources.some((source) => (source.versionCount === 0) !== (source.latestVersionId === null)) ||
    new Set(sources.map((source) => source.sourceId)).size !== sources.length
  ) {
    return invalidInput();
  }
  return {
    storeId: identifier(result.storeId),
    knowledgeBaseId: identifier(result.knowledgeBaseId),
    sourceCount,
    sources,
    truncated: booleanValue(result.truncated),
  };
}

function normalizeKnowledgeDuplicatesResult(value: unknown): KnowledgeDuplicatesResult {
  const result = requireRecord(value);
  if (!hasOnlyKeys(result, knowledgeDuplicatesResultKeys) || !Array.isArray(result.groups)) {
    return invalidInput();
  }
  if (result.groups.length > maximumKnowledgeInspectionEntries) return invalidInput();
  const groupCount = finiteInteger(result.groupCount, 1_000_000);
  const groups = result.groups.map((value) => {
    const group = requireRecord(value);
    if (!hasOnlyKeys(group, knowledgeDuplicateGroupSummaryKeys) || !Array.isArray(group.members)) {
      return invalidInput();
    }
    if (group.members.length < 2 || group.members.length > maximumKnowledgeInspectionEntries) {
      return invalidInput();
    }
    const memberCount = finiteInteger(group.memberCount, 1_000_000);
    const members = group.members.map((value) => {
      const member = requireRecord(value);
      if (!hasOnlyKeys(member, knowledgeDuplicateMemberKeys)) return invalidInput();
      return {
        sourceId: identifier(member.sourceId),
        versionId: identifier(member.versionId),
      } satisfies KnowledgeDuplicateMember;
    });
    const truncated = booleanValue(group.truncated);
    if (
      memberCount < members.length ||
      truncated !== memberCount > members.length ||
      new Set(members.map((member) => member.sourceId)).size !== members.length
    ) {
      return invalidInput();
    }
    return {
      memberCount,
      members,
      truncated,
    } satisfies KnowledgeDuplicateGroupSummary;
  });
  const sourceIds = groups.flatMap((group) => group.members.map((member) => member.sourceId));
  const truncated = booleanValue(result.truncated);
  if (
    groupCount < groups.length ||
    truncated !== (groupCount > groups.length || groups.some((group) => group.truncated)) ||
    new Set(sourceIds).size !== sourceIds.length
  ) {
    return invalidInput();
  }
  return {
    storeId: identifier(result.storeId),
    knowledgeBaseId: identifier(result.knowledgeBaseId),
    groupCount,
    groups,
    truncated,
  };
}

function normalizeKnowledgeInventoryResult(value: unknown): KnowledgeInventoryResult {
  const result = requireRecord(value);
  if (!hasOnlyKeys(result, knowledgeInventoryResultKeys)) return invalidInput();
  const unknown = requireRecord(result.unknownEntries);
  if (!hasOnlyKeys(unknown, knowledgeInventoryUnknownEntriesKeys)) return invalidInput();
  const complete = booleanValue(result.complete);
  const scanLimitReached = booleanValue(result.scanLimitReached);
  if (complete === scanLimitReached || result.schemaVersion !== 1) return invalidInput();
  return {
    storeId: identifier(result.storeId),
    schemaVersion: 1,
    verifiedManagedFileCount: finiteInteger(result.verifiedManagedFileCount, 1_000_000),
    scannedEntryCount: finiteInteger(result.scannedEntryCount, 1_000_000),
    unknownEntries: {
      intakeShapedFilesAtSourcesRoot: finiteInteger(
        unknown.intakeShapedFilesAtSourcesRoot,
        1_000_000,
      ),
      opaqueEntriesAtSourcesRoot: finiteInteger(unknown.opaqueEntriesAtSourcesRoot, 1_000_000),
      entriesInsideManagedSourceDirectories: finiteInteger(
        unknown.entriesInsideManagedSourceDirectories,
        1_000_000,
      ),
      symbolicLinks: finiteInteger(unknown.symbolicLinks, 1_000_000),
      otherEntries: finiteInteger(unknown.otherEntries, 1_000_000),
    },
    complete,
    scanLimitReached,
  };
}

function normalizeKnowledgeFileImportResult(value: unknown): KnowledgeFileImportResult {
  const result = requireRecord(value);
  if (!hasOnlyKeys(result, knowledgeFileImportResultKeys)) return invalidInput();
  const version = finiteInteger(result.version, 1_000_000);
  if (version === 0) return invalidInput();
  return {
    storeId: identifier(result.storeId),
    knowledgeBaseId: identifier(result.knowledgeBaseId),
    sourceId: identifier(result.sourceId),
    kind: enumValue(result.kind, ["file"] as const),
    versionId: identifier(result.versionId),
    version,
    created: booleanValue(result.created),
  };
}

function normalizeKnowledgeSelectionResult(value: unknown): KnowledgeSelectionResult {
  const result = requireRecord(value);
  if (!hasOnlyKeys(result, knowledgeSelectionResultKeys) || !Array.isArray(result.entries)) {
    return invalidInput();
  }
  if (result.entries.length === 0 || result.entries.length > maximumKnowledgeSelections) {
    return invalidInput();
  }
  const entries = result.entries.map(validateKnowledgeSelectionEntry);
  const logicalSelections = entries.map(
    (entry) => `${entry.storeId}\u0000${entry.knowledgeBaseId}`,
  );
  if (new Set(logicalSelections).size !== entries.length) return invalidInput();
  return { workspaceId: identifier(result.workspaceId), entries };
}

function normalizeWorkspaceModelsResult(value: unknown): WorkspaceModelsResult {
  const result = requireRecord(value);
  if (!hasOnlyKeys(result, workspaceModelsResultKeys)) return invalidInput();
  return {
    workspaceId: identifier(result.workspaceId),
    authorCompany: enumValue(result.authorCompany, modelCompanies),
    authorModel: modelId(result.authorModel),
    criticCompany: enumValue(result.criticCompany, modelCompanies),
    criticModel: modelId(result.criticModel),
    localEndpoint: result.localEndpoint === null ? null : localEndpointUrl(result.localEndpoint),
  };
}

function normalizeRunStatus(value: unknown): RunStatus {
  const result = requireRecord(value);
  if (!hasOnlyKeys(result, runStatusResultKeys)) return invalidInput();
  const runId = result.runId === null ? null : identifier(result.runId);
  return {
    workspaceId: identifier(result.workspaceId),
    runId,
    state: enumValue(result.state, runStates),
    round: finiteInteger(result.round, 1_000_000),
    approval: enumValue(result.approval, ["pending", "approved", "rejected"] as const),
  };
}

function normalizeReviewState(value: unknown): ReviewStateResult {
  if (!isRecord(value)) return invalidInput();
  if (
    typeof value.workspaceId !== "string" ||
    typeof value.runId !== "string" ||
    typeof value.state !== "string" ||
    !(runStates as readonly string[]).includes(value.state)
  ) {
    return invalidInput();
  }
  const exposure = requireRecord(value.providerExposure);
  if (!hasOnlyKeys(exposure, providerExposureResultKeys)) return invalidInput();
  const independentReview = exposure.independentReview;
  if (independentReview !== null && independentReview !== undefined) {
    const record = requireRecord(independentReview);
    if (!hasOnlyKeys(record, independentReviewResultKeys)) return invalidInput();
    stringValue(record.authorLineage, maximumLineageLength);
    stringValue(record.criticLineage, maximumLineageLength);
    booleanValue(record.lineagesDistinct);
    booleanValue(record.required);
    if (record.overrideRationale !== null) {
      proseValue(record.overrideRationale, maximumOverrideRationaleLength);
    }
  }
  const providerFailure = value.providerFailure;
  if (providerFailure !== null && providerFailure !== undefined) {
    const failure = requireRecord(providerFailure);
    if (
      !hasOnlyKeys(failure, providerFailureResultKeys) ||
      typeof failure.availableActions !== "object" ||
      !Array.isArray(failure.availableActions) ||
      failure.availableActions.length > 3
    ) {
      return invalidInput();
    }
    enumValue(failure.code, [
      "authentication",
      "permission",
      "rate-limit",
      "quota-exhausted",
      "timeout",
      "cancelled",
      "transient",
      "invalid-request",
      "invalid-response",
      "policy",
      "unknown",
    ] as const);
    stringValue(failure.explanation, 500);
    identifier(failure.provider);
    identifier(failure.model);
    enumValue(failure.step, ["author", "critic", "revision"] as const);
    const attempt = finiteInteger(failure.attempt, 100);
    const maxAttempts = finiteInteger(failure.maxAttempts, 100);
    if (attempt < 1 || maxAttempts < 1 || attempt > maxAttempts) return invalidInput();
    const retryAvailable = booleanValue(failure.retryAvailable);
    if (
      failure.retryNotBefore !== null &&
      (typeof failure.retryNotBefore !== "string" ||
        failure.retryNotBefore.length > 64 ||
        !Number.isFinite(Date.parse(failure.retryNotBefore)))
    ) {
      return invalidInput();
    }
    const actions = failure.availableActions.map((action) =>
      enumValue(action, ["retry", "return-to-review", "stop"] as const),
    );
    if (new Set(actions).size !== actions.length) return invalidInput();
    if (retryAvailable !== actions.includes("retry")) return invalidInput();
    if (!Array.isArray(failure.diagnostics) || failure.diagnostics.length > 8) {
      return invalidInput();
    }
    for (const diagnostic of failure.diagnostics) {
      const item = requireRecord(diagnostic);
      if (!hasOnlyKeys(item, ["code", "path"])) return invalidInput();
      const diagnosticCode = stringValue(item.code, 64);
      const diagnosticPath = stringValue(item.path, 160);
      if (!/^[A-Za-z0-9_-]+$/u.test(diagnosticCode) || !/^[A-Za-z0-9_.-]*$/u.test(diagnosticPath)) {
        return invalidInput();
      }
    }
  }
  return value as unknown as DesktopReviewState;
}

function normalizeFileResult(value: unknown): FileSelectResult {
  const result = requireRecord(value);
  if (
    !hasOnlyKeys(result, fileSelectResultKeys) ||
    !Array.isArray(result.files) ||
    result.files.length > 100
  ) {
    return invalidInput();
  }
  return {
    files: result.files.map((item) => {
      const file = requireRecord(item);
      if (!hasOnlyKeys(file, selectedFileKeys)) return invalidInput();
      const path = relativePath(file.relativePath);
      const name = pathSegment(file.name);
      const extension = `.${name.split(".").at(-1)?.toLowerCase() ?? ""}`;
      if (!supportedFileExtensions.includes(extension as SupportedFileExtension)) {
        return invalidInput();
      }
      const mediaType = enumValue(file.mediaType, supportedMediaTypes);
      if (fileMediaTypeByExtension[extension as SupportedFileExtension] !== mediaType) {
        return invalidInput();
      }
      return {
        id: identifier(file.id),
        name,
        relativePath: path,
        mediaType,
        byteLength: finiteInteger(file.byteLength, 2 ** 40),
      } satisfies SelectedFile;
    }),
  };
}

function normalizeSourceAddUrlResult(value: unknown): SourceAddUrlResult {
  const result = requireRecord(value);
  if (!hasOnlyKeys(result, sourceAddUrlResultKeys)) {
    return invalidInput();
  }
  return {
    sourcePath: relativePath(result.sourcePath),
    originalUrl: urlValue(result.originalUrl),
    finalUrl: urlValue(result.finalUrl),
    kind: stringValue(result.kind, 64),
    extractionStatus: enumValue(result.extractionStatus, ["extracted", "generic-fallback"]),
    mediaType: enumValue(result.mediaType, supportedMediaTypes),
  };
}

function normalizeExportResult(value: unknown): ExportResult {
  const result = requireRecord(value);
  if (!hasOnlyKeys(result, exportResultKeys)) return invalidInput();
  const format = enumValue(result.format, exportFormats);
  const path = relativePath(result.relativePath);
  if (
    !path.startsWith("exports/") ||
    !path.toLowerCase().endsWith(exportExtensionByFormat[format])
  ) {
    return invalidInput();
  }
  return {
    exportId: identifier(result.exportId),
    workspaceId: identifier(result.workspaceId),
    runId: identifier(result.runId),
    format,
    relativePath: path,
  };
}

function normalizeCredentialResult(value: unknown): CredentialResult {
  const result = requireRecord(value);
  if (!hasOnlyKeys(result, credentialResultKeys)) return invalidInput();
  return {
    provider: enumValue(result.provider, credentialProviders),
    configured: booleanValue(result.configured),
    source: enumValue(result.source, credentialSources),
    protection: enumValue(result.protection, credentialProtections),
  };
}

/**
 * Polices a catalogue on its way to the renderer.
 *
 * The host has already bounded what the provider said, and this checks it
 * again: an id that reaches here is one the workspace configuration would
 * accept, so a person choosing from this list cannot end up with a model id
 * the rest of the system refuses -- or with a lineage nobody meant.
 */
function normalizeModelsListResult(value: unknown): ModelsListResult {
  const result = requireRecord(value);
  if (
    !hasOnlyKeys(result, modelsListResultKeys) ||
    !Array.isArray(result.models) ||
    result.models.length > maximumDiscoveredModels
  ) {
    return invalidInput();
  }
  const models = result.models.map((item) => {
    const model = requireRecord(item);
    if (!hasOnlyKeys(model, discoveredModelKeys)) return invalidInput();
    return { id: modelId(model.id) } satisfies DiscoveredModelSummary;
  });
  if (new Set(models.map((model) => model.id)).size !== models.length) return invalidInput();
  const retrievedAt = stringValue(result.retrievedAt, 64);
  if (!Number.isFinite(Date.parse(retrievedAt))) return invalidInput();
  return {
    provider: enumValue(result.provider, modelDiscoveryProviders),
    models,
    truncated: booleanValue(result.truncated),
    source: enumValue(result.source, ["live", "cache"] as const),
    retrievedAt,
  };
}

/**
 * Polices a previewed independence answer on its way back to the renderer.
 *
 * The lineages are checked as bounded labels and nothing more: whether they
 * are distinct is the domain's answer, and re-deriving or second-guessing it
 * here would put a copy of the rule on the renderer's side of the boundary,
 * which is the defect this command exists to avoid.
 */
function normalizeModelsPreviewIndependenceResult(value: unknown): ModelsPreviewIndependenceResult {
  const result = requireRecord(value);
  if (!hasOnlyKeys(result, modelsPreviewIndependenceResultKeys)) return invalidInput();
  return {
    authorLineage: stringValue(result.authorLineage, maximumLineageLength),
    criticLineage: stringValue(result.criticLineage, maximumLineageLength),
    lineagesDistinct: booleanValue(result.lineagesDistinct),
  };
}

function normalizeSuccess(command: BridgeCommandName, value: unknown): unknown {
  switch (command) {
    case "workspace.open":
    case "workspace.create":
      return normalizeWorkspaceResult(value);
    case "workspace.configure-models":
      return normalizeWorkspaceModelsResult(value);
    case "knowledge.create":
    case "knowledge.open":
    case "knowledge.list":
    case "knowledge.create-base":
    case "knowledge.rename-base":
    case "knowledge.archive-base":
      return normalizeKnowledgeStoreResult(value);
    case "knowledge.readiness":
      return normalizeKnowledgeReadinessResult(value);
    case "knowledge.sources":
      return normalizeKnowledgeSourcesResult(value);
    case "knowledge.duplicates":
      return normalizeKnowledgeDuplicatesResult(value);
    case "knowledge.inventory":
      return normalizeKnowledgeInventoryResult(value);
    case "knowledge.import-file":
      return normalizeKnowledgeFileImportResult(value);
    case "knowledge.select":
      return normalizeKnowledgeSelectionResult(value);
    case "run.status":
    case "run.start":
    case "run.pause":
    case "run.resume":
    case "run.stop":
      return normalizeRunStatus(value);
    case "review.load":
    case "review.dispatch":
      return normalizeReviewState(value);
    case "file.select":
      return normalizeFileResult(value);
    case "source.add-url":
      return normalizeSourceAddUrlResult(value);
    case "export.write":
      return normalizeExportResult(value);
    case "credential.status":
    case "credential.set":
    case "credential.remove":
      return normalizeCredentialResult(value);
    case "models.list":
      return normalizeModelsListResult(value);
    case "models.preview-independence":
      return normalizeModelsPreviewIndependenceResult(value);
  }
}

function normalizeResponse(
  command: BridgeCommand,
  response: BridgeResult<unknown>,
): BridgeResult<unknown> {
  if (!response || typeof response !== "object" || typeof response.ok !== "boolean") {
    return { ok: false, error: bridgeError("operation-failed", command.type) };
  }
  if (!response.ok) {
    return { ok: false, error: safeSerializedBridgeError(response.error, command.type) };
  }
  try {
    return { ok: true, value: normalizeSuccess(command.type, response.value) };
  } catch (error) {
    const normalizedError = safeBridgeError(error, command.type);
    return {
      ok: false,
      error:
        normalizedError.code === "invalid-input"
          ? bridgeError("operation-failed", command.type)
          : normalizedError,
    };
  }
}

export function createCapabilityPort(nativeBridge: NativeBridge): CapabilityPort {
  const capabilities = normalizeCapabilities(nativeBridge.capabilities);
  const capabilitySet = new Set<BridgeCapability>(capabilities);

  return Object.freeze({
    capabilities,
    hasCapability: (capability: BridgeCapability) => capabilitySet.has(capability),
    execute: async <Command extends BridgeCommand>(
      command: Command,
    ): Promise<BridgeResult<BridgeOutput<Command>>> => {
      let normalized: BridgeCommand;
      try {
        normalized = validateBridgeCommand(command);
      } catch (error) {
        return { ok: false, error: safeBridgeError(error) };
      }
      if (!capabilitySet.has(normalized.type)) {
        return unavailableResult(normalized.type) as BridgeResult<BridgeOutput<Command>>;
      }
      try {
        const response = await nativeBridge.invoke(normalized);
        return normalizeResponse(normalized, response) as BridgeResult<BridgeOutput<Command>>;
      } catch (error) {
        return {
          ok: false,
          error: safeBridgeError(error, normalized.type),
        };
      }
    },
  });
}
