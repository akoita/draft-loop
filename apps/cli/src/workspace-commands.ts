import type { Command } from "commander";
import {
  type ApplicationIo,
  type ApplicationService,
  CliUserError,
  workspaceRoot,
} from "./workflow.js";

interface CompactOptions {
  readonly yes?: boolean;
  readonly json?: boolean;
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Registers `workspace compact`, which shrinks a workspace's run history behind a verified backup.
 * It changes the workspace's history file, so it runs only with `--yes`.
 */
export function registerWorkspaceCommands(
  root: Command,
  service: ApplicationService,
  io: ApplicationIo,
): void {
  const workspace = root.command("workspace").description("Maintain a workspace's local files");

  workspace
    .command("compact")
    .description(
      "Shrink the run history: legacy full snapshots become slim ones and the audit chain is rebuilt. A verified backup of the old history is kept beside it",
    )
    .argument("[workspace]", "workspace directory", ".")
    .option("--yes", "confirm: replace the run history with the compacted one, keeping a backup")
    .option("--json", "print machine-readable JSON")
    .action(async (directory: string, options: CompactOptions) => {
      if (options.yes !== true) {
        throw new CliUserError(
          "Compacting rewrites the run history file and keeps a backup of the old one beside it. Run again with --yes to confirm.",
        );
      }
      if (service.compactHistory === undefined) {
        throw new CliUserError("This application service cannot compact run history.");
      }
      const result = await service.compactHistory({ root: workspaceRoot(directory) });
      if (options.json === true) {
        io.write(JSON.stringify(result));
        return;
      }
      io.write(
        `run history compacted: ${megabytes(result.beforeBytes)} before, ${megabytes(result.afterBytes)} after`,
      );
      io.write(`backup kept: ${result.backupFileName} (in the workspace's .draft-loop folder)`);
      io.write(`${result.runsVerified} runs were checked to read back the same.`);
    });
}
