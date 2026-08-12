import { Command } from "commander";

import {
  exportRun,
  initWorkspace,
  lifecycleRun,
  readWorkspace,
  resumeRun,
  runPilot,
  safeErrorMessage,
  startRun,
  statusRun,
  workspaceRoot,
} from "./workflow.js";

function numberOption(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected a number, received ${value}.`);
  }
  return parsed;
}

function integerOption(value: string): number {
  const parsed = numberOption(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Expected an integer, received ${value}.`);
  }
  return parsed;
}

function boolOption(options: Record<string, unknown>, key: string): boolean {
  return options[key] === true;
}

export function createCli(): Command {
  const command = new Command()
    .name("draft-loop")
    .description("Local-first CV drafting and review workspace")
    .version("0.1.0")
    .showHelpAfterError();

  command
    .command("init")
    .description("Create a local workspace manifest")
    .argument("[workspace]", "workspace directory", ".")
    .requiredOption("-j, --job-description <path>", "local job description file")
    .requiredOption("-s, --sources <path>", "local source directory")
    .option("--language <language>", "output language", "en")
    .option("--instructions <text>", "candidate instructions")
    .option("--truthfulness-policy <text>", "truthfulness policy")
    .option("--author-company <company>", "author provider company", "anthropic")
    .option("--author-model <model>", "exact author model id", "claude-sonnet-4-5")
    .option("--critic-company <company>", "critic provider company", "openai")
    .option("--critic-model <model>", "exact critic model id", "gpt-5")
    .option(
      "--required-sections <sections>",
      "comma-separated required output sections",
      "Summary,Experience",
    )
    .option("--max-rounds <number>", "maximum author/critic rounds", integerOption, 3)
    .option("--max-cost-usd <number>", "maximum estimated provider cost", numberOption)
    .option("--max-duration-ms <number>", "maximum run duration", integerOption)
    .option("--max-words <number>", "maximum output words", integerOption)
    .option("--max-characters <number>", "maximum output characters", integerOption)
    .option("--fixture", "use deterministic offline agents")
    .action(async (workspace: string, options: Record<string, unknown>) => {
      await initWorkspace({
        root: workspaceRoot(workspace),
        jobDescription: options.jobDescription as string,
        sources: options.sources as string,
        language: options.language as string,
        ...(options.instructions === undefined
          ? {}
          : { instructions: options.instructions as string }),
        ...(options.truthfulnessPolicy === undefined
          ? {}
          : { truthfulnessPolicy: options.truthfulnessPolicy as string }),
        authorCompany: options.authorCompany as string,
        authorModel: options.authorModel as string,
        criticCompany: options.criticCompany as string,
        criticModel: options.criticModel as string,
        requiredSections: (options.requiredSections as string)
          .split(",")
          .map((section) => section.trim())
          .filter((section) => section !== ""),
        maxRounds: options.maxRounds as number,
        ...(options.maxCostUsd === undefined ? {} : { maxCostUsd: options.maxCostUsd as number }),
        ...(options.maxDurationMs === undefined
          ? {}
          : { maxDurationMs: options.maxDurationMs as number }),
        ...(options.maxWords === undefined ? {} : { maxWords: options.maxWords as number }),
        ...(options.maxCharacters === undefined
          ? {}
          : { maxCharacters: options.maxCharacters as number }),
        fixtureMode: boolOption(options, "fixture"),
      });
    });

  command
    .command("pilot")
    .description("Run the offline phase-0 pilot against synthetic fixture data")
    .argument("[workspace]", "new pilot workspace directory", "./draft-loop-pilot")
    .action(async (workspace: string) => {
      await runPilot(workspaceRoot(workspace));
    });

  command
    .command("open")
    .description("Open a workspace and show its safe status")
    .argument("[workspace]", "workspace directory", ".")
    .action(async (workspace: string) => {
      await readWorkspace(workspaceRoot(workspace));
      await statusRun(workspaceRoot(workspace), undefined);
    });

  command
    .command("start")
    .description("Ingest local inputs and start a run")
    .argument("[workspace]", "workspace directory", ".")
    .option("--allow-provider-data", "explicitly approve transmission of sensitive material")
    .action(async (workspace: string, options: Record<string, unknown>) => {
      await startRun(workspaceRoot(workspace), {
        allowProviderData: boolOption(options, "allowProviderData"),
      });
    });

  command
    .command("resume")
    .description("Resume the latest or selected interrupted run")
    .argument("[workspace]", "workspace directory", ".")
    .option("--run-id <id>", "run id to resume")
    .option("--allow-provider-data", "explicitly approve transmission of sensitive material")
    .action(async (workspace: string, options: Record<string, unknown>) => {
      await resumeRun(workspaceRoot(workspace), {
        ...(options.runId === undefined ? {} : { runId: options.runId as string }),
        allowProviderData: boolOption(options, "allowProviderData"),
      });
    });

  for (const [name, description, action] of [
    ["pause", "Pause an active run", "pause"],
    ["stop", "Stop an active run", "stop"],
    ["approve", "Approve a run awaiting review", "approve"],
    ["revise", "Request another author revision", "revision"],
  ] as const) {
    command
      .command(name)
      .description(description)
      .argument("[workspace]", "workspace directory", ".")
      .option("--run-id <id>", "run id to update")
      .action(async (workspace: string, options: Record<string, unknown>) => {
        await lifecycleRun(workspaceRoot(workspace), action, options.runId as string | undefined);
      });
  }

  command
    .command("status")
    .description("Inspect a run without printing prompts or source content")
    .argument("[workspace]", "workspace directory", ".")
    .option("--run-id <id>", "run id to inspect")
    .action(async (workspace: string, options: Record<string, unknown>) => {
      await statusRun(workspaceRoot(workspace), options.runId as string | undefined);
    });

  command
    .command("export")
    .description("Render an approved artifact to a local document")
    .argument("[workspace]", "workspace directory", ".")
    .option("--run-id <id>", "run id to export")
    .option("--output <path>", "local output path")
    .option("--format <format>", "output format: markdown, pdf, or docx", "markdown")
    .action(async (workspace: string, options: Record<string, unknown>) => {
      await exportRun(
        workspaceRoot(workspace),
        options.runId as string | undefined,
        options.output as string | undefined,
        undefined,
        options.format as string,
      );
    });

  return command;
}

export async function runCli(argv: readonly string[] = process.argv): Promise<void> {
  try {
    await createCli().parseAsync(argv);
  } catch (error) {
    console.error(`error: ${safeErrorMessage(error)}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runCli();
}
