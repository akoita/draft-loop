import type { Command } from "commander";
import { resolveModelProfileSelection } from "./model-profile-selection.js";
import {
  type ApplicationIo,
  describeModelProfileReferences,
  type WorkspaceModelProfileSelection,
  type WorkspaceModelProfileSelectionService,
  workspaceRoot,
} from "./workflow.js";

interface SelectionOptions {
  readonly json?: boolean;
  readonly modelPreset?: string;
  readonly authorProfile?: string;
  readonly criticProfile?: string;
}

function writeSelection(
  io: ApplicationIo,
  selection: WorkspaceModelProfileSelection | undefined,
  saved: boolean,
): void {
  if (selection === undefined) {
    io.write(
      "model profiles: none applied (new runs use the legacy path: provider-default runtime controls, unknown context windows)",
    );
    return;
  }
  io.write(
    `model profiles: ${describeModelProfileReferences(selection.modelProfiles)}${saved ? " (saved)" : ""}`,
  );
  io.write(`  applied: ${selection.appliedAt}`);
  io.write("  used by: new runs that name no profiles of their own");
}

/**
 * Registers `applied`, `apply` and `clear` under `model-profiles`. They show, save and remove the
 * workspace's applied profile pair; they never start a run or call a provider.
 */
export function registerModelProfileSelectionCommands(
  modelProfiles: Command,
  service: WorkspaceModelProfileSelectionService,
  io: ApplicationIo,
): void {
  modelProfiles
    .command("applied")
    .description("Show the model profile pair applied to a workspace for new runs")
    .argument("<workspace>", "workspace directory")
    .option("--json", "print machine-readable JSON")
    .action(async (workspace: string, options: SelectionOptions) => {
      const selection = await service.get({ root: workspaceRoot(workspace) });
      if (options.json === true) io.write(JSON.stringify(selection ?? null));
      else writeSelection(io, selection, false);
    });

  modelProfiles
    .command("apply")
    .description(
      "Apply an exact author and critic profile pair to a workspace; new runs that name no profiles use it",
    )
    .argument("<workspace>", "workspace directory")
    .option("--model-preset <id>", "exact pair preset to apply")
    .option("--author-profile <id@version>", "exact registered author profile version")
    .option("--critic-profile <id@version>", "exact registered critic profile version")
    .option("--json", "print machine-readable JSON")
    .addHelpText(
      "after",
      "\nUse one --model-preset or both explicit profile options. The pair must match the workspace's configured author and critic company and model. A run started with its own profile options still uses those. Resume keeps the profiles recorded in the run.\n",
    )
    .action(async (workspace: string, options: SelectionOptions) => {
      const references = resolveModelProfileSelection({
        modelPreset: options.modelPreset,
        authorProfile: options.authorProfile,
        criticProfile: options.criticProfile,
      });
      if (references === undefined) {
        throw new Error(
          "Choose one model preset or provide both --author-profile and --critic-profile.",
        );
      }
      const selection = await service.save({
        root: workspaceRoot(workspace),
        modelProfiles: references,
      });
      if (options.json === true) io.write(JSON.stringify(selection));
      else writeSelection(io, selection, true);
    });

  modelProfiles
    .command("clear")
    .description("Remove the applied model profile pair; new runs use the legacy path")
    .argument("<workspace>", "workspace directory")
    .action(async (workspace: string) => {
      const cleared = await service.clear({ root: workspaceRoot(workspace) });
      io.write(
        cleared
          ? "model profiles: cleared (new runs use the legacy path: provider-default runtime controls, unknown context windows)"
          : "model profiles: none were applied",
      );
    });
}
