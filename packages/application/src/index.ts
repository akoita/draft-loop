import type {
  EvidenceRetrievalInspection,
  IndependentReviewRecord,
  ScoredEvidenceChunk,
} from "@draft-loop/domain";
import type { RunSnapshot } from "@draft-loop/orchestrator";
import type { OutputFormat } from "@draft-loop/rendering";

export type { EvidenceRetrievalInspection, IndependentReviewRecord, ScoredEvidenceChunk };

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
}

export type BeginRunCommand = StartRunCommand;

export interface ResumeRunCommand extends StartRunCommand {
  readonly runId?: string;
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
  };
  return Object.freeze(service);
}

export * from "./knowledge-base.js";
export * from "./local.js";
export * from "./local-endpoint.js";
export * from "./opportunity-brief.js";
