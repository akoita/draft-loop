import type {
  EvidenceRetrievalInspection,
  IndependentReviewRecord,
  ScoredEvidenceChunk,
  WritingPolicy,
  WritingPolicyLineage,
} from "@draft-loop/domain";
import type { RunSnapshot } from "@draft-loop/orchestrator";
import type { OutputFormat } from "@draft-loop/rendering";
import type { OpportunityBriefVersionRecord } from "@draft-loop/storage";
import type { OpportunityDraftPatch, OpportunitySourceInput } from "./opportunity-intake.js";

export type {
  EvidenceRetrievalInspection,
  IndependentReviewRecord,
  ScoredEvidenceChunk,
  WritingPolicy,
  WritingPolicyLineage,
};

export interface ApplicationIo {
  readonly write: (line: string) => void;
}

export interface InitializeWorkspaceCommand {
  readonly root: string;
  readonly jobDescription: string;
  readonly sources: string;
  readonly language?: string;
  readonly instructions?: string;
  readonly truthfulnessPolicy?: string;
  readonly authorCompany?: string;
  readonly authorModel?: string;
  readonly criticCompany?: string;
  readonly criticModel?: string;
  /** The weights the author descends from; derived from company and model id when absent. */
  readonly authorLineage?: string;
  /** The weights the critic descends from; derived from company and model id when absent. */
  readonly criticLineage?: string;
  /** Why one lineage on both sides is acceptable; recorded with every run. */
  readonly independenceOverrideRationale?: string;
  /** Loopback base URL of the local inference server, when a company is `local`. */
  readonly localEndpoint?: string;
  readonly maxRounds?: number;
  readonly maxCostUsd?: number;
  readonly maxDurationMs?: number;
  readonly maxWords?: number;
  readonly maxCharacters?: number;
  readonly requiredSections?: readonly string[];
  readonly fixtureMode?: boolean;
}

/**
 * The models an existing workspace should use from its next run onward.
 *
 * Unlike `InitializeWorkspaceCommand` the pairing fields are required, because
 * the configuration is replaced whole rather than merged: an omitted lineage or
 * rationale means "this pairing has none", never "keep whatever the last
 * pairing had". A rationale justifies one specific pairing, so carrying one
 * across a change of models would record a justification nobody gave.
 */
export interface ReconfigureWorkspaceModelsCommand {
  readonly root: string;
  readonly authorCompany: string;
  readonly authorModel: string;
  readonly criticCompany: string;
  readonly criticModel: string;
  /** The weights the author descends from; derived from company and model id when absent. */
  readonly authorLineage?: string;
  /** The weights the critic descends from; derived from company and model id when absent. */
  readonly criticLineage?: string;
  /** Why one lineage on both sides is acceptable for this new pairing. */
  readonly independenceOverrideRationale?: string;
  /** Loopback base URL of the local inference server, when a company is `local`. */
  readonly localEndpoint?: string;
}

export interface ConfigureWritingPolicyCommand {
  readonly root: string;
  /** Local Markdown or text file deliberately selected by the candidate. */
  readonly sourcePath: string;
  /** Import without changing the managed file or active workspace policy. */
  readonly activate?: boolean;
}

/** Safe identity and lineage metadata for one immutable writing-policy version. */
export interface WritingPolicyVersionMetadata {
  readonly checksum: string;
  readonly version: string;
  readonly schemaVersion: number;
  readonly createdAt: string;
  readonly priorChecksum: string | null;
}

/** A policy version with content only when an exact local read requested it. */
export interface WritingPolicyVersionView extends WritingPolicyVersionMetadata {
  readonly policy?: WritingPolicy;
}

export interface GetWritingPolicyCommand {
  readonly root: string;
  /** Omit to read the current leaf; supply an exact lowercase SHA-256 checksum otherwise. */
  readonly checksum?: string;
  /** Exact local reads may request policy content; metadata reads never include it. */
  readonly includeContent?: boolean;
}

export interface ListWritingPolicyVersionsCommand {
  readonly root: string;
  /** History is metadata-only unless an explicit local content read is requested. */
  readonly includeContent?: boolean;
}

export interface ReadRunWritingPolicyCommand {
  readonly root: string;
  readonly runId?: string;
}

export interface RunWritingPolicyProjection {
  readonly effective: WritingPolicyVersionMetadata;
  readonly lineage: WritingPolicyLineage;
  readonly base?: WritingPolicyVersionMetadata;
  readonly override?: WritingPolicyVersionMetadata;
}

export interface ConfigureKnowledgeSelectionEntry {
  /** Local candidate-knowledge store root; retained only in local workspace configuration. */
  readonly storeRoot: string;
  /** Pinned opaque store identity, checked again whenever a run is created. */
  readonly storeId: string;
  /** Pinned candidate knowledge base identity within the store. */
  readonly knowledgeBaseId: string;
}

export interface ConfigureKnowledgeSelectionCommand {
  readonly root: string;
  readonly entries: readonly ConfigureKnowledgeSelectionEntry[];
  /** Required when selecting more than one logical store/base pair. */
  readonly combinationApproved?: boolean;
}

export interface WorkspaceDescriptor {
  readonly id: string;
  readonly root: string;
  readonly jobDescriptionPath: string;
  readonly sourceDirectory: string;
  /** Workspace-relative policy path. Policy text is never candidate evidence. */
  readonly writingPolicyPath?: string;
  /** Active policy identity; policy content is intentionally not exposed here. */
  readonly activeWritingPolicy?: WritingPolicyVersionMetadata;
  /** Flat aliases for adapters that only need the active identity fields. */
  readonly writingPolicyChecksum?: string;
  readonly writingPolicyVersion?: string;
  readonly language: string;
  readonly outputFormat: "markdown";
  readonly requiredSections: readonly string[];
  readonly maxRounds: number;
  readonly maxCostUsd?: number;
  readonly maxDurationMs?: number;
  readonly maxWords?: number;
  readonly maxCharacters?: number;
  readonly author: { readonly company: string; readonly model: string };
  readonly critic: { readonly company: string; readonly model: string };
  /** Where a `local` company sends material; absent when no local endpoint is configured. */
  readonly localEndpoint?: string;
  readonly fixtureMode: boolean;
  readonly latestRunId?: string;
  /** Safe summary of the configured candidate-knowledge selection; roots stay local-only. */
  readonly candidateKnowledgeSelection?: readonly {
    readonly storeId: string;
    readonly knowledgeBaseId: string;
  }[];
}

export interface StartRunCommand {
  readonly root: string;
  readonly allowProviderData?: boolean;
  /** Exact immutable reviewed opportunity version to bind to the new run. */
  readonly opportunityBrief?: OpportunityBriefSelection;
  /** Exact immutable policy history version for a reviewed opportunity override. */
  readonly writingPolicyOverrideChecksum?: string;
}

export type BeginRunCommand = StartRunCommand;

export interface OpportunityBriefSelection {
  readonly briefId: string;
  readonly version: number;
}

export interface ResumeRunCommand {
  readonly root: string;
  readonly runId?: string;
  readonly allowProviderData?: boolean;
  readonly signal?: AbortSignal;
}

export type LifecycleAction =
  | "pause"
  | "stop"
  | "approve"
  | "revision"
  | "recover-review"
  | "recover-round-budget";

export interface LifecycleCommand {
  readonly root: string;
  readonly action: LifecycleAction;
  readonly runId?: string;
}

export interface StatusCommand {
  readonly root: string;
  readonly runId?: string;
}

export interface CreateOpportunityCommand {
  readonly root: string;
  readonly id?: string;
  readonly sources: readonly OpportunitySourceInput[];
  readonly allowProviderData?: boolean;
  readonly createdAt?: string;
}

export interface GetOpportunityCommand {
  readonly root: string;
  readonly briefId: string;
  /** Omit to load the latest persisted version. */
  readonly version?: number;
}

export interface ListOpportunityVersionsCommand {
  readonly root: string;
  readonly briefId: string;
}

export interface EditOpportunityCommand {
  readonly root: string;
  readonly briefId: string;
  readonly expectedVersion: number;
  readonly patch: OpportunityDraftPatch;
  readonly createdAt?: string;
}

export interface ReviewOpportunityCommand {
  readonly root: string;
  readonly briefId: string;
  readonly expectedVersion: number;
  readonly reviewedAt?: string;
}

export interface ExportCommand {
  readonly root: string;
  readonly runId?: string;
  readonly outputPath?: string;
  readonly format?: OutputFormat;
}

export interface LatestExportPathCommand {
  readonly root: string;
  readonly runId: string;
  readonly format: OutputFormat;
}

export interface QueryEvidenceCommand {
  readonly root: string;
  readonly query: string;
  readonly limit?: number;
}

export type FindingDecision = "pending" | "accepted" | "rejected" | "deferred" | "overridden";

export type RecordReviewDecisionCommand =
  | {
      readonly root: string;
      readonly runId: string;
      readonly kind: "finding";
      readonly targetId: string;
      readonly decision: FindingDecision;
      readonly rationale?: string;
    }
  | {
      readonly root: string;
      readonly runId: string;
      readonly kind: "edit";
      readonly targetId: string;
      readonly replacementText: string;
    };

export interface ApplicationDriver {
  readonly initialize: (
    command: InitializeWorkspaceCommand,
    io?: ApplicationIo,
  ) => Promise<WorkspaceDescriptor>;
  readonly readWorkspace: (root: string) => Promise<WorkspaceDescriptor>;
  /**
   * Replace the models an existing workspace will use from its next run.
   *
   * Runs already recorded keep the pairing they ran with; only run creation
   * reads this, and it reads the configuration afresh. Refused while a run is
   * executing, because changing the pairing under a run in flight would make
   * the run's own record of what it used untrue.
   */
  readonly reconfigureModels: (
    command: ReconfigureWorkspaceModelsCommand,
    io?: ApplicationIo,
  ) => Promise<WorkspaceDescriptor>;
  /** Import and activate an explicitly selected local writing-policy file. */
  readonly configureWritingPolicy: (
    command: ConfigureWritingPolicyCommand,
    io?: ApplicationIo,
  ) => Promise<WorkspaceDescriptor>;
  readonly getWritingPolicy?: (
    command: GetWritingPolicyCommand,
  ) => Promise<WritingPolicyVersionView | undefined>;
  readonly listWritingPolicyVersions?: (
    command: ListWritingPolicyVersionsCommand,
  ) => Promise<readonly WritingPolicyVersionView[]>;
  /** Validate and persist an explicit local candidate-knowledge selection. */
  readonly configureKnowledgeSelection: (
    command: ConfigureKnowledgeSelectionCommand,
    io?: ApplicationIo,
  ) => Promise<WorkspaceDescriptor>;
  /** Persist the run and its context without starting provider execution. */
  readonly begin: (command: BeginRunCommand, io?: ApplicationIo) => Promise<RunSnapshot>;
  readonly start: (command: StartRunCommand, io?: ApplicationIo) => Promise<RunSnapshot>;
  readonly resume: (command: ResumeRunCommand, io?: ApplicationIo) => Promise<RunSnapshot>;
  readonly lifecycle: (command: LifecycleCommand, io?: ApplicationIo) => Promise<RunSnapshot>;
  readonly status: (command: StatusCommand, io?: ApplicationIo) => Promise<RunSnapshot | undefined>;
  readonly createOpportunity: (
    command: CreateOpportunityCommand,
  ) => Promise<OpportunityBriefVersionRecord>;
  readonly getOpportunity: (
    command: GetOpportunityCommand,
  ) => Promise<OpportunityBriefVersionRecord | undefined>;
  readonly listOpportunityVersions: (
    command: ListOpportunityVersionsCommand,
  ) => Promise<readonly OpportunityBriefVersionRecord[]>;
  readonly editOpportunity: (
    command: EditOpportunityCommand,
  ) => Promise<OpportunityBriefVersionRecord>;
  readonly reviewOpportunity: (
    command: ReviewOpportunityCommand,
  ) => Promise<OpportunityBriefVersionRecord>;
  readonly export: (command: ExportCommand, io?: ApplicationIo) => Promise<string>;
  readonly latestExportPath: (command: LatestExportPathCommand) => Promise<string | null>;
  readonly queryEvidence: (
    command: QueryEvidenceCommand,
    io?: ApplicationIo,
  ) => Promise<readonly ScoredEvidenceChunk[]>;
  readonly inspectEvidenceRetrieval: (
    command: QueryEvidenceCommand,
    io?: ApplicationIo,
  ) => Promise<EvidenceRetrievalInspection>;
  readonly recordReviewDecision: (command: RecordReviewDecisionCommand) => Promise<void>;
  /**
   * What independence a run recorded when it was configured.
   *
   * Separate from `status` because it is read from the run's context snapshot
   * rather than from the run itself, and because a reader must be able to ask
   * without driving the run. Resolves to `undefined` when the workspace has no
   * run, the run is unknown, or the run predates independence being recorded:
   * an approval surface has to be able to say "not recorded" rather than fail.
   */
  readonly readIndependentReview: (
    command: StatusCommand,
  ) => Promise<IndependentReviewRecord | undefined>;
  readonly readRunWritingPolicy?: (
    command: ReadRunWritingPolicyCommand,
  ) => Promise<RunWritingPolicyProjection | undefined>;
}

export interface ApplicationService extends ApplicationDriver {}

const defaultIo: ApplicationIo = { write: () => undefined };

function requireRoot(root: string): string {
  if (root.trim() === "") throw new Error("Application workspace root is required.");
  return root;
}

function normalizeIo(io: ApplicationIo | undefined): ApplicationIo {
  return io ?? defaultIo;
}

/**
 * Creates the adapter-neutral application boundary shared by CLI and desktop.
 * Drivers own filesystem, storage, provider, and native-runtime details.
 */
export function createApplicationService(driver: ApplicationDriver): ApplicationService {
  const service: ApplicationService = {
    initialize: async (command, io) =>
      driver.initialize({ ...command, root: requireRoot(command.root) }, normalizeIo(io)),
    readWorkspace: async (root) => driver.readWorkspace(requireRoot(root)),
    reconfigureModels: async (command, io) =>
      driver.reconfigureModels({ ...command, root: requireRoot(command.root) }, normalizeIo(io)),
    configureWritingPolicy: async (command, io) =>
      driver.configureWritingPolicy(
        { ...command, root: requireRoot(command.root) },
        normalizeIo(io),
      ),
    getWritingPolicy: async (command) =>
      driver.getWritingPolicy === undefined
        ? undefined
        : driver.getWritingPolicy({ ...command, root: requireRoot(command.root) }),
    listWritingPolicyVersions: async (command) =>
      driver.listWritingPolicyVersions === undefined
        ? []
        : driver.listWritingPolicyVersions({ ...command, root: requireRoot(command.root) }),
    configureKnowledgeSelection: async (command, io) =>
      driver.configureKnowledgeSelection(
        { ...command, root: requireRoot(command.root) },
        normalizeIo(io),
      ),
    begin: async (command, io) =>
      driver.begin({ ...command, root: requireRoot(command.root) }, normalizeIo(io)),
    start: async (command, io) =>
      driver.start({ ...command, root: requireRoot(command.root) }, normalizeIo(io)),
    resume: async (command, io) =>
      driver.resume({ ...command, root: requireRoot(command.root) }, normalizeIo(io)),
    lifecycle: async (command, io) =>
      driver.lifecycle({ ...command, root: requireRoot(command.root) }, normalizeIo(io)),
    status: async (command, io) =>
      driver.status({ ...command, root: requireRoot(command.root) }, normalizeIo(io)),
    createOpportunity: async (command) =>
      driver.createOpportunity({ ...command, root: requireRoot(command.root) }),
    getOpportunity: async (command) =>
      driver.getOpportunity({ ...command, root: requireRoot(command.root) }),
    listOpportunityVersions: async (command) =>
      driver.listOpportunityVersions({ ...command, root: requireRoot(command.root) }),
    editOpportunity: async (command) =>
      driver.editOpportunity({ ...command, root: requireRoot(command.root) }),
    reviewOpportunity: async (command) =>
      driver.reviewOpportunity({ ...command, root: requireRoot(command.root) }),
    export: async (command, io) =>
      driver.export({ ...command, root: requireRoot(command.root) }, normalizeIo(io)),
    latestExportPath: async (command) =>
      driver.latestExportPath({ ...command, root: requireRoot(command.root) }),
    queryEvidence: async (command, io) =>
      driver.queryEvidence({ ...command, root: requireRoot(command.root) }, normalizeIo(io)),
    inspectEvidenceRetrieval: async (command, io) =>
      driver.inspectEvidenceRetrieval(
        { ...command, root: requireRoot(command.root) },
        normalizeIo(io),
      ),
    recordReviewDecision: async (command) =>
      driver.recordReviewDecision({ ...command, root: requireRoot(command.root) }),
    readIndependentReview: async (command) =>
      driver.readIndependentReview({ ...command, root: requireRoot(command.root) }),
    readRunWritingPolicy: async (command) =>
      driver.readRunWritingPolicy === undefined
        ? undefined
        : driver.readRunWritingPolicy({ ...command, root: requireRoot(command.root) }),
  };
  return Object.freeze(service);
}

export * from "./knowledge-base.js";
export * from "./local.js";
export * from "./local-endpoint.js";
export * from "./opportunity-brief.js";
export * from "./opportunity-extraction.js";
export * from "./opportunity-intake.js";
export * from "./opportunity-persistence.js";
