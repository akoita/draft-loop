import {
  createEmbeddingModelService,
  defaultEmbeddingModelRoot,
  type EmbeddingModelInstallPlan,
  type EmbeddingModelService,
  type EmbeddingModelStatus,
  type WorkspaceRetrievalModeRecord,
  type WorkspaceRetrievalModeService,
  workspaceRetrievalModeService,
} from "@draft-loop/application";

import type {
  EmbeddingModelCancelResult,
  EmbeddingModelPlanResult,
  EmbeddingModelProgressResult,
  EmbeddingModelStatusResult,
  EmbeddingModelTierInput,
  WorkspaceRetrievalModeResult,
} from "../bridge.js";
import {
  type EmbeddingModelTier,
  embeddingModelInstallCancelledMessage,
} from "../semantic-retrieval-contract.js";

const modelRootEnvironmentVariable = "DRAFT_LOOP_EMBEDDING_MODEL_ROOT";

/**
 * Points runs started from the desktop at the model directory the desktop installs into.
 *
 * The desktop uses the same per-user default as the CLI (`defaultEmbeddingModelRoot`), so a
 * model installed from either is found by both. An explicit `DRAFT_LOOP_EMBEDDING_MODEL_ROOT` is
 * the person's own choice and is preserved. The renderer never receives this path.
 */
export function applyDesktopEmbeddingModelRoot(
  env: Record<string, string | undefined>,
  platform: { readonly platform?: string; readonly homedir?: string } = {},
): void {
  const current = env[modelRootEnvironmentVariable];
  if (current !== undefined && current !== "") return;
  env[modelRootEnvironmentVariable] = defaultEmbeddingModelRoot({ env, ...platform });
}

type HostFailure = (code: "operation-failed" | "not-found", message: string) => never;

export interface SemanticRetrievalHostOptions {
  readonly embeddingModelService?: EmbeddingModelService;
  readonly retrievalModeService?: WorkspaceRetrievalModeService;
  /** Resolves the open workspace for an id, or fails with the host's `not-found` error. */
  readonly workspaceFor: (id: string) => {
    readonly root: string;
    readonly descriptor: { readonly id: string };
  };
  readonly fail: HostFailure;
}

interface ActiveInstall {
  readonly controller: AbortController;
  readonly totalBytes: number;
  readonly receivedByFile: Map<string, number>;
}

export interface SemanticRetrievalHost {
  readonly status: (input: EmbeddingModelTierInput) => Promise<EmbeddingModelStatusResult>;
  readonly planInstall: (input: EmbeddingModelTierInput) => EmbeddingModelPlanResult;
  readonly install: (input: EmbeddingModelTierInput) => Promise<EmbeddingModelStatusResult>;
  readonly progress: (input: EmbeddingModelTierInput) => EmbeddingModelProgressResult;
  readonly cancel: (input: EmbeddingModelTierInput) => EmbeddingModelCancelResult;
  readonly remove: (input: EmbeddingModelTierInput) => Promise<EmbeddingModelStatusResult>;
  readonly getRetrievalMode: (input: {
    readonly workspaceId: string;
  }) => Promise<WorkspaceRetrievalModeResult>;
  readonly setRetrievalMode: (input: {
    readonly workspaceId: string;
    readonly mode: WorkspaceRetrievalModeRecord["mode"];
    readonly modelTier: EmbeddingModelTier;
  }) => Promise<WorkspaceRetrievalModeResult>;
}

function projectStatus(status: EmbeddingModelStatus): EmbeddingModelStatusResult {
  // The model directory is deliberately dropped: the renderer never sees a local path.
  return {
    tier: status.tier,
    state: status.state,
    modelId: status.modelId,
    revision: status.revision,
    license: status.license,
    totalSizeBytes: status.totalSizeBytes,
    sourceUrl: status.sourceUrl,
  };
}

function projectPlan(plan: EmbeddingModelInstallPlan): EmbeddingModelPlanResult {
  return {
    tier: plan.tier,
    modelId: plan.modelId,
    revision: plan.revision,
    license: plan.license,
    sourceUrl: plan.sourceUrl,
    files: plan.files.map((file) => ({ path: file.path, sizeBytes: file.sizeBytes })),
    totalSizeBytes: plan.totalSizeBytes,
  };
}

/** Host side of the embedding-model and retrieval-mode commands; one install runs per tier. */
export function createSemanticRetrievalHost(
  options: SemanticRetrievalHostOptions,
): SemanticRetrievalHost {
  const { fail, workspaceFor } = options;
  const retrievalModes = options.retrievalModeService ?? workspaceRetrievalModeService;
  // Created on first use so the model root is read after the main process has set it.
  let modelService: EmbeddingModelService | undefined = options.embeddingModelService;
  const models = (): EmbeddingModelService => {
    modelService ??= createEmbeddingModelService({ modelRoot: defaultEmbeddingModelRoot() });
    return modelService;
  };
  const activeInstalls = new Map<EmbeddingModelTier, ActiveInstall>();

  return {
    status: async ({ tier }) => projectStatus(await models().status(tier)),
    planInstall: ({ tier }) => projectPlan(models().planInstall(tier)),
    install: async ({ tier }) => {
      if (activeInstalls.has(tier)) {
        return fail("operation-failed", "This model is already downloading.");
      }
      const plan = models().planInstall(tier);
      const entry: ActiveInstall = {
        controller: new AbortController(),
        totalBytes: plan.totalSizeBytes,
        receivedByFile: new Map(),
      };
      activeInstalls.set(tier, entry);
      try {
        const installed = await models().install(tier, {
          signal: entry.controller.signal,
          onProgress: (progress) => {
            entry.receivedByFile.set(progress.file, progress.receivedBytes);
          },
        });
        return projectStatus(installed);
      } catch (error) {
        // A cancelled install keeps nothing, whatever shape the abort took on its way up.
        if (entry.controller.signal.aborted) {
          return fail("operation-failed", embeddingModelInstallCancelledMessage);
        }
        throw error;
      } finally {
        activeInstalls.delete(tier);
      }
    },
    progress: ({ tier }) => {
      const entry = activeInstalls.get(tier);
      if (entry === undefined) return { active: false };
      if (entry.receivedByFile.size === 0 || entry.totalBytes < 1) return { active: true };
      let received = 0;
      for (const bytes of entry.receivedByFile.values()) received += bytes;
      return {
        active: true,
        receivedBytes: Math.min(received, entry.totalBytes),
        totalBytes: entry.totalBytes,
      };
    },
    cancel: ({ tier }) => {
      const entry = activeInstalls.get(tier);
      if (entry === undefined || entry.controller.signal.aborted) return { cancelled: false };
      entry.controller.abort();
      return { cancelled: true };
    },
    remove: async ({ tier }) => {
      if (activeInstalls.has(tier)) {
        return fail("operation-failed", "Cancel the download before removing this model.");
      }
      return projectStatus(await models().remove(tier));
    },
    getRetrievalMode: async ({ workspaceId }) => {
      const workspace = workspaceFor(workspaceId);
      const record = await retrievalModes.get({ root: workspace.root });
      return projectRecord(workspace.descriptor.id, record);
    },
    setRetrievalMode: async ({ workspaceId, mode, modelTier }) => {
      const workspace = workspaceFor(workspaceId);
      const record = await retrievalModes.set({ root: workspace.root, mode, modelTier });
      return projectRecord(workspace.descriptor.id, record);
    },
  };
}

function projectRecord(
  workspaceId: string,
  record: WorkspaceRetrievalModeRecord,
): WorkspaceRetrievalModeResult {
  return {
    workspaceId,
    mode: record.mode,
    modelTier: record.modelTier,
    ...(record.updatedAt === undefined ? {} : { updatedAt: record.updatedAt }),
  };
}
