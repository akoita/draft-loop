import { resolve } from "node:path";

import type { ContextSnapshot } from "@draft-loop/domain";
import type {
  OrchestrationEngine,
  RequestAdjudicatedRevisionInput,
  RunSnapshot,
} from "@draft-loop/orchestrator";
import type { ClosableStoragePort } from "@draft-loop/storage";

import type { ApplicationIo, RequestAdjudicatedRevisionCommand } from "./index.js";
import type { WorkspaceConfig } from "./local.js";

/** The local adapter's operations, over whichever store it opens. */
export interface LocalAdjudicatedRevisionDependencies<Storage extends ClosableStoragePort> {
  readonly readWorkspace: (root: string) => Promise<WorkspaceConfig>;
  readonly openStorage: (root: string) => Promise<Storage>;
  readonly contextForRun: (storage: Storage, runId: string) => Promise<ContextSnapshot>;
  readonly assertSelectionStable: (
    root: string,
    historical: ContextSnapshot["candidateKnowledgeSelection"],
  ) => Promise<void>;
  readonly createEngine: (
    storage: Storage,
    config: WorkspaceConfig,
    context: ContextSnapshot,
  ) => OrchestrationEngine;
  readonly saveTypedHistory: (
    storage: Storage,
    config: WorkspaceConfig,
    snapshot: RunSnapshot,
  ) => Promise<void>;
  readonly outputEvents: (
    events: Awaited<ReturnType<OrchestrationEngine["events"]>>,
    io: ApplicationIo,
  ) => void;
  readonly outputSnapshot: (snapshot: RunSnapshot, io: ApplicationIo) => void;
}

const defaultIo: ApplicationIo = { write: () => undefined };

/**
 * Stage one exact, already-adjudicated revision through the local application
 * boundary. The injected engine factory is responsible for selecting noop
 * agents, so this operation cannot create a provider adapter or call a model.
 */
export async function requestLocalAdjudicatedRevision<Storage extends ClosableStoragePort>(
  command: RequestAdjudicatedRevisionCommand,
  dependencies: LocalAdjudicatedRevisionDependencies<Storage>,
  io: ApplicationIo = defaultIo,
): Promise<RunSnapshot> {
  const root = resolve(command.root);
  const config = await dependencies.readWorkspace(root);
  const runId = command.runId ?? config.latestRunId;
  if (runId === undefined) throw new Error("No run is configured. Start a run first.");

  const storage = await dependencies.openStorage(root);
  try {
    const context = await dependencies.contextForRun(storage, runId);
    await dependencies.assertSelectionStable(root, context.candidateKnowledgeSelection);
    const runEngine = dependencies.createEngine(storage, config, context);
    const input: RequestAdjudicatedRevisionInput = {
      report: command.report,
      decisions: command.decisions,
      ...(command.acceptedEffectOverrides === undefined
        ? {}
        : { acceptedEffectOverrides: command.acceptedEffectOverrides }),
    };
    const snapshot = await runEngine.requestAdjudicatedRevision(runId, input);
    await dependencies.saveTypedHistory(storage, config, snapshot);
    dependencies.outputEvents(await runEngine.events(runId), io);
    dependencies.outputSnapshot(snapshot, io);
    return snapshot;
  } finally {
    await storage.close();
  }
}
