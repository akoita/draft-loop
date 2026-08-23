import { defaultRequiredSections } from "@draft-loop/application";
import { Command } from "commander";
import packageJson from "../package.json";

import { independentReviewLines } from "./independent-review.js";
import { generateSanitizedPilotReport } from "./pilot-report.js";
import {
  type ApplicationIo,
  type ApplicationService,
  applicationService,
  type CandidateKnowledgeStoreService,
  type CandidateKnowledgeStoreView,
  type KnowledgeBaseLifecycleReadinessResult,
  knowledgeService,
  runPilot,
  type StatusCommand,
  safeErrorMessage,
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

/** Status lines are user-facing output, so they go to stdout rather than stderr. */
const stdoutIo: ApplicationIo = {
  write: (line) => {
    process.stdout.write(`${line}\n`);
  },
};

export interface CliDependencies {
  /** The application boundary the commands drive; replaced in tests. */
  readonly service?: ApplicationService;
  /** The candidate-knowledge boundary the path-explicit controls drive; replaced in tests. */
  readonly knowledgeService?: CandidateKnowledgeStoreService;
  /** Where status lines are written; replaced in tests. */
  readonly io?: ApplicationIo;
}

function writeKnowledgeStoreView(
  io: ApplicationIo,
  action: string,
  view: CandidateKnowledgeStoreView,
): void {
  io.write(`knowledge store ${action}: ${view.store.id}`);
  for (const knowledgeBase of [...view.knowledgeBases].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    io.write(
      `knowledge base ${knowledgeBase.id} state=${knowledgeBase.state} default=${knowledgeBase.isDefault}`,
    );
  }
}

function writeKnowledgeBaseReadiness(
  io: ApplicationIo,
  readiness: KnowledgeBaseLifecycleReadinessResult,
): void {
  io.write(
    `knowledge base ${readiness.knowledgeBaseId} state=${readiness.state} sources=${readiness.sources.length}`,
  );
  for (const source of readiness.sources) {
    const reasons = source.reasons.length === 0 ? "none" : source.reasons.join(",");
    io.write(
      `source ${source.sourceId} version=${source.latestVersionId} status=${source.status} reasons=${reasons}`,
    );
  }
}

export function createCli(dependencies: CliDependencies = {}): Command {
  const service = dependencies.service ?? applicationService;
  const candidateKnowledge = dependencies.knowledgeService ?? knowledgeService;
  const io = dependencies.io ?? stdoutIo;

  /** Reports the recorded independence claim, including that there is none. */
  const writeIndependentReview = async (statusCommand: StatusCommand): Promise<void> => {
    const record = await service.readIndependentReview(statusCommand);
    for (const line of independentReviewLines(record)) io.write(line);
  };

  const command = new Command()
    .name("draft-loop")
    .description("Local-first CV drafting and review workspace")
    .version(packageJson.version)
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
    .option("--critic-model <model>", "exact critic model id", "gpt-5.6-luna")
    .option(
      "--author-lineage <lineage>",
      "weights the author descends from; defaults to <company>:<model>",
    )
    .option(
      "--critic-lineage <lineage>",
      "weights the critic descends from; defaults to <company>:<model>",
    )
    .option(
      "--independence-override-rationale <text>",
      "why one lineage on both sides is acceptable; recorded with every run",
    )
    .option(
      "--local-endpoint <url>",
      "loopback base URL of the local model server, used when a company is 'local'",
    )
    .option(
      "--required-sections <sections>",
      "comma-separated required output sections",
      defaultRequiredSections.join(","),
    )
    .option("--max-rounds <number>", "maximum author/critic rounds", integerOption, 3)
    .option("--max-cost-usd <number>", "maximum estimated provider cost", numberOption)
    .option("--max-duration-ms <number>", "maximum run duration", integerOption)
    .option("--max-words <number>", "maximum output words", integerOption)
    .option("--max-characters <number>", "maximum output characters", integerOption)
    .option("--fixture", "use deterministic offline agents")
    .action(async (workspace: string, options: Record<string, unknown>) => {
      await service.initialize({
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
        ...(options.authorLineage === undefined
          ? {}
          : { authorLineage: options.authorLineage as string }),
        ...(options.criticLineage === undefined
          ? {}
          : { criticLineage: options.criticLineage as string }),
        ...(options.independenceOverrideRationale === undefined
          ? {}
          : { independenceOverrideRationale: options.independenceOverrideRationale as string }),
        ...(options.localEndpoint === undefined
          ? {}
          : { localEndpoint: options.localEndpoint as string }),
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
    .command("pilot-report")
    .description(
      "Generate the sanitized consented-pilot summary from a private case file held outside the repository",
    )
    .argument("<case-file>", "path to the private consented case file")
    .argument(
      "[output]",
      "where to write the sanitized Markdown summary (default: next to the case file)",
    )
    .action(async (caseFile: string, output: string | undefined) => {
      await generateSanitizedPilotReport({
        casePath: caseFile,
        ...(output === undefined ? {} : { outputPath: output }),
      });
    });

  command
    .command("open")
    .description("Open a workspace and show its safe status")
    .argument("[workspace]", "workspace directory", ".")
    .action(async (workspace: string) => {
      const root = workspaceRoot(workspace);
      await service.readWorkspace(root);
      await service.status({ root }, io);
      await writeIndependentReview({ root });
    });

  command
    .command("start")
    .description("Ingest local inputs and start a run")
    .argument("[workspace]", "workspace directory", ".")
    .option("--allow-provider-data", "explicitly approve transmission of sensitive material")
    .action(async (workspace: string, options: Record<string, unknown>) => {
      await service.start({
        root: workspaceRoot(workspace),
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
      await service.resume({
        root: workspaceRoot(workspace),
        ...(options.runId === undefined ? {} : { runId: options.runId as string }),
        allowProviderData: boolOption(options, "allowProviderData"),
      });
    });

  for (const [name, description, action] of [
    ["pause", "Pause an active run", "pause"],
    ["stop", "Stop an active run", "stop"],
    ["recover", "Return to review after a provider failure", "recover-review"],
    ["approve", "Approve a run awaiting review", "approve"],
    ["revise", "Request another author revision", "revision"],
  ] as const) {
    command
      .command(name)
      .description(description)
      .argument("[workspace]", "workspace directory", ".")
      .option("--run-id <id>", "run id to update")
      .action(async (workspace: string, options: Record<string, unknown>) => {
        await service.lifecycle({
          root: workspaceRoot(workspace),
          action,
          ...(options.runId === undefined ? {} : { runId: options.runId as string }),
        });
      });
  }

  command
    .command("status")
    .description("Inspect a run without printing prompts or source content")
    .argument("[workspace]", "workspace directory", ".")
    .option("--run-id <id>", "run id to inspect")
    .action(async (workspace: string, options: Record<string, unknown>) => {
      const statusCommand: StatusCommand = {
        root: workspaceRoot(workspace),
        ...(options.runId === undefined ? {} : { runId: options.runId as string }),
      };
      await service.status(statusCommand, io);
      await writeIndependentReview(statusCommand);
    });

  command
    .command("export")
    .description("Render an approved artifact to a local document")
    .argument("[workspace]", "workspace directory", ".")
    .option("--run-id <id>", "run id to export")
    .option("--output <path>", "local output path")
    .option("--format <format>", "output format: markdown, pdf, or docx", "markdown")
    .action(async (workspace: string, options: Record<string, unknown>) => {
      await service.export({
        root: workspaceRoot(workspace),
        ...(options.runId === undefined ? {} : { runId: options.runId as string }),
        ...(options.output === undefined ? {} : { outputPath: options.output as string }),
        format: options.format as "markdown" | "pdf" | "docx",
      });
    });

  const knowledge = command
    .command("knowledge")
    .description("Manage local candidate-knowledge stores and lifecycle readiness");
  const knowledgeStore = knowledge.command("store").description("Open and inspect a local store");

  knowledgeStore
    .command("init")
    .alias("create-default")
    .description("Initialize a local store with its default knowledge base")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .option("--display-name <name>", "default knowledge-base display name")
    .option("--description <text>", "default knowledge-base description")
    .action(async (storeRoot: string, options: Record<string, unknown>) => {
      const view = await candidateKnowledge.initializeStore({
        storeRoot,
        ...(options.displayName === undefined
          ? {}
          : { displayName: options.displayName as string }),
        ...(options.description === undefined
          ? {}
          : { description: options.description as string }),
      });
      writeKnowledgeStoreView(io, "initialized", view);
    });

  for (const [name, action] of [
    ["open", "opened"],
    ["list", "listed"],
  ] as const) {
    knowledgeStore
      .command(name)
      .description(name === "open" ? "Open a local store" : "List knowledge bases in a local store")
      .argument("<store-root>", "local candidate-knowledge store directory")
      .action(async (storeRoot: string) => {
        const view = await (name === "open"
          ? candidateKnowledge.openStore({ storeRoot })
          : candidateKnowledge.listKnowledgeBases({ storeRoot }));
        writeKnowledgeStoreView(io, action, view);
      });
  }

  const lifecycle = knowledge
    .command("lifecycle")
    .description("Inspect candidate-knowledge lifecycle state");
  lifecycle
    .command("readiness")
    .description("Report path-free lifecycle readiness for one knowledge base")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .action(async (storeRoot: string, knowledgeBaseId: string) => {
      const readiness = await candidateKnowledge.getKnowledgeBaseLifecycleReadiness({
        storeRoot,
        knowledgeBaseId,
      });
      writeKnowledgeBaseReadiness(io, readiness);
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
