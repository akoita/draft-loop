import type { Command } from "commander";
import {
  type ApplicationIo,
  CliUserError,
  type SourceSensitivityPreview,
  type SourceSensitivityRule,
  type SourceSensitivityRuleMatch,
  type SourceSensitivityRulesView,
  type SourceSensitivityService,
  type SourceSensitivityTier,
  sourceSensitivityTiers,
} from "./workflow.js";

const storeRootArgument = "local candidate-knowledge store directory";
const knowledgeBaseArgument = "opaque knowledge-base id";

function parseTier(value: string): SourceSensitivityTier {
  const tier = sourceSensitivityTiers.find((candidate) => candidate === value);
  if (tier === undefined) {
    throw new CliUserError(`--tier must be one of: ${sourceSensitivityTiers.join(", ")}.`);
  }
  return tier;
}

function describeMatch(match: SourceSensitivityRuleMatch): string {
  return match.kind === "heading-contains"
    ? `heading contains "${match.text}"`
    : `heading path ${match.path.join(" > ")}`;
}

function ruleLine(rule: SourceSensitivityRule): string {
  return `  ${rule.id}  ${rule.tier}  ${describeMatch(rule.match)}`;
}

function writeRules(io: ApplicationIo, view: SourceSensitivityRulesView): void {
  io.write(
    view.version === 0
      ? "sensitivity rules: none saved (every section is normal)"
      : `sensitivity rules version ${view.version} (${view.rules.length} rules, saved ${view.createdAt ?? ""})`,
  );
  for (const rule of view.rules) io.write(ruleLine(rule));
}

function writePreview(io: ApplicationIo, preview: SourceSensitivityPreview): void {
  io.write(
    `source ${preview.sourceId} version ${preview.versionId} (${preview.mediaType}), rules version ${preview.rulesVersion}`,
  );
  if (!preview.sectionedByHeadings) {
    io.write("not Markdown: shown as one root section that no rule can match");
  }
  io.write("index  tier        chars  matched rules  heading path");
  for (const section of preview.sections) {
    const heading = section.headingPath.length === 0 ? "(root)" : section.headingPath.join(" > ");
    io.write(
      `${String(section.index).padEnd(5)}  ${section.tier.padEnd(10)}  ${String(section.characterCount).padStart(5)}  ${(section.matchedRuleIds.join(",") || "-").padEnd(13)}  ${heading}`,
    );
    if (section.text !== undefined) {
      io.write("---");
      io.write(section.text);
      io.write("---");
    }
  }
}

/**
 * Registers `knowledge sensitivity` on the knowledge command. The commands
 * edit and preview rules only; enforcement in provider requests is separate.
 */
export function registerSensitivityCommands(
  knowledge: Command,
  service: SourceSensitivityService,
  io: ApplicationIo,
): void {
  const sensitivity = knowledge
    .command("sensitivity")
    .description(
      "Manage source sensitivity rules (tiers: normal, sensitive, never-share) that classify Markdown sections by heading",
    );

  sensitivity
    .command("list")
    .description("List a knowledge base's current sensitivity rules")
    .argument("<store-root>", storeRootArgument)
    .argument("<knowledge-base-id>", knowledgeBaseArgument)
    .option("--json", "print machine-readable JSON")
    .action(async (storeRoot: string, knowledgeBaseId: string, options: { json?: boolean }) => {
      const view = await service.listSensitivityRules({ storeRoot, knowledgeBaseId });
      if (options.json === true) io.write(JSON.stringify(view));
      else writeRules(io, view);
    });

  sensitivity
    .command("add")
    .description(
      "Add one rule as a new rules version. Give exactly one of --heading-contains or --heading-path",
    )
    .argument("<store-root>", storeRootArgument)
    .argument("<knowledge-base-id>", knowledgeBaseArgument)
    .requiredOption("--tier <tier>", `tier to assign: ${sourceSensitivityTiers.join(", ")}`)
    .option(
      "--heading-contains <text>",
      "match any section whose own or ancestor heading contains this text",
    )
    .option(
      "--heading-path <headings...>",
      "match the section at this heading path, from the top level down (one argument per heading)",
    )
    .option("--id <rule-id>", "rule id (letters, digits, '.', '_', '-'); generated when omitted")
    .option("--json", "print machine-readable JSON")
    .action(
      async (
        storeRoot: string,
        knowledgeBaseId: string,
        options: {
          tier: string;
          headingContains?: string;
          headingPath?: string[];
          id?: string;
          json?: boolean;
        },
      ) => {
        const tier = parseTier(options.tier);
        if ((options.headingContains === undefined) === (options.headingPath === undefined)) {
          throw new CliUserError("Give exactly one of --heading-contains or --heading-path.");
        }
        const match: SourceSensitivityRuleMatch =
          options.headingContains !== undefined
            ? { kind: "heading-contains", text: options.headingContains }
            : { kind: "heading-path", path: options.headingPath ?? [] };
        const view = await service.addSensitivityRule({
          storeRoot,
          knowledgeBaseId,
          rule: { tier, match },
          ...(options.id === undefined ? {} : { id: options.id }),
        });
        if (options.json === true) io.write(JSON.stringify(view));
        else writeRules(io, view);
      },
    );

  sensitivity
    .command("remove")
    .description("Remove one rule by id as a new rules version")
    .argument("<store-root>", storeRootArgument)
    .argument("<knowledge-base-id>", knowledgeBaseArgument)
    .argument("<rule-id>", "id of the rule to remove")
    .option("--json", "print machine-readable JSON")
    .action(
      async (
        storeRoot: string,
        knowledgeBaseId: string,
        ruleId: string,
        options: { json?: boolean },
      ) => {
        const view = await service.removeSensitivityRule({ storeRoot, knowledgeBaseId, ruleId });
        if (options.json === true) io.write(JSON.stringify(view));
        else writeRules(io, view);
      },
    );

  sensitivity
    .command("suggestions")
    .description("List the default rule suggestions; none is applied until you adopt it")
    .option("--json", "print machine-readable JSON")
    .action((options: { json?: boolean }) => {
      const suggestions = service.listSensitivitySuggestions();
      if (options.json === true) {
        io.write(JSON.stringify({ suggestions }));
        return;
      }
      io.write(
        "suggested sensitivity rules (not applied; adopt with `knowledge sensitivity adopt`):",
      );
      for (const suggestion of suggestions) io.write(ruleLine(suggestion));
    });

  sensitivity
    .command("adopt")
    .description("Add chosen default suggestions as rules after explicit confirmation")
    .argument("<store-root>", storeRootArgument)
    .argument("<knowledge-base-id>", knowledgeBaseArgument)
    .argument("<suggestion-ids...>", "suggestion ids from `knowledge sensitivity suggestions`")
    .option("--confirm", "confirm adding these suggestions as rules")
    .option("--json", "print machine-readable JSON")
    .action(
      async (
        storeRoot: string,
        knowledgeBaseId: string,
        suggestionIds: string[],
        options: { confirm?: boolean; json?: boolean },
      ) => {
        if (options.confirm !== true) {
          throw new CliUserError("knowledge sensitivity adopt requires --confirm.");
        }
        const result = await service.adoptSensitivitySuggestions({
          storeRoot,
          knowledgeBaseId,
          suggestionIds,
        });
        if (options.json === true) {
          io.write(JSON.stringify(result));
          return;
        }
        io.write(`adopted: ${result.adopted.join(", ") || "none"}`);
        if (result.skipped.length > 0) {
          io.write(`skipped (already present): ${result.skipped.join(", ")}`);
        }
        writeRules(io, result);
      },
    );

  sensitivity
    .command("preview")
    .description(
      "Show how a source version's sections are classified; section text is hidden unless --text is given",
    )
    .argument("<store-root>", storeRootArgument)
    .argument("<knowledge-base-id>", knowledgeBaseArgument)
    .argument("<source-id>", "opaque source id")
    .option("--version <version-id>", "source version id (default: the latest version)")
    .option("--text", "include each section's text in the output")
    .option("--json", "print machine-readable JSON")
    .action(
      async (
        storeRoot: string,
        knowledgeBaseId: string,
        sourceId: string,
        options: { version?: string; text?: boolean; json?: boolean },
      ) => {
        const preview = await service.previewSourceSensitivity({
          storeRoot,
          knowledgeBaseId,
          sourceId,
          ...(options.version === undefined ? {} : { versionId: options.version }),
          includeText: options.text === true,
        });
        if (options.json === true) io.write(JSON.stringify(preview));
        else writePreview(io, preview);
      },
    );
}
