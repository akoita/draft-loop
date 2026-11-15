import {
  createPreferenceSuggestions,
  type PreferenceSuggestion,
  type PreferenceSuggestions,
} from "@draft-loop/application/preference-suggestions";
import type { Command } from "commander";

import { type ApplicationIo, type ApplicationService, workspaceRoot } from "./workflow.js";

function describe(suggestion: PreferenceSuggestion): string {
  return suggestion.kind === "forbidden-term"
    ? `forbid the word "${suggestion.term}"`
    : `order sections as ${suggestion.sectionOrder.join(", ")}`;
}

/**
 * Registers `preferences list|accept|dismiss|sources` (#2253, #2384): writing preferences suggested from the
 * person's own review choices. DraftLoop suggests; the person decides. Accepting saves a new
 * writing-policy version; dismissing means it is never offered again. No model is called.
 */
export function registerPreferenceCommands(
  root: Command,
  service: ApplicationService,
  io: ApplicationIo,
  suggestions: PreferenceSuggestions = createPreferenceSuggestions({ service }),
): void {
  const preferences = root
    .command("preferences")
    .description("Review writing preferences suggested from your review choices");

  preferences
    .command("list")
    .description("List suggested writing preferences; nothing changes until you accept one")
    .argument("<workspace>", "workspace directory")
    .option("--json", "print machine-readable JSON")
    .action(async (workspace: string, options: { readonly json?: boolean }) => {
      const listed = await suggestions.list(workspaceRoot(workspace));
      if (options.json === true) {
        io.write(JSON.stringify(listed));
        return;
      }
      if (listed.length === 0) {
        io.write("No suggested preferences. DraftLoop suggests one when a review pattern repeats.");
        return;
      }
      for (const suggestion of listed) {
        io.write(`${suggestion.id}: ${describe(suggestion)}`);
        io.write(`  why: ${suggestion.reason}`);
        io.write(`  from runs: ${suggestion.runIds.join(", ")}`);
      }
      io.write('Accept one with "draft-loop preferences accept <workspace> <id>".');
    });

  preferences
    .command("accept")
    .description("Add a suggested preference to the writing policy as a new version")
    .argument("<workspace>", "workspace directory")
    .argument("<id>", "suggestion id from preferences list")
    .action(async (workspace: string, id: string) => {
      const accepted = await suggestions.accept(workspaceRoot(workspace), id);
      io.write(`Writing policy updated: ${describe(accepted)}. New runs follow it.`);
    });

  preferences
    .command("dismiss")
    .description("Dismiss a suggested preference so it is never offered again")
    .argument("<workspace>", "workspace directory")
    .argument("<id>", "suggestion id from preferences list")
    .action(async (workspace: string, id: string) => {
      await suggestions.dismiss(workspaceRoot(workspace), id);
      io.write(`Dismissed ${id}. The writing policy is unchanged.`);
    });

  preferences
    .command("sources")
    .description("Show which runs suggested each accepted preference; hand-written rules have none")
    .argument("<workspace>", "workspace directory")
    .option("--json", "print machine-readable JSON")
    .action(async (workspace: string, options: { readonly json?: boolean }) => {
      const sources = await suggestions.sources(workspaceRoot(workspace));
      if (options.json === true) {
        io.write(JSON.stringify(sources));
        return;
      }
      if (sources.length === 0) {
        io.write("No accepted suggestions. Rules you wrote yourself show no source.");
        return;
      }
      for (const source of sources) {
        const runs = source.runIds.length;
        io.write(
          `policy ${source.policyChecksum.slice(0, 12)}: suggested from ${runs} run${runs === 1 ? "" : "s"} (${source.suggestionId}, accepted ${source.acceptedAt})`,
        );
        io.write(`  runs: ${source.runIds.join(", ")}`);
      }
    });
}
