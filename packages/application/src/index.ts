import type { EvidenceRetrievalInspection, ScoredEvidenceChunk } from "@draft-loop/domain";
import type { RunSnapshot } from "@draft-loop/orchestrator";
import type { OutputFormat } from "@draft-loop/rendering";

export type { EvidenceRetrievalInspection, ScoredEvidenceChunk };

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
  readonly maxRounds?: number;
  readonly maxCostUsd?: number;
  readonly maxDurationMs?: number;
  readonly maxWords?: number;
  readonly maxCharacters?: number;
  readonly requiredSections?: readonly string[];
  readonly fixtureMode?: boolean;
}

export interface WorkspaceDescriptor {
  readonly id: string;
  readonly root: string;
  readonly jobDescriptionPath: string;
  readonly sourceDirectory: string;
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
  readonly fixtureMode: boolean;
  readonly latestRunId?: string;
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

export type LifecycleAction = "pause" | "stop" | "approve" | "revision" | "recover-review";

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
  };
  return Object.freeze(service);
}

export * from "./local.js";
