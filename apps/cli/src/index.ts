import { defaultRequiredSections } from "@draft-loop/application";
import { Command } from "commander";
import packageJson from "../package.json";

import { independentReviewLines } from "./independent-review.js";
import { generateSanitizedPilotReport } from "./pilot-report.js";
import {
  type ApplicationIo,
  type ApplicationService,
  applicationService,
  type CandidateKnowledgeSourceManifest,
  type CandidateKnowledgeSourceWriteResult,
  type CandidateKnowledgeStoreService,
  type CandidateKnowledgeStoreView,
  type KnowledgeBaseLifecycleReadinessResult,
  type KnowledgeSourceDuplicateGroup,
  knowledgeService,
  runPilot,
  type StatusCommand,
  safeErrorMessage,
  type WorkspaceDescriptor,
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

const maximumKnowledgeInspectionItems = 256;

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function writeJson(io: ApplicationIo, value: unknown): void {
  io.write(JSON.stringify(value));
}

function writeKnowledgeSourceManifests(
  io: ApplicationIo,
  knowledgeBaseId: string,
  manifests: readonly CandidateKnowledgeSourceManifest[],
): void {
  const ordered = [...manifests].sort((left, right) =>
    lexicalCompare(left.source.id, right.source.id),
  );
  const sources = ordered.slice(0, maximumKnowledgeInspectionItems).map((manifest) => {
    const versions = [...manifest.versions].sort(
      (left, right) => left.version - right.version || lexicalCompare(left.id, right.id),
    );
    return {
      sourceId: manifest.source.id,
      kind: manifest.source.kind,
      versionCount: versions.length,
      versionIds: versions.slice(0, maximumKnowledgeInspectionItems).map((version) => version.id),
      versionIdsTruncated: versions.length > maximumKnowledgeInspectionItems,
    };
  });
  writeJson(io, {
    knowledgeBaseId,
    sourceCount: ordered.length,
    sources,
    sourcesTruncated: ordered.length > maximumKnowledgeInspectionItems,
  });
}

function writeKnowledgeSourceDuplicateGroups(
  io: ApplicationIo,
  knowledgeBaseId: string,
  groups: readonly KnowledgeSourceDuplicateGroup[],
): void {
  const ordered = groups
    .map((group) => ({
      ...group,
      members: [...group.members].sort(
        (left, right) =>
          lexicalCompare(left.sourceId, right.sourceId) ||
          lexicalCompare(left.versionId, right.versionId),
      ),
    }))
    .sort((left, right) => {
      const leftKey = left.members
        .map((member) => `${member.sourceId}\u0000${member.versionId}`)
        .join("\u0001");
      const rightKey = right.members
        .map((member) => `${member.sourceId}\u0000${member.versionId}`)
        .join("\u0001");
      return lexicalCompare(leftKey, rightKey);
    });
  const duplicateGroups = ordered.slice(0, maximumKnowledgeInspectionItems).map((group) => ({
    memberCount: group.members.length,
    members: group.members.slice(0, maximumKnowledgeInspectionItems),
    membersTruncated: group.members.length > maximumKnowledgeInspectionItems,
  }));
  writeJson(io, {
    knowledgeBaseId,
    groupCount: ordered.length,
    groups: duplicateGroups,
    groupsTruncated: ordered.length > maximumKnowledgeInspectionItems,
  });
}

function writeKnowledgeSourceWriteResult(
  io: ApplicationIo,
  knowledgeBaseId: string,
  result: CandidateKnowledgeSourceWriteResult,
  expectedKind: "file" | "url",
  expectedSourceId?: string,
): void {
  if (
    typeof result !== "object" ||
    result === null ||
    typeof result.created !== "boolean" ||
    typeof result.source !== "object" ||
    result.source === null ||
    result.source.knowledgeBaseId !== knowledgeBaseId ||
    typeof result.source.id !== "string" ||
    result.source.id.trim() === "" ||
    (expectedSourceId !== undefined && result.source.id !== expectedSourceId) ||
    result.source.kind !== expectedKind ||
    !Array.isArray(result.versions) ||
    result.versions.length === 0
  ) {
    throw new Error("The candidate knowledge source write result was invalid.");
  }
  const versions = [...result.versions].sort(
    (left, right) => right.version - left.version || lexicalCompare(left.id, right.id),
  );
  const latest = versions[0];
  if (
    latest === undefined ||
    typeof latest.id !== "string" ||
    latest.id.trim() === "" ||
    latest.sourceId !== result.source.id ||
    !Number.isSafeInteger(latest.version) ||
    latest.version < 1
  ) {
    throw new Error("The candidate knowledge source write result was invalid.");
  }
  writeJson(io, {
    knowledgeBaseId,
    sourceId: result.source.id,
    kind: result.source.kind,
    versionId: latest.id,
    version: latest.version,
    created: result.created,
  });
}

function writeManagedKnowledgeInventory(
  io: ApplicationIo,
  inventory: Awaited<
    ReturnType<CandidateKnowledgeStoreService["inspectManagedCandidateKnowledgeFiles"]>
  >,
): void {
  writeJson(io, {
    schemaVersion: inventory.schemaVersion,
    verifiedManagedFileCount: inventory.verifiedManagedFileCount,
    scannedEntryCount: inventory.scannedEntryCount,
    unknownEntries: {
      intakeShapedFilesAtSourcesRoot: inventory.unknownEntries.intakeShapedFilesAtSourcesRoot,
      opaqueEntriesAtSourcesRoot: inventory.unknownEntries.opaqueEntriesAtSourcesRoot,
      entriesInsideManagedSourceDirectories:
        inventory.unknownEntries.entriesInsideManagedSourceDirectories,
      symbolicLinks: inventory.unknownEntries.symbolicLinks,
      otherEntries: inventory.unknownEntries.otherEntries,
    },
    complete: inventory.complete,
    scanLimitReached: inventory.scanLimitReached,
  });
}

function writeKnowledgeSelection(io: ApplicationIo, descriptor: WorkspaceDescriptor): void {
  const selections = descriptor.candidateKnowledgeSelection;
  if (!Array.isArray(selections) || selections.length === 0) {
    throw new Error("The candidate knowledge selection was not persisted.");
  }
  io.write("knowledge selection configured:");
  for (const selection of [...selections].sort((left, right) => {
    const storeOrder = left.storeId.localeCompare(right.storeId);
    return storeOrder !== 0
      ? storeOrder
      : left.knowledgeBaseId.localeCompare(right.knowledgeBaseId);
  })) {
    io.write(`store ${selection.storeId} knowledge-base ${selection.knowledgeBaseId}`);
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

  knowledgeStore
    .command("inventory")
    .description("Inspect managed-file inventory counts without exposing local paths")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .action(async (storeRoot: string) => {
      writeManagedKnowledgeInventory(
        io,
        await candidateKnowledge.inspectManagedCandidateKnowledgeFiles({ storeRoot }),
      );
    });

  const knowledgeBase = knowledge
    .command("base")
    .description("Create and maintain knowledge bases in a local store");
  knowledgeBase
    .command("create")
    .description("Create a knowledge base in a local store")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<display-name>", "knowledge-base display name")
    .option("--description <text>", "knowledge-base description")
    .action(async (storeRoot: string, displayName: string, options: Record<string, unknown>) => {
      const view = await candidateKnowledge.createKnowledgeBase({
        storeRoot,
        displayName,
        ...(options.description === undefined
          ? {}
          : { description: options.description as string }),
      });
      writeKnowledgeStoreView(io, "base-created", view);
    });

  knowledgeBase
    .command("rename")
    .description("Rename a knowledge base in a local store")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .argument("<display-name>", "new knowledge-base display name")
    .action(async (storeRoot: string, knowledgeBaseId: string, displayName: string) => {
      const view = await candidateKnowledge.renameKnowledgeBase({
        storeRoot,
        knowledgeBaseId,
        displayName,
      });
      writeKnowledgeStoreView(io, "base-renamed", view);
    });

  knowledgeBase
    .command("archive")
    .description("Archive a knowledge base in a local store")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .option("--confirm", "confirm archival, which may invalidate configured workspace selections")
    .action(
      async (storeRoot: string, knowledgeBaseId: string, options: Record<string, unknown>) => {
        if (options.confirm !== true) {
          throw new Error("knowledge base archive requires --confirm.");
        }
        const view = await candidateKnowledge.archiveKnowledgeBase({
          storeRoot,
          knowledgeBaseId,
        });
        writeKnowledgeStoreView(io, "base-archived", view);
      },
    );

  const knowledgeSource = knowledge
    .command("source")
    .description("Import and inspect candidate knowledge sources");
  knowledgeSource
    .command("import")
    .description("Import one explicitly selected local source file")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .argument("<source-path>", "local source file path")
    .option("--display-name <name>", "optional source display name")
    .action(
      async (
        storeRoot: string,
        knowledgeBaseId: string,
        sourcePath: string,
        options: Record<string, unknown>,
      ) => {
        const result = await candidateKnowledge.importKnowledgeSourceFile({
          storeRoot,
          knowledgeBaseId,
          sourcePath,
          ...(options.displayName === undefined
            ? {}
            : { displayName: options.displayName as string }),
        });
        writeKnowledgeSourceWriteResult(io, knowledgeBaseId, result, "file");
      },
    );

  knowledgeSource
    .command("import-url")
    .description("Import one explicitly approved URL into a local candidate-knowledge store")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .argument("<url>", "source URL")
    .option("--approve", "approve retrieving and storing this URL")
    .option("--display-name <name>", "optional source display name")
    .action(
      async (
        storeRoot: string,
        knowledgeBaseId: string,
        url: string,
        options: Record<string, unknown>,
      ) => {
        if (options.approve !== true) {
          throw new Error("knowledge source import-url requires --approve.");
        }
        const result = await candidateKnowledge.importKnowledgeSourceUrl({
          storeRoot,
          knowledgeBaseId,
          url,
          approved: true,
          ...(options.displayName === undefined
            ? {}
            : { displayName: options.displayName as string }),
        });
        writeKnowledgeSourceWriteResult(io, knowledgeBaseId, result, "url");
      },
    );

  knowledgeSource
    .command("append-file-version")
    .description("Append one explicitly selected local file as a source version")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .argument("<source-id>", "opaque file source id")
    .argument("<source-path>", "local source file path")
    .action(
      async (storeRoot: string, knowledgeBaseId: string, sourceId: string, sourcePath: string) => {
        const result = await candidateKnowledge.appendKnowledgeSourceFileVersion({
          storeRoot,
          knowledgeBaseId,
          sourceId,
          sourcePath,
        });
        writeKnowledgeSourceWriteResult(io, knowledgeBaseId, result, "file", sourceId);
      },
    );

  knowledgeSource
    .command("list")
    .description("List source kinds and version identities")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .action(async (storeRoot: string, knowledgeBaseId: string) => {
      writeKnowledgeSourceManifests(
        io,
        knowledgeBaseId,
        await candidateKnowledge.listKnowledgeSourceManifests({ storeRoot, knowledgeBaseId }),
      );
    });

  knowledgeSource
    .command("duplicates")
    .description("List duplicate source/version identities")
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .action(async (storeRoot: string, knowledgeBaseId: string) => {
      writeKnowledgeSourceDuplicateGroups(
        io,
        knowledgeBaseId,
        await candidateKnowledge.listKnowledgeSourceDuplicateGroups({ storeRoot, knowledgeBaseId }),
      );
    });

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

  knowledge
    .command("select")
    .description("Persist an explicit local candidate-knowledge selection for a workspace")
    .argument("<workspace>", "workspace directory")
    .argument("[selection...]", "repeated <store-root> <knowledge-base-id> pairs")
    .option("--approve-combination", "approve combining more than one store/knowledge base")
    .action(async (workspace: string, selection: string[], options: Record<string, unknown>) => {
      if (selection.length === 0 || selection.length % 2 !== 0) {
        throw new Error(
          "knowledge select requires one or more <store-root> <knowledge-base-id> pairs.",
        );
      }

      const entries: {
        readonly storeRoot: string;
        readonly storeId: string;
        readonly knowledgeBaseId: string;
      }[] = [];
      for (let index = 0; index < selection.length; index += 2) {
        const storeRoot = selection[index];
        const knowledgeBaseId = selection[index + 1];
        if (storeRoot === undefined || knowledgeBaseId === undefined) {
          throw new Error(
            "knowledge select requires one or more <store-root> <knowledge-base-id> pairs.",
          );
        }
        const view = await candidateKnowledge.openStore({ storeRoot });
        if (typeof view.store.id !== "string" || view.store.id.trim() === "") {
          throw new Error("The candidate knowledge store identity could not be verified.");
        }
        entries.push({ storeRoot, storeId: view.store.id, knowledgeBaseId });
      }

      const descriptor = await service.configureKnowledgeSelection({
        root: workspaceRoot(workspace),
        entries,
        ...(options.approveCombination === true ? { combinationApproved: true } : {}),
      });
      writeKnowledgeSelection(io, descriptor);
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
