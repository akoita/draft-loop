import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createCli } from "./index.js";
import type {
  ApplicationIo,
  ApplicationService,
  IndependentReviewRecord,
  InitializeWorkspaceCommand,
  StatusCommand,
  WorkspaceDescriptor,
} from "./workflow.js";

function descriptor(root: string): WorkspaceDescriptor {
  return {
    id: "workspace-test",
    root,
    jobDescriptionPath: "job.md",
    sourceDirectory: "evidence",
    language: "en",
    outputFormat: "markdown",
    requiredSections: ["Summary"],
    maxRounds: 3,
    author: { company: "anthropic", model: "claude-sonnet-4-5" },
    critic: { company: "openai", model: "gpt-5.6-luna" },
    fixtureMode: true,
  };
}

/** Every command the CLI must not reach in these tests fails loudly instead. */
function unreachable(name: string): () => Promise<never> {
  return async () => {
    throw new Error(`${name} must not be called.`);
  };
}

interface Harness {
  readonly service: ApplicationService;
  readonly io: ApplicationIo;
  readonly initializations: InitializeWorkspaceCommand[];
  readonly independenceQueries: StatusCommand[];
  readonly lines: string[];
}

function harness(record?: IndependentReviewRecord): Harness {
  const initializations: InitializeWorkspaceCommand[] = [];
  const independenceQueries: StatusCommand[] = [];
  const lines: string[] = [];
  const service: ApplicationService = {
    initialize: async (command) => {
      initializations.push(command);
      return descriptor(command.root);
    },
    readWorkspace: async (root) => descriptor(root),
    begin: unreachable("begin"),
    start: unreachable("start"),
    resume: unreachable("resume"),
    lifecycle: unreachable("lifecycle"),
    status: async (_command, io) => {
      io?.write("workspace workspace-test");
      return undefined;
    },
    export: unreachable("export"),
    latestExportPath: unreachable("latestExportPath"),
    queryEvidence: unreachable("queryEvidence"),
    inspectEvidenceRetrieval: unreachable("inspectEvidenceRetrieval"),
    recordReviewDecision: unreachable("recordReviewDecision"),
    readIndependentReview: async (command) => {
      independenceQueries.push(command);
      return record;
    },
  };
  return {
    service,
    io: { write: (line) => lines.push(line) },
    initializations,
    independenceQueries,
    lines,
  };
}

async function run(dependencies: Harness, ...argv: readonly string[]): Promise<void> {
  await createCli({ service: dependencies.service, io: dependencies.io }).parseAsync([
    "node",
    "draft-loop",
    ...argv,
  ]);
}

describe("draft-loop init independence flags", () => {
  it("carries both lineage claims and an override rationale into the application", async () => {
    const dependencies = harness();

    await run(
      dependencies,
      "init",
      "workspace",
      "-j",
      "job.md",
      "-s",
      "evidence",
      "--author-lineage",
      "glm-4-6",
      "--critic-lineage",
      "qwen3-30b",
      "--independence-override-rationale",
      "Only one local model fits in memory on this machine.",
    );

    expect(dependencies.initializations).toHaveLength(1);
    expect(dependencies.initializations[0]).toMatchObject({
      root: resolve("workspace"),
      authorLineage: "glm-4-6",
      criticLineage: "qwen3-30b",
      independenceOverrideRationale: "Only one local model fits in memory on this machine.",
    });
  });

  it("leaves the command untouched when the independence flags are omitted", async () => {
    const dependencies = harness();

    await run(dependencies, "init", "workspace", "-j", "job.md", "-s", "evidence");

    const command = dependencies.initializations[0] as InitializeWorkspaceCommand;
    expect(command).not.toHaveProperty("authorLineage");
    expect(command).not.toHaveProperty("criticLineage");
    expect(command).not.toHaveProperty("independenceOverrideRationale");
  });
});

describe("independent review in status output", () => {
  it("reports distinct lineages as a claim rather than as proof", async () => {
    const dependencies = harness({
      authorLineage: "anthropic:claude-sonnet-4-5",
      criticLineage: "openai:gpt-5.6-luna",
      lineagesDistinct: true,
      required: true,
    });

    await run(dependencies, "open", "workspace");

    expect(dependencies.independenceQueries).toEqual([{ root: resolve("workspace") }]);
    expect(dependencies.lines).toEqual([
      "workspace workspace-test",
      "Claimed lineages: author anthropic:claude-sonnet-4-5; critic openai:gpt-5.6-luna",
      "Independent review: lineages differ, as claimed. A lineage is an operator label that nothing verifies; two labels can name the same weights.",
    ]);
  });

  it("shows a shared lineage as not independent and prints the recorded override", async () => {
    const dependencies = harness({
      authorLineage: "local:glm-4-6",
      criticLineage: "local:glm-4-6",
      lineagesDistinct: false,
      required: true,
      overrideRationale: "Only one local model fits in memory on this machine.",
    });

    await run(dependencies, "status", "workspace", "--run-id", "run-7");

    expect(dependencies.independenceQueries).toEqual([
      { root: resolve("workspace"), runId: "run-7" },
    ]);
    expect(dependencies.lines).toEqual([
      "workspace workspace-test",
      "Claimed lineages: author local:glm-4-6; critic local:glm-4-6",
      "Independent review: overridden. Author and critic share one lineage, so this critique was not independent; the run proceeded on a recorded rationale.",
      "Override rationale: Only one local model fits in memory on this machine.",
    ]);
  });

  it("says nothing was recorded instead of failing when a workspace has no record", async () => {
    const dependencies = harness(undefined);

    await run(dependencies, "open", "workspace");

    expect(dependencies.lines).toEqual([
      "workspace workspace-test",
      "Independent review: no lineage claim was recorded. Either no run has started yet, or the run predates independence being recorded.",
    ]);
  });
});
