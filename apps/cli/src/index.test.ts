import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createCli } from "./index.js";
import type {
  ApplicationIo,
  ApplicationService,
  CandidateKnowledgeStoreService,
  CandidateKnowledgeStoreView,
  ConfigureKnowledgeSelectionCommand,
  IndependentReviewRecord,
  InitializeWorkspaceCommand,
  KnowledgeBaseLifecycleReadinessResult,
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
    reconfigureModels: unreachable("reconfigureModels"),
    configureWritingPolicy: unreachable("configureWritingPolicy"),
    configureKnowledgeSelection: unreachable("configureKnowledgeSelection"),
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

function knowledgeStoreView(): CandidateKnowledgeStoreView {
  return {
    store: {
      schemaVersion: 1,
      id: "store-opaque" as CandidateKnowledgeStoreView["store"]["id"],
      createdAt: "2026-08-23T10:00:00.000Z",
    },
    knowledgeBases: [
      {
        id: "base-two" as CandidateKnowledgeStoreView["knowledgeBases"][number]["id"],
        displayName: "Private display name",
        description: "Private description",
        isDefault: false,
        state: "active",
        createdAt: "2026-08-23T10:00:00.000Z",
        updatedAt: "2026-08-23T10:00:00.000Z",
      },
      {
        id: "base-one" as CandidateKnowledgeStoreView["knowledgeBases"][number]["id"],
        displayName: "Default private display name",
        description: "Private default description",
        isDefault: true,
        state: "active",
        createdAt: "2026-08-23T10:00:00.000Z",
        updatedAt: "2026-08-23T10:00:00.000Z",
      },
    ],
  };
}

function knowledgeReadiness(): KnowledgeBaseLifecycleReadinessResult {
  return {
    knowledgeBaseId: "base-one",
    state: "active",
    archivedAt: null,
    sources: [
      {
        sourceId: "source-opaque",
        latestVersionId: "version-opaque",
        status: "ready",
        reasons: [],
        lifecycleRevision: {
          knowledgeBaseState: "active",
          knowledgeBaseArchivedAt: null,
          versionId: "version-opaque",
          version: 1,
          createdAt: "2026-08-23T10:00:00.000Z",
          managed: true,
          originBoundAt: "2026-08-23T10:00:00.000Z",
          observation: null,
          retirement: null,
          provenanceFetchedAt: null,
          directory: null,
        },
      },
    ],
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

describe("candidate knowledge CLI controls", () => {
  it("maps path-explicit store and readiness commands to safe output", async () => {
    const dependencies = harness();
    const storeRoot = resolve("private-candidate-store");
    const view = knowledgeStoreView();
    const readiness = knowledgeReadiness();
    const initializeStore = vi.fn(async () => view);
    const openStore = vi.fn(async () => view);
    const listKnowledgeBases = vi.fn(async () => view);
    const getKnowledgeBaseLifecycleReadiness = vi.fn(async () => readiness);
    const knowledgeService = {
      initializeStore,
      openStore,
      listKnowledgeBases,
      getKnowledgeBaseLifecycleReadiness,
    } as unknown as CandidateKnowledgeStoreService;

    const cli = createCli({
      service: dependencies.service,
      io: dependencies.io,
      knowledgeService,
    });
    await cli.parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "store",
      "init",
      storeRoot,
      "--display-name",
      "Private display name",
      "--description",
      "Private description",
    ]);
    await cli.parseAsync(["node", "draft-loop", "knowledge", "store", "create-default", storeRoot]);
    await cli.parseAsync(["node", "draft-loop", "knowledge", "store", "open", storeRoot]);
    await cli.parseAsync(["node", "draft-loop", "knowledge", "store", "list", storeRoot]);
    await cli.parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "lifecycle",
      "readiness",
      storeRoot,
      "base-one",
    ]);

    expect(initializeStore).toHaveBeenNthCalledWith(1, {
      storeRoot,
      displayName: "Private display name",
      description: "Private description",
    });
    expect(initializeStore).toHaveBeenNthCalledWith(2, { storeRoot });
    expect(openStore).toHaveBeenCalledWith({ storeRoot });
    expect(listKnowledgeBases).toHaveBeenCalledWith({ storeRoot });
    expect(getKnowledgeBaseLifecycleReadiness).toHaveBeenCalledWith({
      storeRoot,
      knowledgeBaseId: "base-one",
    });
    const output = dependencies.lines.join("\n");
    expect(output).toContain("knowledge store initialized: store-opaque");
    expect(output).toContain("knowledge base base-one state=active default=true");
    expect(output).toContain(
      "source source-opaque version=version-opaque status=ready reasons=none",
    );
    expect(output).not.toContain(storeRoot);
    expect(output).not.toContain("Private display name");
    expect(output).not.toContain("Private description");
  });
});

describe("candidate knowledge selection CLI control", () => {
  function selectionHarness(): {
    readonly service: ApplicationService;
    readonly configureKnowledgeSelection: ReturnType<typeof vi.fn>;
    readonly lines: string[];
  } {
    const dependencies = harness();
    const configureKnowledgeSelection = vi.fn(
      async (command: ConfigureKnowledgeSelectionCommand): Promise<WorkspaceDescriptor> => ({
        ...descriptor(command.root),
        candidateKnowledgeSelection: command.entries.map(({ storeId, knowledgeBaseId }) => ({
          storeId,
          knowledgeBaseId,
        })),
      }),
    );
    return {
      service: { ...dependencies.service, configureKnowledgeSelection },
      configureKnowledgeSelection,
      lines: dependencies.lines,
    };
  }

  it("opens one store, persists one selection, and prints only opaque ids", async () => {
    const storeRoot = resolve("private-selection-store");
    const workspace = resolve("private-workspace");
    const openStore = vi.fn(async () => knowledgeStoreView());
    const knowledgeService = { openStore } as unknown as CandidateKnowledgeStoreService;
    const dependencies = selectionHarness();

    await createCli({
      service: dependencies.service,
      io: { write: (line) => dependencies.lines.push(line) },
      knowledgeService,
    }).parseAsync(["node", "draft-loop", "knowledge", "select", workspace, storeRoot, "base-one"]);

    expect(openStore).toHaveBeenCalledWith({ storeRoot });
    expect(dependencies.configureKnowledgeSelection).toHaveBeenCalledWith({
      root: workspace,
      entries: [{ storeRoot, storeId: "store-opaque", knowledgeBaseId: "base-one" }],
    });
    const output = dependencies.lines.join("\n");
    expect(output).toContain("store store-opaque knowledge-base base-one");
    expect(output).not.toContain(storeRoot);
    expect(output).not.toContain("Private display name");
    expect(output).not.toContain("Private description");
  });

  it("maps multiple alternating pairs and explicit combination approval", async () => {
    const firstRoot = resolve("first-private-store");
    const secondRoot = resolve("second-private-store");
    const workspace = resolve("private-workspace");
    const baseView = knowledgeStoreView();
    const firstView: CandidateKnowledgeStoreView = {
      ...baseView,
      store: { ...baseView.store, id: "store-a" as CandidateKnowledgeStoreView["store"]["id"] },
    };
    const secondView: CandidateKnowledgeStoreView = {
      ...baseView,
      store: { ...baseView.store, id: "store-b" as CandidateKnowledgeStoreView["store"]["id"] },
    };
    const openStore = vi.fn().mockResolvedValueOnce(firstView).mockResolvedValueOnce(secondView);
    const knowledgeService = { openStore } as unknown as CandidateKnowledgeStoreService;
    const dependencies = selectionHarness();

    await createCli({
      service: dependencies.service,
      io: { write: (line) => dependencies.lines.push(line) },
      knowledgeService,
    }).parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "select",
      workspace,
      firstRoot,
      "base-one",
      secondRoot,
      "base-two",
      "--approve-combination",
    ]);

    expect(dependencies.configureKnowledgeSelection).toHaveBeenCalledWith({
      root: workspace,
      entries: [
        { storeRoot: firstRoot, storeId: "store-a", knowledgeBaseId: "base-one" },
        { storeRoot: secondRoot, storeId: "store-b", knowledgeBaseId: "base-two" },
      ],
      combinationApproved: true,
    });
    const output = dependencies.lines.join("\n");
    expect(output).toContain("store store-a knowledge-base base-one");
    expect(output).toContain("store store-b knowledge-base base-two");
    expect(output).not.toContain(firstRoot);
    expect(output).not.toContain(secondRoot);
  });

  it("rejects empty or odd pair sequences before opening stores or writing configuration", async () => {
    const openStore = vi.fn(async () => knowledgeStoreView());
    const knowledgeService = { openStore } as unknown as CandidateKnowledgeStoreService;
    const dependencies = selectionHarness();
    const cli = createCli({
      service: dependencies.service,
      io: { write: (line) => dependencies.lines.push(line) },
      knowledgeService,
    });

    await expect(
      cli.parseAsync(["node", "draft-loop", "knowledge", "select", resolve("workspace")]),
    ).rejects.toThrow("knowledge select requires one or more");
    await expect(
      cli.parseAsync([
        "node",
        "draft-loop",
        "knowledge",
        "select",
        resolve("workspace"),
        resolve("store-only"),
      ]),
    ).rejects.toThrow("knowledge select requires one or more");
    expect(openStore).not.toHaveBeenCalled();
    expect(dependencies.configureKnowledgeSelection).not.toHaveBeenCalled();
    expect(dependencies.lines).toEqual([]);
  });
});
