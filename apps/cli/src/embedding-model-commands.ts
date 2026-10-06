import type { Command } from "commander";
import {
  type ApplicationIo,
  CliUserError,
  defaultEmbeddingModelRoot,
  defaultEmbeddingModelTier,
  type EmbeddingModelService,
  type EmbeddingModelStatus,
  type EmbeddingModelTier,
  embeddingModelTiers,
} from "./workflow.js";

/** Builds the service for one model directory; replaced in tests. */
export type EmbeddingModelServiceFactory = (modelRoot: string) => EmbeddingModelService;

interface TierOptions {
  readonly tier?: string;
  readonly modelDir?: string;
}

function parseTier(value: string | undefined): EmbeddingModelTier {
  if (value === undefined) return defaultEmbeddingModelTier;
  const tier = embeddingModelTiers.find((candidate) => candidate === value);
  if (tier === undefined) {
    throw new CliUserError(`--tier must be one of: ${embeddingModelTiers.join(", ")}.`);
  }
  return tier;
}

function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function writeStatus(io: ApplicationIo, status: EmbeddingModelStatus): void {
  io.write(`embedding model ${status.tier}: ${status.state}`);
  io.write(`  model: ${status.modelId}`);
  io.write(`  revision: ${status.revision}`);
  io.write(`  license: ${status.license}`);
  io.write(`  size: ${megabytes(status.totalSizeBytes)}`);
  io.write(`  source: ${status.sourceUrl}`);
  io.write(`  location: ${status.modelDirectory}`);
}

/**
 * Registers `embeddings status|install|remove` on the root command. Nothing is downloaded unless
 * `install` is run with `--confirm`.
 */
export function registerEmbeddingModelCommands(
  root: Command,
  createService: EmbeddingModelServiceFactory,
  io: ApplicationIo,
): void {
  const embeddings = root
    .command("embeddings")
    .description(
      "Manage the optional local semantic-retrieval embedding model; it is never downloaded implicitly",
    );

  const tierOption = (command: Command): Command =>
    command
      .option(
        "--tier <tier>",
        `model size: ${embeddingModelTiers.join(" or ")} (default ${defaultEmbeddingModelTier})`,
      )
      .option(
        "--model-dir <path>",
        "model directory (default: per-user data directory, or DRAFT_LOOP_EMBEDDING_MODEL_ROOT)",
      );

  const serviceFor = (options: TierOptions): EmbeddingModelService =>
    createService(options.modelDir ?? defaultEmbeddingModelRoot());

  tierOption(
    embeddings
      .command("status")
      .description(
        "Show whether the pinned embedding model is installed; makes no network request",
      ),
  )
    .option("--verify", "re-hash every installed file against its pinned SHA-256 checksum")
    .action(async (options: TierOptions & { verify?: boolean }) => {
      const tier = parseTier(options.tier);
      const status = await serviceFor(options).status(tier, {
        verify: options.verify === true ? "sha256" : "size",
      });
      writeStatus(io, status);
    });

  tierOption(
    embeddings
      .command("install")
      .description(
        "Show what would be downloaded; with --confirm, download (or import with --from) and verify the pinned model",
      ),
  )
    .option("--from <path>", "import the model files from a local directory instead of downloading")
    .option("--confirm", "approve the download and install the model")
    .action(async (options: TierOptions & { from?: string; confirm?: boolean }) => {
      const tier = parseTier(options.tier);
      const service = serviceFor(options);
      const plan = service.planInstall(tier);
      if (options.confirm !== true) {
        io.write(`embedding model ${tier}: install plan`);
        io.write(`  model: ${plan.modelId}`);
        io.write(`  revision: ${plan.revision}`);
        io.write(`  license: ${plan.license}`);
        io.write(
          options.from === undefined
            ? `  source: ${plan.sourceUrl}`
            : "  source: local import directory (--from)",
        );
        for (const file of plan.files)
          io.write(`  file: ${file.path} (${megabytes(file.sizeBytes)})`);
        io.write(`  total size: ${megabytes(plan.totalSizeBytes)}`);
        io.write(`  destination: ${plan.destination}`);
        io.write("Nothing was downloaded. Re-run with --confirm to install the model.");
        return;
      }
      io.write(
        options.from === undefined
          ? `downloading ${megabytes(plan.totalSizeBytes)} from ${plan.sourceUrl}`
          : "importing the model files from the local directory",
      );
      const lastDecile = new Map<string, number>();
      const status = await service.install(tier, {
        ...(options.from === undefined ? {} : { from: options.from }),
        onProgress: ({ file, receivedBytes, totalBytes }) => {
          const decile = totalBytes === 0 ? 10 : Math.floor((receivedBytes * 10) / totalBytes);
          if (decile <= (lastDecile.get(file) ?? -1)) return;
          lastDecile.set(file, decile);
          io.write(`  ${file}: ${decile * 10}%`);
        },
      });
      writeStatus(io, status);
    });

  tierOption(
    embeddings.command("remove").description("Delete the installed embedding model files"),
  ).action(async (options: TierOptions) => {
    const tier = parseTier(options.tier);
    writeStatus(io, await serviceFor(options).remove(tier));
  });
}
