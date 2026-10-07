import type { Command } from "commander";
import type { EmbeddingModelServiceFactory } from "./embedding-model-commands.js";
import {
  type ApplicationIo,
  CliUserError,
  defaultEmbeddingModelRoot,
  type EmbeddingModelState,
  type EmbeddingModelTier,
  embeddingModelTiers,
  parseRetrievalMode,
  type RetrievalMode,
  retrievalModes,
  type WorkspaceRetrievalModeRecord,
  type WorkspaceRetrievalModeService,
  workspaceRoot,
} from "./workflow.js";

interface RetrievalModeOptions {
  readonly tier?: string;
  readonly modelDir?: string;
  readonly json?: boolean;
}

function parseTier(value: string): EmbeddingModelTier {
  const tier = embeddingModelTiers.find((candidate) => candidate === value);
  if (tier === undefined) {
    throw new CliUserError(`--tier must be one of: ${embeddingModelTiers.join(", ")}.`);
  }
  return tier;
}

function describeMode(mode: RetrievalMode): string {
  switch (mode) {
    case "lexical":
      return "keyword retrieval only";
    case "semantic":
      return "retrieval by meaning with the local embedding model";
    case "hybrid":
      return "keyword and semantic retrieval fused";
  }
}

function writeMode(
  io: ApplicationIo,
  record: WorkspaceRetrievalModeRecord,
  changed: boolean,
  modelState: EmbeddingModelState | undefined,
): void {
  io.write(`retrieval mode: ${record.mode}${changed ? " (saved)" : ""}`);
  io.write(`  searches: ${describeMode(record.mode)}`);
  io.write(`  model tier: ${record.modelTier}`);
  if (record.updatedAt === undefined) io.write("  default: no setting saved");
  if (modelState !== undefined) {
    io.write(`  local model ${record.modelTier}: ${modelState}`);
    if (modelState !== "ready") {
      io.write(
        `Run "draft-loop embeddings install --tier ${record.modelTier}" to install the local model; until then runs use lexical retrieval.`,
      );
    }
  }
}

/**
 * Registers `retrieval mode` on the root command. The setting applies to runs that start or resume
 * after it is saved. Saving it never starts a run, downloads a model, or makes a network request;
 * the model state comes from a local status check only.
 */
export function registerRetrievalModeCommands(
  root: Command,
  service: WorkspaceRetrievalModeService,
  createEmbeddingService: EmbeddingModelServiceFactory,
  io: ApplicationIo,
): void {
  const retrieval = root
    .command("retrieval")
    .description("Choose how a run searches career evidence");

  retrieval
    .command("mode")
    .description(
      `Show or set the workspace retrieval mode (${retrievalModes.join(", ")}); default lexical`,
    )
    .argument("<workspace>", "workspace directory")
    .argument("[mode]", `new mode: ${retrievalModes.join(", ")}; omit to show the current mode`)
    .option(
      "--tier <tier>",
      `embedding model size for semantic and hybrid: ${embeddingModelTiers.join(" or ")} (default: keep the saved tier)`,
    )
    .option(
      "--model-dir <path>",
      "model directory (default: per-user data directory, or DRAFT_LOOP_EMBEDDING_MODEL_ROOT)",
    )
    .option("--json", "print machine-readable JSON")
    .action(async (workspace: string, mode: string | undefined, options: RetrievalModeOptions) => {
      const requested = mode === undefined ? undefined : parseRetrievalMode(mode);
      const requestedTier = options.tier === undefined ? undefined : parseTier(options.tier);
      if (requested === undefined && requestedTier !== undefined) {
        throw new CliUserError("--tier can only be used together with a retrieval mode.");
      }
      const command = { root: workspaceRoot(workspace) };
      let record: WorkspaceRetrievalModeRecord;
      if (requested === undefined) {
        record = await service.get(command);
      } else {
        const modelTier = requestedTier ?? (await service.get(command)).modelTier;
        record = await service.set({ ...command, mode: requested, modelTier });
      }
      const modelState =
        requested === undefined || requested === "lexical"
          ? undefined
          : (
              await createEmbeddingService(options.modelDir ?? defaultEmbeddingModelRoot()).status(
                record.modelTier,
              )
            ).state;
      if (options.json === true) {
        io.write(JSON.stringify(modelState === undefined ? record : { ...record, modelState }));
      } else {
        writeMode(io, record, requested !== undefined, modelState);
      }
    });
}
