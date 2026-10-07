import type { Command } from "commander";
import {
  type ApplicationIo,
  type EvidenceMode,
  evidenceModes,
  parseEvidenceMode,
  type WorkspaceEvidenceModeRecord,
  type WorkspaceEvidenceModeService,
  workspaceRoot,
} from "./workflow.js";

function describeMode(mode: EvidenceMode): string {
  return mode === "full-source"
    ? "every eligible chunk of the selected sources when it fits the budget, else retrieval"
    : "the composed top retrieved excerpts";
}

function writeMode(io: ApplicationIo, record: WorkspaceEvidenceModeRecord, changed: boolean): void {
  io.write(`evidence mode: ${record.mode}${changed ? " (saved)" : ""}`);
  io.write(`  sends: ${describeMode(record.mode)}`);
  if (record.updatedAt === undefined) io.write("  default: no setting saved");
}

/**
 * Registers `evidence mode` on the root command. The setting applies to runs that start or resume
 * after it is saved; it never starts a run or sends anything.
 */
export function registerEvidenceModeCommands(
  root: Command,
  service: WorkspaceEvidenceModeService,
  io: ApplicationIo,
): void {
  const evidence = root
    .command("evidence")
    .description("Choose what career evidence a run's author and critic receive");

  evidence
    .command("mode")
    .description(
      `Show or set the legacy workspace evidence mode (${evidenceModes.join(" or ")}); default retrieval`,
    )
    .argument("<workspace>", "workspace directory")
    .argument("[mode]", `new mode: ${evidenceModes.join(" or ")}; omit to show the current mode`)
    .option("--json", "print machine-readable JSON")
    .action(async (workspace: string, mode: string | undefined, options: { json?: boolean }) => {
      const requested = mode === undefined ? undefined : parseEvidenceMode(mode);
      const command = { root: workspaceRoot(workspace) };
      const record =
        requested === undefined
          ? await service.get(command)
          : await service.set({ ...command, mode: requested });
      if (options.json === true) io.write(JSON.stringify(record));
      else writeMode(io, record, requested !== undefined);
    });
}
