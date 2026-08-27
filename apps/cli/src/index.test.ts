import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createCli } from "./index.js";
import type {
  AddKnowledgeSourceDirectoryMembersResult,
  ApplicationIo,
  ApplicationService,
  ApplyKnowledgeSourceDirectoryMemberMoveResult,
  ApplyKnowledgeSourceDirectoryReconciliationResult,
  ApplyKnowledgeSourceDirectoryRefreshResult,
  ApplyKnowledgeSourceDirectoryRootRebindResult,
  CandidateKnowledgeSourceManifest,
  CandidateKnowledgeSourceWriteResult,
  CandidateKnowledgeStoreService,
  CandidateKnowledgeStoreView,
  ConfigureKnowledgeSelectionCommand,
  ImportKnowledgeSourceDirectoryResult,
  IndependentReviewRecord,
  InitializeWorkspaceCommand,
  KnowledgeBaseLifecycleReadinessResult,
  KnowledgeSourceDuplicateGroup,
  KnowledgeSourceOriginRebindResult,
  KnowledgeSourceOriginRefreshResult,
  KnowledgeSourceOriginStatusResult,
  KnowledgeSourceRefreshStateResult,
  KnowledgeSourceRetirementResult,
  PreviewKnowledgeSourceDirectoryMovedCandidatesResult,
  PreviewKnowledgeSourceDirectoryReconciliationResult,
  PreviewKnowledgeSourceDirectoryRefreshResult,
  PreviewKnowledgeSourceDirectoryRootRebindResult,
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
    createOpportunity: unreachable("createOpportunity"),
    getOpportunity: unreachable("getOpportunity"),
    listOpportunityVersions: unreachable("listOpportunityVersions"),
    editOpportunity: unreachable("editOpportunity"),
    reviewOpportunity: unreachable("reviewOpportunity"),
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

function knowledgeSourceManifests(): readonly CandidateKnowledgeSourceManifest[] {
  return [
    {
      source: {
        id: "source-b",
        knowledgeBaseId: "base-one",
        kind: "url",
        displayName: "https://private.example/source",
        createdAt: "2026-08-23T10:00:00.000Z",
      },
      versions: [
        {
          id: "version-b2",
          sourceId: "source-b",
          version: 2,
          parentVersionId: "version-b1",
          mediaType: "text/plain",
          checksum: "b".repeat(64),
          sizeBytes: 2,
          createdAt: "2026-08-23T10:02:00.000Z",
        },
        {
          id: "version-b1",
          sourceId: "source-b",
          version: 1,
          mediaType: "text/plain",
          checksum: "a".repeat(64),
          sizeBytes: 1,
          createdAt: "2026-08-23T10:01:00.000Z",
        },
      ],
    },
    {
      source: {
        id: "source-a",
        knowledgeBaseId: "base-one",
        kind: "file",
        displayName: "resume-private.md",
        createdAt: "2026-08-23T10:00:00.000Z",
      },
      versions: [
        {
          id: "version-a1",
          sourceId: "source-a",
          version: 1,
          mediaType: "text/markdown",
          checksum: "c".repeat(64),
          sizeBytes: 3,
          createdAt: "2026-08-23T10:00:00.000Z",
        },
      ],
    },
  ] as unknown as readonly CandidateKnowledgeSourceManifest[];
}

function knowledgeSourceWriteResult(
  created = true,
  kind: "file" | "url" = "file",
  sourceId = "source-imported",
): CandidateKnowledgeSourceWriteResult {
  return {
    source: {
      id: sourceId,
      knowledgeBaseId: "base-one",
      kind,
      displayName: kind === "url" ? "https://private.example/source" : "private-source.md",
      createdAt: "2026-08-23T10:00:00.000Z",
    },
    versions: [
      {
        id: "version-two",
        sourceId,
        version: 2,
        parentVersionId: "version-one",
        mediaType: "text/markdown",
        checksum: "d".repeat(64),
        sizeBytes: 12,
        createdAt: "2026-08-23T10:01:00.000Z",
      },
      {
        id: "version-one",
        sourceId,
        version: 1,
        mediaType: "text/markdown",
        checksum: "e".repeat(64),
        sizeBytes: 10,
        createdAt: "2026-08-23T10:00:00.000Z",
      },
    ],
    created,
  } as unknown as CandidateKnowledgeSourceWriteResult;
}

function knowledgeSourceOriginStatusResult(
  status: KnowledgeSourceOriginStatusResult["status"] = "current",
  sourceId = "source-refresh",
): KnowledgeSourceOriginStatusResult {
  return {
    sourceId,
    checkedAt: "2026-08-23T10:02:00.000Z",
    status,
  };
}

function knowledgeSourceOriginRefreshResult(
  status: KnowledgeSourceOriginRefreshResult["status"] = "current",
  versionId?: string,
  sourceId = "source-refresh",
): KnowledgeSourceOriginRefreshResult {
  return {
    sourceId,
    checkedAt: "2026-08-23T10:02:00.000Z",
    status,
    ...(versionId === undefined ? {} : { versionId }),
  };
}

function knowledgeSourceOriginRebindResult(
  status: KnowledgeSourceOriginRebindResult["status"] = "rebound",
  sourceId = "source-refresh",
): KnowledgeSourceOriginRebindResult {
  return {
    sourceId,
    status,
    boundAt: "2026-08-23T10:03:00.000Z",
  };
}

function knowledgeSourceRetirementResult(
  status: KnowledgeSourceRetirementResult["status"] = "retired",
  sourceId = "source-refresh",
): KnowledgeSourceRetirementResult {
  return status === "active"
    ? { sourceId, status }
    : {
        sourceId,
        status,
        retiredAt: "2026-08-23T10:04:00.000Z",
        reason: "user-requested",
      };
}

function knowledgeSourceRefreshStateResult(
  status: KnowledgeSourceRefreshStateResult["status"] = "current",
  overrides: Partial<KnowledgeSourceRefreshStateResult> = {},
): KnowledgeSourceRefreshStateResult {
  return {
    sourceId: "source-refresh",
    status,
    ...overrides,
  };
}

function knowledgeSourceDirectoryImportResult(
  status: "complete" | "partial" = "complete",
  sources: readonly CandidateKnowledgeSourceWriteResult[] = [
    knowledgeSourceWriteResult(true, "file", "source-b"),
    knowledgeSourceWriteResult(false, "file", "source-a"),
  ],
): ImportKnowledgeSourceDirectoryResult {
  return {
    sources,
    status,
    ...(status === "complete" ? { directoryId: "directory-opaque" } : {}),
    scannedEntryCount: sources.length + 2,
    discoveredFileCount: sources.length,
    skippedEntryCount: 1,
  } as ImportKnowledgeSourceDirectoryResult;
}

function knowledgeSourceDirectoryRootRebindResult(
  status: "current" | "ready" | "rebound" = "ready",
  directoryId = "directory-opaque",
): PreviewKnowledgeSourceDirectoryRootRebindResult | ApplyKnowledgeSourceDirectoryRootRebindResult {
  return {
    directoryId,
    checkedAt: "2026-08-23T10:05:00.000Z",
    status,
    memberCount: 2,
    scannedEntryCount: 4,
    discoveredFileCount: 2,
    skippedEntryCount: 1,
  } as
    | PreviewKnowledgeSourceDirectoryRootRebindResult
    | ApplyKnowledgeSourceDirectoryRootRebindResult;
}

function knowledgeSourceDirectoryRefreshPreviewResult(
  overrides: Partial<PreviewKnowledgeSourceDirectoryRefreshResult> = {},
): PreviewKnowledgeSourceDirectoryRefreshResult {
  return {
    directoryId: "directory-opaque",
    checkedAt: "2026-08-23T10:06:00.000Z",
    members: [
      { sourceId: "source-b", status: "changed" },
      { sourceId: "source-a", status: "current" },
    ],
    newSourceCount: 1,
    scannedEntryCount: 5,
    discoveredFileCount: 3,
    skippedEntryCount: 2,
    ...overrides,
  };
}

function knowledgeSourceDirectoryRefreshApplyResult(
  status: "complete" | "partial" = "complete",
  overrides: Partial<ApplyKnowledgeSourceDirectoryRefreshResult> = {},
): ApplyKnowledgeSourceDirectoryRefreshResult {
  return {
    ...knowledgeSourceDirectoryRefreshPreviewResult(),
    status,
    refreshedSourceIds: status === "partial" ? [] : ["source-b"],
    ...(status === "partial"
      ? { failedSourceId: "source-b", failedStatus: "changed" as const }
      : {}),
    ...overrides,
  } as ApplyKnowledgeSourceDirectoryRefreshResult;
}

function knowledgeSourceDirectoryAddMembersResult(
  status: "complete" | "partial" = "complete",
  overrides: Partial<AddKnowledgeSourceDirectoryMembersResult> = {},
): AddKnowledgeSourceDirectoryMembersResult {
  return {
    ...knowledgeSourceDirectoryRefreshPreviewResult(),
    addedSourceIds: status === "complete" ? ["source-new"] : [],
    addedSourceCount: status === "complete" ? 1 : 0,
    status,
    ...(status === "complete" ? { newSourceCount: 1 } : {}),
    ...overrides,
  } as AddKnowledgeSourceDirectoryMembersResult;
}

function knowledgeSourceDirectoryMovedCandidatesResult(
  overrides: Partial<PreviewKnowledgeSourceDirectoryMovedCandidatesResult> = {},
): PreviewKnowledgeSourceDirectoryMovedCandidatesResult {
  return {
    directoryId: "directory-opaque",
    checkedAt: "2026-08-23T10:07:00.000Z",
    candidates: [
      { sourceId: "source-b", status: "moved-candidate" },
      { sourceId: "source-a", status: "moved-candidate" },
    ],
    candidateCount: 2,
    newSourceCount: 1,
    scannedEntryCount: 5,
    discoveredFileCount: 3,
    skippedEntryCount: 2,
    ...overrides,
  };
}

function knowledgeSourceDirectoryMemberMoveResult(
  status: "moved" | "current" = "moved",
  overrides: Partial<ApplyKnowledgeSourceDirectoryMemberMoveResult> = {},
): ApplyKnowledgeSourceDirectoryMemberMoveResult {
  return {
    directoryId: "directory-opaque",
    sourceId: "source-a",
    checkedAt: "2026-08-23T10:07:00.000Z",
    status,
    ...overrides,
  };
}

function knowledgeSourceDirectoryReconciliationPreviewResult(
  overrides: Partial<PreviewKnowledgeSourceDirectoryReconciliationResult> = {},
): PreviewKnowledgeSourceDirectoryReconciliationResult {
  return {
    directoryId: "directory-opaque",
    checkedAt: "2026-08-23T10:08:00.000Z",
    members: [
      { sourceId: "source-current", status: "current" },
      { sourceId: "source-changed", status: "changed" },
      { sourceId: "source-retired", status: "already-retired" },
      { sourceId: "source-conflicted", status: "conflicted" },
      { sourceId: "source-moved", status: "moved-candidate" },
      { sourceId: "source-missing", status: "missing" },
    ],
    currentCount: 1,
    changedCount: 1,
    alreadyRetiredCount: 1,
    conflictedCount: 1,
    movedCandidateCount: 1,
    missingCount: 1,
    newSourceCount: 1,
    scanStatus: "complete",
    scannedEntryCount: 6,
    discoveredFileCount: 4,
    skippedEntryCount: 0,
    ...overrides,
  };
}

function knowledgeSourceDirectoryReconciliationApplyResult(
  status: "applied" | "current" | "partial" = "applied",
  overrides: Partial<ApplyKnowledgeSourceDirectoryReconciliationResult> = {},
): ApplyKnowledgeSourceDirectoryReconciliationResult {
  return {
    directoryId: "directory-opaque",
    checkedAt: "2026-08-23T10:08:00.000Z",
    status,
    retiredSourceIds: status === "applied" ? ["source-missing"] : [],
    alreadyRetiredSourceIds: status === "current" ? ["source-retired"] : [],
    ...(status === "partial" ? { failedSourceId: "source-missing" } : {}),
    ...overrides,
  } as ApplyKnowledgeSourceDirectoryReconciliationResult;
}

function knowledgeDuplicateGroups(): readonly KnowledgeSourceDuplicateGroup[] {
  return [
    {
      members: [
        { sourceId: "source-b", versionId: "version-b2" },
        { sourceId: "source-a", versionId: "version-a1" },
      ],
    },
  ];
}

function knowledgeInventory(
  complete: boolean,
): Awaited<ReturnType<CandidateKnowledgeStoreService["inspectManagedCandidateKnowledgeFiles"]>> {
  return {
    schemaVersion: 1,
    verifiedManagedFileCount: complete ? 2 : 0,
    scannedEntryCount: complete ? 4 : 1,
    unknownEntries: {
      intakeShapedFilesAtSourcesRoot: complete ? 0 : 1,
      opaqueEntriesAtSourcesRoot: 0,
      entriesInsideManagedSourceDirectories: 0,
      symbolicLinks: complete ? 0 : 1,
      otherEntries: 0,
    },
    complete,
    scanLimitReached: !complete,
  };
}

async function run(dependencies: Harness, ...argv: readonly string[]): Promise<void> {
  await createCli({ service: dependencies.service, io: dependencies.io }).parseAsync([
    "node",
    "draft-loop",
    ...argv,
  ]);
}

describe("draft-loop opportunity commands", () => {
  it("delegates create, reload, list, edit, and review through the shared service", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-cli-opportunity-"));
    const inputPath = join(directory, "opportunity.json");
    const patchPath = join(directory, "patch.json");
    await writeFile(
      inputPath,
      JSON.stringify({
        id: "opportunity-one",
        sources: [
          {
            id: "candidate-guidance",
            kind: "candidate-input",
            classification: "candidate-instruction",
            content: "Use a direct tone.",
            instructions: { tone: "direct" },
          },
        ],
      }),
      "utf8",
    );
    await writeFile(patchPath, JSON.stringify({ issues: [] }), "utf8");
    const dependencies = harness();
    const createCommands: Parameters<ApplicationService["createOpportunity"]>[0][] = [];
    const getCommands: Parameters<ApplicationService["getOpportunity"]>[0][] = [];
    const listCommands: Parameters<ApplicationService["listOpportunityVersions"]>[0][] = [];
    const editCommands: Parameters<ApplicationService["editOpportunity"]>[0][] = [];
    const reviewCommands: Parameters<ApplicationService["reviewOpportunity"]>[0][] = [];
    const record = {
      workspaceId: "workspace-test",
      briefId: "opportunity-one",
      version: 1,
      status: "draft",
      checksum: "a".repeat(64),
      createdAt: "2026-08-28T00:00:00.000Z",
      brief: { id: "opportunity-one", version: 1, status: "draft" },
    } as unknown as Awaited<ReturnType<ApplicationService["createOpportunity"]>>;
    const service: ApplicationService = {
      ...dependencies.service,
      createOpportunity: async (command) => {
        createCommands.push(command);
        return record;
      },
      getOpportunity: async (command) => {
        getCommands.push(command);
        return record;
      },
      listOpportunityVersions: async (command) => {
        listCommands.push(command);
        return [record];
      },
      editOpportunity: async (command) => {
        editCommands.push(command);
        return record;
      },
      reviewOpportunity: async (command) => {
        reviewCommands.push(command);
        return record;
      },
    };
    const invoke = async (...arguments_: readonly string[]) =>
      createCli({ service, io: dependencies.io }).parseAsync(["node", "draft-loop", ...arguments_]);

    try {
      await invoke("opportunity", "create", directory, "--input", inputPath);
      await invoke("opportunity", "get", directory, "--brief-id", "opportunity-one");
      await invoke("opportunity", "list", directory, "--brief-id", "opportunity-one");
      await invoke(
        "opportunity",
        "edit",
        directory,
        "--brief-id",
        "opportunity-one",
        "--expected-version",
        "1",
        "--patch",
        patchPath,
      );
      await invoke(
        "opportunity",
        "review",
        directory,
        "--brief-id",
        "opportunity-one",
        "--expected-version",
        "2",
      );

      expect(createCommands).toEqual([
        {
          root: resolve(directory),
          id: "opportunity-one",
          sources: [
            {
              id: "candidate-guidance",
              kind: "candidate-input",
              classification: "candidate-instruction",
              content: "Use a direct tone.",
              instructions: { tone: "direct" },
            },
          ],
          allowProviderData: false,
        },
      ]);
      expect(getCommands).toEqual([{ root: resolve(directory), briefId: "opportunity-one" }]);
      expect(listCommands).toEqual([{ root: resolve(directory), briefId: "opportunity-one" }]);
      expect(editCommands).toEqual([
        {
          root: resolve(directory),
          briefId: "opportunity-one",
          expectedVersion: 1,
          patch: { issues: [] },
        },
      ]);
      expect(reviewCommands).toEqual([
        { root: resolve(directory), briefId: "opportunity-one", expectedVersion: 2 },
      ]);
      expect(dependencies.lines).toHaveLength(5);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

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

  it("requires backup destination approval and prints only path-free integrity results", async () => {
    const dependencies = harness();
    const storeRoot = resolve("private-candidate-store");
    const destination = resolve("private-backup-destination");
    const portableResult = {
      format: "draft-loop-candidate-knowledge-backup" as const,
      schemaVersion: 1 as const,
      status: "exported" as const,
      descriptorSchemaVersion: 1 as const,
      storeId: "store-opaque",
      createdAt: "2026-08-24T20:00:00.000Z",
      manifestChecksum: "a".repeat(64),
      knowledgeBaseCount: 1,
      sourceCount: 2,
      versionCount: 3,
      contentObjectCount: 3,
      contentBytes: 128,
      integrity: "integrity-verified-not-authenticity" as const,
    };
    const exportCandidateKnowledgeStore = vi.fn(async () => portableResult);
    const inspectCandidateKnowledgeBackup = vi.fn(async () => ({
      ...portableResult,
      status: "valid" as const,
    }));
    const knowledgeService = {
      exportCandidateKnowledgeStore,
      inspectCandidateKnowledgeBackup,
    } as unknown as CandidateKnowledgeStoreService;
    const cli = createCli({
      service: dependencies.service,
      io: dependencies.io,
      knowledgeService,
    });

    await expect(
      cli.parseAsync([
        "node",
        "draft-loop",
        "knowledge",
        "store",
        "backup",
        storeRoot,
        destination,
      ]),
    ).rejects.toThrow(/requires --yes/i);
    expect(exportCandidateKnowledgeStore).not.toHaveBeenCalled();

    await cli.parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "store",
      "backup",
      storeRoot,
      destination,
      "--yes",
    ]);
    await cli.parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "store",
      "inspect-backup",
      destination,
    ]);

    expect(exportCandidateKnowledgeStore).toHaveBeenCalledWith({
      storeRoot,
      destination,
      approved: true,
    });
    expect(inspectCandidateKnowledgeBackup).toHaveBeenCalledWith({ packagePath: destination });
    const output = dependencies.lines.join("\n");
    expect(output).toContain('"status":"exported"');
    expect(output).toContain('"status":"valid"');
    expect(output).toContain('"storeId":"store-opaque"');
    expect(output).not.toContain(storeRoot);
    expect(output).not.toContain(destination);
  });

  it("restores only an explicitly approved backup with the supported collision policy", async () => {
    const dependencies = harness();
    const packagePath = resolve("private-backup-package");
    const destination = resolve("private-restored-store");
    const restoredResult = {
      status: "restored" as const,
      format: "draft-loop-candidate-knowledge-backup" as const,
      schemaVersion: 1 as const,
      storeId: "store-opaque",
      manifestChecksum: "a".repeat(64),
      knowledgeBaseCount: 1,
      sourceCount: 2,
      versionCount: 3,
      contentObjectCount: 3,
      contentBytes: 128,
      integrity: "integrity-verified-not-authenticity" as const,
    };
    const restoreCandidateKnowledgeStore = vi.fn(async () => restoredResult);
    const knowledgeService = {
      restoreCandidateKnowledgeStore,
    } as unknown as CandidateKnowledgeStoreService;
    const cli = createCli({
      service: dependencies.service,
      io: dependencies.io,
      knowledgeService,
    });

    await expect(
      cli.parseAsync([
        "node",
        "draft-loop",
        "knowledge",
        "store",
        "restore",
        packagePath,
        destination,
        "--collision",
        "fail-if-destination-exists",
      ]),
    ).rejects.toThrow(/requires --yes/i);
    expect(restoreCandidateKnowledgeStore).not.toHaveBeenCalled();

    await expect(
      cli.parseAsync([
        "node",
        "draft-loop",
        "knowledge",
        "store",
        "restore",
        packagePath,
        destination,
        "--collision",
        "overwrite",
        "--yes",
      ]),
    ).rejects.toThrow(/fail-if-destination-exists/i);
    expect(restoreCandidateKnowledgeStore).not.toHaveBeenCalled();

    await cli.parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "store",
      "restore",
      packagePath,
      destination,
      "--collision",
      "fail-if-destination-exists",
      "--yes",
    ]);
    expect(restoreCandidateKnowledgeStore).toHaveBeenCalledWith({
      packagePath,
      destination,
      collision: "fail-if-destination-exists",
      approved: true,
    });
    expect(dependencies.lines).toEqual([JSON.stringify(restoredResult)]);
  });
});

describe("candidate knowledge base maintenance CLI controls", () => {
  it("maps create, rename, and confirmed archive to safe store-view output", async () => {
    const dependencies = harness();
    const storeRoot = resolve("private-maintenance-store");
    const view = knowledgeStoreView();
    const archivedView: CandidateKnowledgeStoreView = {
      ...view,
      knowledgeBases: view.knowledgeBases.map((knowledgeBase) =>
        knowledgeBase.id === "base-two"
          ? {
              ...knowledgeBase,
              state: "archived" as const,
              archivedAt: "2026-08-23T11:00:00.000Z",
            }
          : knowledgeBase,
      ),
    };
    const createKnowledgeBase = vi.fn(async () => view);
    const renameKnowledgeBase = vi.fn(async () => view);
    const archiveKnowledgeBase = vi.fn(async () => archivedView);
    const knowledgeService = {
      createKnowledgeBase,
      renameKnowledgeBase,
      archiveKnowledgeBase,
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
      "base",
      "create",
      storeRoot,
      "Private display name",
      "--description",
      "Private description",
    ]);
    await cli.parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "base",
      "rename",
      storeRoot,
      "base-two",
      "Renamed private base",
    ]);
    await cli.parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "base",
      "archive",
      storeRoot,
      "base-two",
      "--confirm",
    ]);

    expect(createKnowledgeBase).toHaveBeenCalledWith({
      storeRoot,
      displayName: "Private display name",
      description: "Private description",
    });
    expect(renameKnowledgeBase).toHaveBeenCalledWith({
      storeRoot,
      knowledgeBaseId: "base-two",
      displayName: "Renamed private base",
    });
    expect(archiveKnowledgeBase).toHaveBeenCalledWith({
      storeRoot,
      knowledgeBaseId: "base-two",
    });
    const output = dependencies.lines.join("\n");
    expect(output).toContain("knowledge store base-created: store-opaque");
    expect(output).toContain("knowledge store base-renamed: store-opaque");
    expect(output).toContain("knowledge store base-archived: store-opaque");
    expect(output).toContain("knowledge base base-two state=archived default=false");
    expect(output).not.toContain(storeRoot);
    expect(output).not.toContain("Private display name");
    expect(output).not.toContain("Private description");
    expect(output).not.toContain("Renamed private base");
  });

  it("requires archive confirmation before calling the service", async () => {
    const dependencies = harness();
    const archiveKnowledgeBase = vi.fn(async () => knowledgeStoreView());
    const knowledgeService = {
      archiveKnowledgeBase,
    } as unknown as CandidateKnowledgeStoreService;

    await expect(
      createCli({
        service: dependencies.service,
        io: dependencies.io,
        knowledgeService,
      }).parseAsync([
        "node",
        "draft-loop",
        "knowledge",
        "base",
        "archive",
        resolve("private-maintenance-store"),
        "base-two",
      ]),
    ).rejects.toThrow("knowledge base archive requires --confirm");
    expect(archiveKnowledgeBase).not.toHaveBeenCalled();
    expect(dependencies.lines).toEqual([]);
  });

  it("previews an exact deletion and requires both its token and explicit approval", async () => {
    const dependencies = harness();
    const storeRoot = resolve("private-maintenance-store");
    const confirmationToken = "a".repeat(64);
    const plan = {
      schemaVersion: 1,
      knowledgeBaseId: "base-two",
      status: "ready",
      confirmationToken,
    } as const;
    const result = {
      schemaVersion: 1,
      knowledgeBaseId: "base-two",
      status: "deleted",
      confirmationToken,
    } as const;
    const previewKnowledgeBaseDeletion = vi.fn(async () => plan);
    const deleteKnowledgeBase = vi.fn(async () => result);
    const knowledgeService = {
      previewKnowledgeBaseDeletion,
      deleteKnowledgeBase,
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
      "base",
      "delete-preview",
      storeRoot,
      "base-two",
    ]);
    await expect(
      cli.parseAsync([
        "node",
        "draft-loop",
        "knowledge",
        "base",
        "delete",
        storeRoot,
        "base-two",
        "--confirmation-token",
        confirmationToken,
      ]),
    ).rejects.toThrow(/requires --yes/i);
    expect(deleteKnowledgeBase).not.toHaveBeenCalled();

    await cli.parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "base",
      "delete",
      storeRoot,
      "base-two",
      "--confirmation-token",
      confirmationToken,
      "--yes",
    ]);

    expect(previewKnowledgeBaseDeletion).toHaveBeenCalledWith({
      storeRoot,
      knowledgeBaseId: "base-two",
    });
    expect(deleteKnowledgeBase).toHaveBeenCalledWith({
      storeRoot,
      knowledgeBaseId: "base-two",
      confirmationToken,
      approved: true,
    });
    expect(dependencies.lines).toEqual([JSON.stringify(plan), JSON.stringify(result)]);
  });

  it("propagates an application maintenance failure without adding CLI output", async () => {
    const dependencies = harness();
    const failure = new Error("application maintenance failure");
    const createKnowledgeBase = vi.fn(async () => {
      throw failure;
    });
    const knowledgeService = {
      createKnowledgeBase,
    } as unknown as CandidateKnowledgeStoreService;

    await expect(
      createCli({
        service: dependencies.service,
        io: dependencies.io,
        knowledgeService,
      }).parseAsync([
        "node",
        "draft-loop",
        "knowledge",
        "base",
        "create",
        resolve("private-maintenance-store"),
        "Base",
      ]),
    ).rejects.toBe(failure);
    expect(dependencies.lines).toEqual([]);
  });
});

describe("candidate knowledge source inspection CLI controls", () => {
  it("requires explicit URL approval before invoking the URL import service", async () => {
    const dependencies = harness();
    const importKnowledgeSourceUrl = vi.fn(async () => knowledgeSourceWriteResult(true, "url"));
    const knowledgeService = {
      importKnowledgeSourceUrl,
    } as unknown as CandidateKnowledgeStoreService;

    await expect(
      createCli({
        service: dependencies.service,
        io: dependencies.io,
        knowledgeService,
      }).parseAsync([
        "node",
        "draft-loop",
        "knowledge",
        "source",
        "import-url",
        resolve("private-url-store"),
        "base-one",
        "https://private.example/cv?token=secret#fragment",
      ]),
    ).rejects.toThrow("knowledge source import-url requires --approve");
    expect(importKnowledgeSourceUrl).not.toHaveBeenCalled();
    expect(dependencies.lines).toEqual([]);
  });

  it("maps an approved URL import and never prints URL or sensitive manifest data", async () => {
    const dependencies = harness();
    const storeRoot = resolve("private-url-store");
    const url = "https://private.example/cv?token=secret#fragment";
    const importKnowledgeSourceUrl = vi.fn(async () => knowledgeSourceWriteResult(true, "url"));
    const knowledgeService = {
      importKnowledgeSourceUrl,
    } as unknown as CandidateKnowledgeStoreService;

    await createCli({
      service: dependencies.service,
      io: dependencies.io,
      knowledgeService,
    }).parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "import-url",
      storeRoot,
      "base-one",
      url,
      "--approve",
      "--display-name",
      "Private URL display name",
    ]);

    expect(importKnowledgeSourceUrl).toHaveBeenCalledWith({
      storeRoot,
      knowledgeBaseId: "base-one",
      url,
      approved: true,
      displayName: "Private URL display name",
    });
    expect(JSON.parse(dependencies.lines[0] ?? "{}")).toEqual({
      knowledgeBaseId: "base-one",
      sourceId: "source-imported",
      kind: "url",
      versionId: "version-two",
      version: 2,
      created: true,
    });
    const output = dependencies.lines.join("\n");
    expect(output).not.toContain(storeRoot);
    expect(output).not.toContain(url);
    expect(output).not.toContain("token=secret");
    expect(output).not.toContain("Private URL display name");
    expect(output).not.toContain("text/markdown");
    expect(output).not.toContain("d".repeat(64));
  });

  it("propagates URL service failures and rejects a file-shaped result", async () => {
    const dependencies = harness();
    const failure = new Error("URL import failed");
    const importKnowledgeSourceUrl = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(knowledgeSourceWriteResult(true, "file"));
    const knowledgeService = {
      importKnowledgeSourceUrl,
    } as unknown as CandidateKnowledgeStoreService;
    const cli = createCli({
      service: dependencies.service,
      io: dependencies.io,
      knowledgeService,
    });
    const command = [
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "import-url",
      resolve("private-url-store"),
      "base-one",
      "https://private.example/cv",
      "--approve",
    ] as const;

    await expect(cli.parseAsync(command)).rejects.toBe(failure);
    await expect(cli.parseAsync(command)).rejects.toThrow(
      "The candidate knowledge source write result was invalid.",
    );
    expect(dependencies.lines).toEqual([]);
  });

  it("maps file import with an optional display name to a safe latest-version JSON result", async () => {
    const dependencies = harness();
    const storeRoot = resolve("private-intake-store");
    const sourcePath = resolve("private-resume.md");
    const knowledgeBaseId = "base-one";
    const importKnowledgeSourceFile = vi.fn(async () => knowledgeSourceWriteResult());
    const knowledgeService = {
      importKnowledgeSourceFile,
    } as unknown as CandidateKnowledgeStoreService;

    await createCli({
      service: dependencies.service,
      io: dependencies.io,
      knowledgeService,
    }).parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "import",
      storeRoot,
      knowledgeBaseId,
      sourcePath,
      "--display-name",
      "Private resume display name",
    ]);

    expect(importKnowledgeSourceFile).toHaveBeenCalledWith({
      storeRoot,
      knowledgeBaseId,
      sourcePath,
      displayName: "Private resume display name",
    });
    expect(JSON.parse(dependencies.lines[0] ?? "{}")).toEqual({
      knowledgeBaseId,
      sourceId: "source-imported",
      kind: "file",
      versionId: "version-two",
      version: 2,
      created: true,
    });
    const output = dependencies.lines.join("\n");
    expect(output).not.toContain(storeRoot);
    expect(output).not.toContain(sourcePath);
    expect(output).not.toContain("private-source.md");
    expect(output).not.toContain("Private resume display name");
    expect(output).not.toContain("text/markdown");
    expect(output).not.toContain("d".repeat(64));
  });

  it("forwards an omitted display name without adding an optional field", async () => {
    const dependencies = harness();
    const importKnowledgeSourceFile = vi.fn(async () => knowledgeSourceWriteResult(false));
    const knowledgeService = {
      importKnowledgeSourceFile,
    } as unknown as CandidateKnowledgeStoreService;

    await createCli({
      service: dependencies.service,
      io: dependencies.io,
      knowledgeService,
    }).parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "import",
      resolve("private-intake-store"),
      "base-one",
      resolve("private-resume.md"),
    ]);

    expect(importKnowledgeSourceFile).toHaveBeenCalledWith({
      storeRoot: resolve("private-intake-store"),
      knowledgeBaseId: "base-one",
      sourcePath: resolve("private-resume.md"),
    });
    expect(JSON.parse(dependencies.lines[0] ?? "{}").created).toBe(false);
  });

  it("maps complete and partial directory imports to deterministic path-free JSON", async () => {
    const dependencies = harness();
    const storeRoot = resolve("private-directory-store");
    const knowledgeBaseId = "base-one";
    const firstDirectory = resolve("private-source-directory");
    const secondDirectory = resolve("private-source-directory-retry");
    const importKnowledgeSourceDirectory = vi
      .fn()
      .mockResolvedValueOnce(knowledgeSourceDirectoryImportResult("complete"))
      .mockResolvedValueOnce(knowledgeSourceDirectoryImportResult("partial"));
    const knowledgeService = {
      importKnowledgeSourceDirectory,
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
      "source",
      "import-directory",
      storeRoot,
      knowledgeBaseId,
      firstDirectory,
    ]);
    await cli.parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "import-directory",
      storeRoot,
      knowledgeBaseId,
      secondDirectory,
    ]);

    expect(importKnowledgeSourceDirectory).toHaveBeenNthCalledWith(1, {
      storeRoot,
      knowledgeBaseId,
      directoryPath: firstDirectory,
    });
    expect(importKnowledgeSourceDirectory).toHaveBeenNthCalledWith(2, {
      storeRoot,
      knowledgeBaseId,
      directoryPath: secondDirectory,
    });
    expect(dependencies.lines.map((line) => JSON.parse(line))).toEqual([
      {
        knowledgeBaseId,
        status: "complete",
        directoryId: "directory-opaque",
        scannedEntryCount: 4,
        discoveredFileCount: 2,
        skippedEntryCount: 1,
        sourceCount: 2,
        sources: [
          {
            sourceId: "source-a",
            versionId: "version-two",
            version: 2,
            created: false,
          },
          {
            sourceId: "source-b",
            versionId: "version-two",
            version: 2,
            created: true,
          },
        ],
        sourcesTruncated: false,
      },
      {
        knowledgeBaseId,
        status: "partial",
        scannedEntryCount: 4,
        discoveredFileCount: 2,
        skippedEntryCount: 1,
        sourceCount: 2,
        sources: [
          {
            sourceId: "source-a",
            versionId: "version-two",
            version: 2,
            created: false,
          },
          {
            sourceId: "source-b",
            versionId: "version-two",
            version: 2,
            created: true,
          },
        ],
        sourcesTruncated: false,
      },
    ]);
    const output = dependencies.lines.join("\n");
    expect(output).not.toContain(storeRoot);
    expect(output).not.toContain(firstDirectory);
    expect(output).not.toContain(secondDirectory);
    expect(output).not.toContain("private-source.md");
    expect(output).not.toContain("text/markdown");
    expect(output).not.toContain("d".repeat(64));
  });

  it("bounds directory import source projections at 256 while preserving total count", async () => {
    const dependencies = harness();
    const sources = Array.from({ length: 300 }, (_, index) =>
      knowledgeSourceWriteResult(
        index % 2 === 0,
        "file",
        `source-${String(index).padStart(3, "0")}`,
      ),
    );
    const importKnowledgeSourceDirectory = vi.fn(async () =>
      knowledgeSourceDirectoryImportResult("complete", sources),
    );
    const knowledgeService = {
      importKnowledgeSourceDirectory,
    } as unknown as CandidateKnowledgeStoreService;

    await createCli({
      service: dependencies.service,
      io: dependencies.io,
      knowledgeService,
    }).parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "import-directory",
      resolve("private-directory-store"),
      "base-one",
      resolve("private-source-directory"),
    ]);

    const output = JSON.parse(dependencies.lines[0] ?? "{}");
    expect(output.sourceCount).toBe(300);
    expect(output.sourcesTruncated).toBe(true);
    expect(output.sources).toHaveLength(256);
    expect(output.sources[0]).toMatchObject({ sourceId: "source-000" });
    expect(output.sources[255]).toMatchObject({ sourceId: "source-255" });
    expect(output.sources.map((source: { sourceId: string }) => source.sourceId)).toEqual(
      [...output.sources]
        .map((source: { sourceId: string }) => source.sourceId)
        .sort((left: string, right: string) => left.localeCompare(right)),
    );
  });

  it("rejects malformed directory import results without emitting output", async () => {
    const dependencies = harness();
    const valid = knowledgeSourceDirectoryImportResult("complete");
    const source = knowledgeSourceWriteResult(true, "file", "source-invalid");
    const malformedResults = [
      { ...valid, directoryId: "" },
      { ...knowledgeSourceDirectoryImportResult("partial"), directoryId: "unexpected" },
      {
        ...valid,
        sources: [{ ...source, source: { ...source.source, knowledgeBaseId: "other-base" } }],
      },
      {
        ...valid,
        sources: [{ ...source, source: { ...source.source, kind: "url" } }],
      },
      {
        ...valid,
        sources: [
          {
            ...source,
            versions: [{ ...source.versions[0], sourceId: "other-source" }],
          },
        ],
      },
      { ...valid, scannedEntryCount: -1 },
      { ...valid, scannedEntryCount: 2, discoveredFileCount: 2, skippedEntryCount: 1 },
      { ...valid, discoveredFileCount: 0 },
      { ...valid, scannedEntryCount: 5, discoveredFileCount: 3 },
      { ...valid, sources: [source, source] },
    ];
    const importKnowledgeSourceDirectory = vi.fn();
    for (const result of malformedResults) {
      importKnowledgeSourceDirectory.mockResolvedValueOnce(
        result as unknown as ImportKnowledgeSourceDirectoryResult,
      );
    }
    const knowledgeService = {
      importKnowledgeSourceDirectory,
    } as unknown as CandidateKnowledgeStoreService;
    const cli = createCli({
      service: dependencies.service,
      io: dependencies.io,
      knowledgeService,
    });
    const command = [
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "import-directory",
      resolve("private-directory-store"),
      "base-one",
      resolve("private-source-directory"),
    ] as const;

    for (let index = 0; index < malformedResults.length; index += 1) {
      await expect(cli.parseAsync(command)).rejects.toThrow(
        "The candidate knowledge source directory result was invalid.",
      );
    }
    expect(importKnowledgeSourceDirectory).toHaveBeenCalledTimes(malformedResults.length);
    expect(dependencies.lines).toEqual([]);
  });

  it("propagates directory import service failures without CLI output", async () => {
    const dependencies = harness();
    const failure = new Error("directory import failed");
    const importKnowledgeSourceDirectory = vi.fn(async () => {
      throw failure;
    });
    const knowledgeService = {
      importKnowledgeSourceDirectory,
    } as unknown as CandidateKnowledgeStoreService;

    await expect(
      createCli({
        service: dependencies.service,
        io: dependencies.io,
        knowledgeService,
      }).parseAsync([
        "node",
        "draft-loop",
        "knowledge",
        "source",
        "import-directory",
        resolve("private-directory-store"),
        "base-one",
        resolve("private-source-directory"),
      ]),
    ).rejects.toBe(failure);
    expect(dependencies.lines).toEqual([]);
  });

  it("maps preview and apply directory-root rebind controls without exposing paths", async () => {
    const dependencies = harness();
    const storeRoot = resolve("private-directory-store");
    const knowledgeBaseId = "base-one";
    const directoryId = "directory-opaque";
    const oldDirectoryPath = resolve("private-old-directory");
    const newDirectoryPath = resolve("private-new-directory");
    const previewKnowledgeSourceDirectoryRootRebind = vi
      .fn()
      .mockResolvedValueOnce({
        ...knowledgeSourceDirectoryRootRebindResult("current"),
        oldRootPath: oldDirectoryPath,
        candidateRootPath: newDirectoryPath,
        relativePathHash: "a".repeat(64),
        content: "private directory content",
      } as unknown as PreviewKnowledgeSourceDirectoryRootRebindResult)
      .mockResolvedValueOnce(knowledgeSourceDirectoryRootRebindResult("ready"));
    const applyKnowledgeSourceDirectoryRootRebind = vi
      .fn()
      .mockResolvedValueOnce(knowledgeSourceDirectoryRootRebindResult("current"))
      .mockResolvedValueOnce(knowledgeSourceDirectoryRootRebindResult("rebound"));
    const knowledgeService = {
      previewKnowledgeSourceDirectoryRootRebind,
      applyKnowledgeSourceDirectoryRootRebind,
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
      "source",
      "directory-rebind-preview",
      storeRoot,
      knowledgeBaseId,
      directoryId,
      oldDirectoryPath,
    ]);
    await cli.parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "directory-rebind-preview",
      storeRoot,
      knowledgeBaseId,
      directoryId,
      newDirectoryPath,
    ]);
    await cli.parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "directory-rebind-apply",
      storeRoot,
      knowledgeBaseId,
      directoryId,
      oldDirectoryPath,
      "--confirm",
    ]);
    await cli.parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "directory-rebind-apply",
      storeRoot,
      knowledgeBaseId,
      directoryId,
      newDirectoryPath,
      "--confirm",
    ]);

    expect(previewKnowledgeSourceDirectoryRootRebind).toHaveBeenNthCalledWith(1, {
      storeRoot,
      knowledgeBaseId,
      directoryId,
      directoryPath: oldDirectoryPath,
    });
    expect(previewKnowledgeSourceDirectoryRootRebind).toHaveBeenNthCalledWith(2, {
      storeRoot,
      knowledgeBaseId,
      directoryId,
      directoryPath: newDirectoryPath,
    });
    expect(applyKnowledgeSourceDirectoryRootRebind).toHaveBeenNthCalledWith(1, {
      storeRoot,
      knowledgeBaseId,
      directoryId,
      directoryPath: oldDirectoryPath,
    });
    expect(applyKnowledgeSourceDirectoryRootRebind).toHaveBeenNthCalledWith(2, {
      storeRoot,
      knowledgeBaseId,
      directoryId,
      directoryPath: newDirectoryPath,
    });
    expect(dependencies.lines.map((line) => JSON.parse(line))).toEqual([
      {
        knowledgeBaseId,
        directoryId,
        checkedAt: "2026-08-23T10:05:00.000Z",
        status: "current",
        memberCount: 2,
        scannedEntryCount: 4,
        discoveredFileCount: 2,
        skippedEntryCount: 1,
      },
      {
        knowledgeBaseId,
        directoryId,
        checkedAt: "2026-08-23T10:05:00.000Z",
        status: "ready",
        memberCount: 2,
        scannedEntryCount: 4,
        discoveredFileCount: 2,
        skippedEntryCount: 1,
      },
      {
        knowledgeBaseId,
        directoryId,
        checkedAt: "2026-08-23T10:05:00.000Z",
        status: "current",
        memberCount: 2,
        scannedEntryCount: 4,
        discoveredFileCount: 2,
        skippedEntryCount: 1,
      },
      {
        knowledgeBaseId,
        directoryId,
        checkedAt: "2026-08-23T10:05:00.000Z",
        status: "rebound",
        memberCount: 2,
        scannedEntryCount: 4,
        discoveredFileCount: 2,
        skippedEntryCount: 1,
      },
    ]);
    const output = dependencies.lines.join("\n");
    expect(output).not.toContain(storeRoot);
    expect(output).not.toContain(oldDirectoryPath);
    expect(output).not.toContain(newDirectoryPath);
    expect(output).not.toContain("a".repeat(64));
    expect(output).not.toContain("private directory content");
  });

  it("requires explicit confirmation before applying a directory-root rebind", async () => {
    const dependencies = harness();
    const applyKnowledgeSourceDirectoryRootRebind = vi.fn(async () =>
      knowledgeSourceDirectoryRootRebindResult("rebound"),
    );
    const knowledgeService = {
      applyKnowledgeSourceDirectoryRootRebind,
    } as unknown as CandidateKnowledgeStoreService;

    await expect(
      createCli({
        service: dependencies.service,
        io: dependencies.io,
        knowledgeService,
      }).parseAsync([
        "node",
        "draft-loop",
        "knowledge",
        "source",
        "directory-rebind-apply",
        resolve("private-directory-store"),
        "base-one",
        "directory-opaque",
        resolve("private-new-directory"),
      ]),
    ).rejects.toThrow("knowledge source directory-rebind-apply requires --confirm");
    expect(applyKnowledgeSourceDirectoryRootRebind).not.toHaveBeenCalled();
    expect(dependencies.lines).toEqual([]);
  });

  it("rejects wrong-phase and malformed directory-root rebind results", async () => {
    const dependencies = harness();
    const valid = knowledgeSourceDirectoryRootRebindResult("ready");
    const previewResults = [
      { ...valid, status: "rebound" },
      { ...valid, directoryId: "other-directory" },
      { ...valid, checkedAt: "not-a-timestamp" },
      { ...valid, memberCount: 1 },
      { ...valid, scannedEntryCount: 2, discoveredFileCount: 2, skippedEntryCount: 1 },
    ];
    const applyResults = [{ ...valid, status: "ready" }];
    const previewKnowledgeSourceDirectoryRootRebind = vi.fn();
    for (const result of previewResults) {
      previewKnowledgeSourceDirectoryRootRebind.mockResolvedValueOnce(
        result as unknown as PreviewKnowledgeSourceDirectoryRootRebindResult,
      );
    }
    const applyKnowledgeSourceDirectoryRootRebind = vi.fn();
    for (const result of applyResults) {
      applyKnowledgeSourceDirectoryRootRebind.mockResolvedValueOnce(
        result as unknown as ApplyKnowledgeSourceDirectoryRootRebindResult,
      );
    }
    const knowledgeService = {
      previewKnowledgeSourceDirectoryRootRebind,
      applyKnowledgeSourceDirectoryRootRebind,
    } as unknown as CandidateKnowledgeStoreService;
    const cli = createCli({
      service: dependencies.service,
      io: dependencies.io,
      knowledgeService,
    });
    const previewCommand = [
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "directory-rebind-preview",
      resolve("private-directory-store"),
      "base-one",
      "directory-opaque",
      resolve("private-new-directory"),
    ] as const;
    const applyCommand = [
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "directory-rebind-apply",
      resolve("private-directory-store"),
      "base-one",
      "directory-opaque",
      resolve("private-new-directory"),
      "--confirm",
    ] as const;

    for (let index = 0; index < previewResults.length; index += 1) {
      await expect(cli.parseAsync(previewCommand)).rejects.toThrow(
        "The candidate knowledge source directory root rebind result was invalid.",
      );
    }
    await expect(cli.parseAsync(applyCommand)).rejects.toThrow(
      "The candidate knowledge source directory root rebind result was invalid.",
    );
    expect(dependencies.lines).toEqual([]);
  });

  it("maps preview and apply directory refresh results with deterministic path-free output", async () => {
    const dependencies = harness();
    const storeRoot = resolve("private-directory-store");
    const knowledgeBaseId = "base-one";
    const directoryId = "directory-opaque";
    const oldDirectoryPath = resolve("private-old-directory");
    const newDirectoryPath = resolve("private-new-directory");
    const previewKnowledgeSourceDirectoryRefresh = vi
      .fn()
      .mockResolvedValueOnce({
        ...knowledgeSourceDirectoryRefreshPreviewResult(),
        oldRootPath: oldDirectoryPath,
        newRootPath: newDirectoryPath,
        relativePathHash: "a".repeat(64),
        content: "private directory content",
      } as unknown as PreviewKnowledgeSourceDirectoryRefreshResult)
      .mockResolvedValueOnce(knowledgeSourceDirectoryRefreshPreviewResult());
    const applyKnowledgeSourceDirectoryRefresh = vi
      .fn()
      .mockResolvedValueOnce(knowledgeSourceDirectoryRefreshApplyResult("complete"))
      .mockResolvedValueOnce(
        knowledgeSourceDirectoryRefreshApplyResult("partial", {
          refreshedSourceIds: [],
          failedSourceId: "source-b",
          failedStatus: "changed",
        }),
      );
    const knowledgeService = {
      previewKnowledgeSourceDirectoryRefresh,
      applyKnowledgeSourceDirectoryRefresh,
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
      "source",
      "directory-refresh-preview",
      storeRoot,
      knowledgeBaseId,
      directoryId,
      "--max-depth",
      "4",
      "--max-scanned-entries",
      "8",
    ]);
    await cli.parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "directory-refresh-preview",
      storeRoot,
      knowledgeBaseId,
      directoryId,
    ]);
    await cli.parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "directory-refresh-apply",
      storeRoot,
      knowledgeBaseId,
      directoryId,
      "--confirm",
      "--max-accepted-files",
      "2",
    ]);
    await cli.parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "directory-refresh-apply",
      storeRoot,
      knowledgeBaseId,
      directoryId,
      "--confirm",
    ]);

    expect(previewKnowledgeSourceDirectoryRefresh).toHaveBeenNthCalledWith(1, {
      storeRoot,
      knowledgeBaseId,
      directoryId,
      options: { maxDepth: 4, maxScannedEntries: 8 },
    });
    expect(previewKnowledgeSourceDirectoryRefresh).toHaveBeenNthCalledWith(2, {
      storeRoot,
      knowledgeBaseId,
      directoryId,
    });
    expect(applyKnowledgeSourceDirectoryRefresh).toHaveBeenNthCalledWith(1, {
      storeRoot,
      knowledgeBaseId,
      directoryId,
      options: { maxAcceptedFiles: 2 },
    });
    expect(applyKnowledgeSourceDirectoryRefresh).toHaveBeenNthCalledWith(2, {
      storeRoot,
      knowledgeBaseId,
      directoryId,
    });
    expect(dependencies.lines.map((line) => JSON.parse(line))).toEqual([
      {
        knowledgeBaseId,
        directoryId,
        checkedAt: "2026-08-23T10:06:00.000Z",
        members: [
          { sourceId: "source-a", status: "current" },
          { sourceId: "source-b", status: "changed" },
        ],
        memberCount: 2,
        membersTruncated: false,
        newSourceCount: 1,
        scannedEntryCount: 5,
        discoveredFileCount: 3,
        skippedEntryCount: 2,
      },
      {
        knowledgeBaseId,
        directoryId,
        checkedAt: "2026-08-23T10:06:00.000Z",
        members: [
          { sourceId: "source-a", status: "current" },
          { sourceId: "source-b", status: "changed" },
        ],
        memberCount: 2,
        membersTruncated: false,
        newSourceCount: 1,
        scannedEntryCount: 5,
        discoveredFileCount: 3,
        skippedEntryCount: 2,
      },
      {
        knowledgeBaseId,
        directoryId,
        checkedAt: "2026-08-23T10:06:00.000Z",
        members: [
          { sourceId: "source-a", status: "current" },
          { sourceId: "source-b", status: "changed" },
        ],
        memberCount: 2,
        membersTruncated: false,
        newSourceCount: 1,
        scannedEntryCount: 5,
        discoveredFileCount: 3,
        skippedEntryCount: 2,
        status: "complete",
        refreshedSourceIds: ["source-b"],
        refreshedSourceCount: 1,
        refreshedSourceIdsTruncated: false,
      },
      {
        knowledgeBaseId,
        directoryId,
        checkedAt: "2026-08-23T10:06:00.000Z",
        members: [
          { sourceId: "source-a", status: "current" },
          { sourceId: "source-b", status: "changed" },
        ],
        memberCount: 2,
        membersTruncated: false,
        newSourceCount: 1,
        scannedEntryCount: 5,
        discoveredFileCount: 3,
        skippedEntryCount: 2,
        status: "partial",
        refreshedSourceIds: [],
        refreshedSourceCount: 0,
        refreshedSourceIdsTruncated: false,
        failedSourceId: "source-b",
        failedStatus: "changed",
      },
    ]);
    const output = dependencies.lines.join("\n");
    expect(output).not.toContain(storeRoot);
    expect(output).not.toContain(oldDirectoryPath);
    expect(output).not.toContain(newDirectoryPath);
    expect(output).not.toContain("a".repeat(64));
    expect(output).not.toContain("private directory content");
  });

  it("requires explicit confirmation before applying a directory refresh", async () => {
    const dependencies = harness();
    const applyKnowledgeSourceDirectoryRefresh = vi.fn(async () =>
      knowledgeSourceDirectoryRefreshApplyResult("complete"),
    );
    const knowledgeService = {
      applyKnowledgeSourceDirectoryRefresh,
    } as unknown as CandidateKnowledgeStoreService;

    await expect(
      createCli({
        service: dependencies.service,
        io: dependencies.io,
        knowledgeService,
      }).parseAsync([
        "node",
        "draft-loop",
        "knowledge",
        "source",
        "directory-refresh-apply",
        resolve("private-directory-store"),
        "base-one",
        "directory-opaque",
      ]),
    ).rejects.toThrow("knowledge source directory-refresh-apply requires --confirm");
    expect(applyKnowledgeSourceDirectoryRefresh).not.toHaveBeenCalled();
    expect(dependencies.lines).toEqual([]);
  });

  it("caps directory refresh arrays only after validating their full contents", async () => {
    const dependencies = harness();
    const members = Array.from({ length: 300 }, (_, index) => ({
      sourceId: `source-${String(index).padStart(3, "0")}`,
      status: "changed" as const,
    }));
    const sourceIds = members.map(({ sourceId }) => sourceId);
    const previewResult = knowledgeSourceDirectoryRefreshPreviewResult({
      members,
      newSourceCount: 0,
      scannedEntryCount: members.length,
      discoveredFileCount: members.length,
      skippedEntryCount: 0,
    });
    const applyResult = {
      ...previewResult,
      status: "complete" as const,
      refreshedSourceIds: sourceIds,
    } as ApplyKnowledgeSourceDirectoryRefreshResult;
    const previewKnowledgeSourceDirectoryRefresh = vi.fn(async () => previewResult);
    const applyKnowledgeSourceDirectoryRefresh = vi.fn(async () => applyResult);
    const knowledgeService = {
      previewKnowledgeSourceDirectoryRefresh,
      applyKnowledgeSourceDirectoryRefresh,
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
      "source",
      "directory-refresh-preview",
      resolve("private-directory-store"),
      "base-one",
      "directory-opaque",
    ]);
    await cli.parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "directory-refresh-apply",
      resolve("private-directory-store"),
      "base-one",
      "directory-opaque",
      "--confirm",
    ]);

    const [previewOutput, applyOutput] = dependencies.lines.map((line) => JSON.parse(line));
    expect(previewOutput).toMatchObject({
      memberCount: 300,
      membersTruncated: true,
      members: members.slice(0, 256),
    });
    expect(applyOutput).toMatchObject({
      status: "complete",
      refreshedSourceCount: 300,
      refreshedSourceIdsTruncated: true,
      refreshedSourceIds: sourceIds.slice(0, 256),
    });
    expect(previewKnowledgeSourceDirectoryRefresh).toHaveBeenCalledOnce();
    expect(applyKnowledgeSourceDirectoryRefresh).toHaveBeenCalledOnce();
  });

  it("rejects wrong-phase and malformed directory refresh results", async () => {
    const dependencies = harness();
    const validPreview = knowledgeSourceDirectoryRefreshPreviewResult();
    const previewResults = [
      { ...validPreview, status: "complete" },
      { ...validPreview, directoryId: "other-directory" },
      { ...validPreview, checkedAt: "not-a-timestamp" },
      { ...validPreview, members: [{ sourceId: "", status: "current" }] },
      { ...validPreview, members: [{ sourceId: "source-a", status: "invalid" }] },
      { ...validPreview, newSourceCount: 4 },
      { ...validPreview, scannedEntryCount: 4 },
    ];
    const applyResults = [
      { ...knowledgeSourceDirectoryRefreshApplyResult("complete"), status: undefined },
      {
        ...knowledgeSourceDirectoryRefreshApplyResult("complete"),
        failedSourceId: "source-b",
        failedStatus: "changed",
      },
      {
        ...knowledgeSourceDirectoryRefreshApplyResult("partial"),
        failedSourceId: undefined,
        failedStatus: undefined,
      },
      {
        ...knowledgeSourceDirectoryRefreshApplyResult("partial"),
        refreshedSourceIds: ["source-a"],
      },
      {
        ...knowledgeSourceDirectoryRefreshApplyResult("partial"),
        refreshedSourceIds: ["source-b"],
      },
    ];
    const previewKnowledgeSourceDirectoryRefresh = vi.fn();
    for (const result of previewResults) {
      previewKnowledgeSourceDirectoryRefresh.mockResolvedValueOnce(
        result as unknown as PreviewKnowledgeSourceDirectoryRefreshResult,
      );
    }
    const applyKnowledgeSourceDirectoryRefresh = vi.fn();
    for (const result of applyResults) {
      applyKnowledgeSourceDirectoryRefresh.mockResolvedValueOnce(
        result as unknown as ApplyKnowledgeSourceDirectoryRefreshResult,
      );
    }
    const knowledgeService = {
      previewKnowledgeSourceDirectoryRefresh,
      applyKnowledgeSourceDirectoryRefresh,
    } as unknown as CandidateKnowledgeStoreService;
    const cli = createCli({
      service: dependencies.service,
      io: dependencies.io,
      knowledgeService,
    });
    const previewCommand = [
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "directory-refresh-preview",
      resolve("private-directory-store"),
      "base-one",
      "directory-opaque",
    ] as const;
    const applyCommand = [
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "directory-refresh-apply",
      resolve("private-directory-store"),
      "base-one",
      "directory-opaque",
      "--confirm",
    ] as const;

    for (let index = 0; index < previewResults.length; index += 1) {
      await expect(cli.parseAsync(previewCommand)).rejects.toThrow(
        "The candidate knowledge source directory refresh result was invalid.",
      );
    }
    for (let index = 0; index < applyResults.length; index += 1) {
      await expect(cli.parseAsync(applyCommand)).rejects.toThrow(
        "The candidate knowledge source directory refresh result was invalid.",
      );
    }
    expect(dependencies.lines).toEqual([]);
  });

  it("propagates directory refresh service failures without CLI output", async () => {
    const dependencies = harness();
    const failure = new Error("directory refresh failed");
    const previewKnowledgeSourceDirectoryRefresh = vi.fn(async () => {
      throw failure;
    });
    const knowledgeService = {
      previewKnowledgeSourceDirectoryRefresh,
    } as unknown as CandidateKnowledgeStoreService;

    await expect(
      createCli({
        service: dependencies.service,
        io: dependencies.io,
        knowledgeService,
      }).parseAsync([
        "node",
        "draft-loop",
        "knowledge",
        "source",
        "directory-refresh-preview",
        resolve("private-directory-store"),
        "base-one",
        "directory-opaque",
      ]),
    ).rejects.toBe(failure);
    expect(dependencies.lines).toEqual([]);
  });

  it("maps directory member additions with deterministic bounded path-free output", async () => {
    const dependencies = harness();
    const storeRoot = resolve("private-directory-store");
    const knowledgeBaseId = "base-one";
    const directoryId = "directory-opaque";
    const privateDirectoryPath = resolve("private-add-members-directory");
    const addKnowledgeSourceDirectoryMembers = vi
      .fn()
      .mockResolvedValueOnce({
        ...knowledgeSourceDirectoryAddMembersResult("complete"),
        privateDirectoryPath,
        relativePathHash: "a".repeat(64),
        content: "private directory content",
      } as unknown as AddKnowledgeSourceDirectoryMembersResult)
      .mockResolvedValueOnce(
        knowledgeSourceDirectoryAddMembersResult("partial", {
          addedSourceIds: ["source-new-a"],
          addedSourceCount: 1,
          newSourceCount: 2,
        }),
      );
    const knowledgeService = {
      addKnowledgeSourceDirectoryMembers,
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
      "source",
      "directory-add-members",
      storeRoot,
      knowledgeBaseId,
      directoryId,
      "--confirm",
      "--max-depth",
      "4",
      "--max-scanned-entries",
      "8",
      "--max-accepted-files",
      "3",
      "--max-accepted-bytes",
      "32",
      "--max-source-bytes",
      "16",
      "--max-chunk-characters",
      "12",
    ]);
    await cli.parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "directory-add-members",
      storeRoot,
      knowledgeBaseId,
      directoryId,
      "--confirm",
      "--max-accepted-files",
      "2",
    ]);

    expect(addKnowledgeSourceDirectoryMembers).toHaveBeenNthCalledWith(1, {
      storeRoot,
      knowledgeBaseId,
      directoryId,
      options: {
        maxDepth: 4,
        maxScannedEntries: 8,
        maxAcceptedFiles: 3,
        maxAcceptedBytes: 32,
        maxSourceBytes: 16,
        maxChunkCharacters: 12,
      },
    });
    expect(addKnowledgeSourceDirectoryMembers).toHaveBeenNthCalledWith(2, {
      storeRoot,
      knowledgeBaseId,
      directoryId,
      options: { maxAcceptedFiles: 2 },
    });
    expect(dependencies.lines.map((line) => JSON.parse(line))).toEqual([
      {
        knowledgeBaseId,
        directoryId,
        checkedAt: "2026-08-23T10:06:00.000Z",
        members: [
          { sourceId: "source-a", status: "current" },
          { sourceId: "source-b", status: "changed" },
        ],
        memberCount: 2,
        membersTruncated: false,
        newSourceCount: 1,
        scannedEntryCount: 5,
        discoveredFileCount: 3,
        skippedEntryCount: 2,
        status: "complete",
        addedSourceIds: ["source-new"],
        addedSourceCount: 1,
        addedSourceIdsTruncated: false,
      },
      {
        knowledgeBaseId,
        directoryId,
        checkedAt: "2026-08-23T10:06:00.000Z",
        members: [
          { sourceId: "source-a", status: "current" },
          { sourceId: "source-b", status: "changed" },
        ],
        memberCount: 2,
        membersTruncated: false,
        newSourceCount: 2,
        scannedEntryCount: 5,
        discoveredFileCount: 3,
        skippedEntryCount: 2,
        status: "partial",
        addedSourceIds: ["source-new-a"],
        addedSourceCount: 1,
        addedSourceIdsTruncated: false,
      },
    ]);
    const output = dependencies.lines.join("\n");
    expect(output).not.toContain(storeRoot);
    expect(output).not.toContain(privateDirectoryPath);
    expect(output).not.toContain("a".repeat(64));
    expect(output).not.toContain("private directory content");
  });

  it("requires explicit confirmation before adding directory members", async () => {
    const dependencies = harness();
    const addKnowledgeSourceDirectoryMembers = vi.fn(async () =>
      knowledgeSourceDirectoryAddMembersResult("complete"),
    );
    const knowledgeService = {
      addKnowledgeSourceDirectoryMembers,
    } as unknown as CandidateKnowledgeStoreService;

    await expect(
      createCli({
        service: dependencies.service,
        io: dependencies.io,
        knowledgeService,
      }).parseAsync([
        "node",
        "draft-loop",
        "knowledge",
        "source",
        "directory-add-members",
        resolve("private-directory-store"),
        "base-one",
        "directory-opaque",
      ]),
    ).rejects.toThrow("knowledge source directory-add-members requires --confirm");
    expect(addKnowledgeSourceDirectoryMembers).not.toHaveBeenCalled();
    expect(dependencies.lines).toEqual([]);
  });

  it("validates complete add-member arrays before truncating them", async () => {
    const dependencies = harness();
    const members = Array.from({ length: 300 }, (_, index) => ({
      sourceId: `source-${String(index).padStart(3, "0")}`,
      status: "current" as const,
    }));
    const addedSourceIds = Array.from(
      { length: 300 },
      (_, index) => `added-${String(index).padStart(3, "0")}`,
    );
    const result = knowledgeSourceDirectoryAddMembersResult("complete", {
      members,
      newSourceCount: addedSourceIds.length,
      discoveredFileCount: addedSourceIds.length,
      scannedEntryCount: addedSourceIds.length,
      skippedEntryCount: 0,
      addedSourceIds,
      addedSourceCount: addedSourceIds.length,
    });
    const addKnowledgeSourceDirectoryMembers = vi.fn(async () => result);
    const knowledgeService = {
      addKnowledgeSourceDirectoryMembers,
    } as unknown as CandidateKnowledgeStoreService;

    await createCli({
      service: dependencies.service,
      io: dependencies.io,
      knowledgeService,
    }).parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "directory-add-members",
      resolve("private-directory-store"),
      "base-one",
      "directory-opaque",
      "--confirm",
    ]);

    const output = JSON.parse(dependencies.lines[0] ?? "{}");
    expect(output.memberCount).toBe(300);
    expect(output.membersTruncated).toBe(true);
    expect(output.members).toEqual(members.slice(0, 256));
    expect(output.addedSourceCount).toBe(300);
    expect(output.addedSourceIdsTruncated).toBe(true);
    expect(output.addedSourceIds).toEqual(addedSourceIds.slice(0, 256));
  });

  it("rejects malformed add-member results without output", async () => {
    const dependencies = harness();
    const valid = knowledgeSourceDirectoryAddMembersResult("complete");
    const results = [
      { ...valid, directoryId: "other-directory" },
      { ...valid, checkedAt: "not-a-timestamp" },
      { ...valid, status: undefined },
      { ...valid, members: [{ sourceId: "", status: "current" }] },
      {
        ...valid,
        members: [
          { sourceId: "source-a", status: "current" },
          { sourceId: "source-a", status: "changed" },
        ],
      },
      { ...valid, members: [{ sourceId: "source-a", status: "invalid" }] },
      { ...valid, addedSourceIds: ["source-new", "source-new"] },
      { ...valid, addedSourceCount: 0 },
      { ...valid, addedSourceIds: [], addedSourceCount: 0 },
      { ...valid, newSourceCount: 0 },
      { ...valid, discoveredFileCount: 4 },
      { ...valid, scannedEntryCount: 4 },
      { ...valid, status: "complete", addedSourceCount: 0, addedSourceIds: [] },
    ];
    const addKnowledgeSourceDirectoryMembers = vi.fn();
    for (const result of results) {
      addKnowledgeSourceDirectoryMembers.mockResolvedValueOnce(
        result as unknown as AddKnowledgeSourceDirectoryMembersResult,
      );
    }
    const knowledgeService = {
      addKnowledgeSourceDirectoryMembers,
    } as unknown as CandidateKnowledgeStoreService;
    const cli = createCli({
      service: dependencies.service,
      io: dependencies.io,
      knowledgeService,
    });
    const command = [
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "directory-add-members",
      resolve("private-directory-store"),
      "base-one",
      "directory-opaque",
      "--confirm",
    ] as const;

    for (let index = 0; index < results.length; index += 1) {
      await expect(cli.parseAsync(command)).rejects.toThrow(
        "The candidate knowledge source directory add-members result was invalid.",
      );
    }
    expect(dependencies.lines).toEqual([]);
  });

  it("maps directory reconciliation preview and apply with bounded path-free output", async () => {
    const dependencies = harness();
    const storeRoot = resolve("private-directory-store");
    const knowledgeBaseId = "base-one";
    const directoryId = "directory-opaque";
    const privateDirectoryPath = resolve("private-reconciliation-directory");
    const previewKnowledgeSourceDirectoryReconciliation = vi.fn().mockResolvedValueOnce({
      ...knowledgeSourceDirectoryReconciliationPreviewResult(),
      privateDirectoryPath,
      privateContent: "private directory content",
      checksum: "a".repeat(64),
    } as unknown as PreviewKnowledgeSourceDirectoryReconciliationResult);
    const applyKnowledgeSourceDirectoryReconciliation = vi
      .fn()
      .mockResolvedValueOnce(knowledgeSourceDirectoryReconciliationApplyResult("applied"))
      .mockResolvedValueOnce(knowledgeSourceDirectoryReconciliationApplyResult("current"))
      .mockResolvedValueOnce(
        knowledgeSourceDirectoryReconciliationApplyResult("partial", {
          retiredSourceIds: ["source-old"],
          alreadyRetiredSourceIds: ["source-retired"],
          failedSourceId: "source-failed",
        }),
      );
    const knowledgeService = {
      previewKnowledgeSourceDirectoryReconciliation,
      applyKnowledgeSourceDirectoryReconciliation,
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
      "source",
      "directory-reconciliation-preview",
      storeRoot,
      knowledgeBaseId,
      directoryId,
      "--max-depth",
      "4",
      "--max-scanned-entries",
      "8",
      "--max-accepted-files",
      "3",
      "--max-accepted-bytes",
      "32",
      "--max-source-bytes",
      "16",
      "--max-chunk-characters",
      "12",
    ]);
    await cli.parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "directory-reconciliation-apply",
      storeRoot,
      knowledgeBaseId,
      directoryId,
      "--approved-retirement-source-id",
      "source-missing",
      "--approved-retirement-source-id",
      "source-retired",
      "--confirm",
      "--max-accepted-files",
      "2",
    ]);
    await cli.parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "directory-reconciliation-apply",
      storeRoot,
      knowledgeBaseId,
      directoryId,
      "--approved-retirement-source-id",
      "source-retired",
      "--confirm",
    ]);
    await cli.parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "directory-reconciliation-apply",
      storeRoot,
      knowledgeBaseId,
      directoryId,
      "--approved-retirement-source-id",
      "source-old",
      "--approved-retirement-source-id",
      "source-retired",
      "--approved-retirement-source-id",
      "source-failed",
      "--confirm",
    ]);

    expect(previewKnowledgeSourceDirectoryReconciliation).toHaveBeenCalledWith({
      storeRoot,
      knowledgeBaseId,
      directoryId,
      options: {
        maxDepth: 4,
        maxScannedEntries: 8,
        maxAcceptedFiles: 3,
        maxAcceptedBytes: 32,
        maxSourceBytes: 16,
        maxChunkCharacters: 12,
      },
    });
    expect(applyKnowledgeSourceDirectoryReconciliation).toHaveBeenNthCalledWith(1, {
      storeRoot,
      knowledgeBaseId,
      directoryId,
      approvedRetirementSourceIds: ["source-missing", "source-retired"],
      options: { maxAcceptedFiles: 2 },
    });
    expect(applyKnowledgeSourceDirectoryReconciliation).toHaveBeenNthCalledWith(2, {
      storeRoot,
      knowledgeBaseId,
      directoryId,
      approvedRetirementSourceIds: ["source-retired"],
    });
    expect(applyKnowledgeSourceDirectoryReconciliation).toHaveBeenNthCalledWith(3, {
      storeRoot,
      knowledgeBaseId,
      directoryId,
      approvedRetirementSourceIds: ["source-old", "source-retired", "source-failed"],
    });
    expect(dependencies.lines.map((line) => JSON.parse(line))).toEqual([
      {
        knowledgeBaseId,
        directoryId,
        checkedAt: "2026-08-23T10:08:00.000Z",
        members: [
          { sourceId: "source-changed", status: "changed" },
          { sourceId: "source-conflicted", status: "conflicted" },
          { sourceId: "source-current", status: "current" },
          { sourceId: "source-missing", status: "missing" },
          { sourceId: "source-moved", status: "moved-candidate" },
          { sourceId: "source-retired", status: "already-retired" },
        ],
        memberCount: 6,
        membersTruncated: false,
        currentCount: 1,
        changedCount: 1,
        alreadyRetiredCount: 1,
        conflictedCount: 1,
        movedCandidateCount: 1,
        missingCount: 1,
        newSourceCount: 1,
        scanStatus: "complete",
        scannedEntryCount: 6,
        discoveredFileCount: 4,
        skippedEntryCount: 0,
      },
      {
        knowledgeBaseId,
        directoryId,
        checkedAt: "2026-08-23T10:08:00.000Z",
        status: "applied",
        retiredSourceIds: ["source-missing"],
        retiredSourceCount: 1,
        retiredSourceIdsTruncated: false,
        alreadyRetiredSourceIds: [],
        alreadyRetiredSourceCount: 0,
        alreadyRetiredSourceIdsTruncated: false,
      },
      {
        knowledgeBaseId,
        directoryId,
        checkedAt: "2026-08-23T10:08:00.000Z",
        status: "current",
        retiredSourceIds: [],
        retiredSourceCount: 0,
        retiredSourceIdsTruncated: false,
        alreadyRetiredSourceIds: ["source-retired"],
        alreadyRetiredSourceCount: 1,
        alreadyRetiredSourceIdsTruncated: false,
      },
      {
        knowledgeBaseId,
        directoryId,
        checkedAt: "2026-08-23T10:08:00.000Z",
        status: "partial",
        retiredSourceIds: ["source-old"],
        retiredSourceCount: 1,
        retiredSourceIdsTruncated: false,
        alreadyRetiredSourceIds: ["source-retired"],
        alreadyRetiredSourceCount: 1,
        alreadyRetiredSourceIdsTruncated: false,
        failedSourceId: "source-failed",
      },
    ]);
    const output = dependencies.lines.join("\n");
    expect(output).not.toContain(storeRoot);
    expect(output).not.toContain(privateDirectoryPath);
    expect(output).not.toContain("private directory content");
    expect(output).not.toContain("a".repeat(64));
  });

  it("requires confirmation before invoking directory reconciliation apply", async () => {
    const dependencies = harness();
    const applyKnowledgeSourceDirectoryReconciliation = vi.fn(async () =>
      knowledgeSourceDirectoryReconciliationApplyResult("applied"),
    );
    const knowledgeService = {
      applyKnowledgeSourceDirectoryReconciliation,
    } as unknown as CandidateKnowledgeStoreService;

    await expect(
      createCli({
        service: dependencies.service,
        io: dependencies.io,
        knowledgeService,
      }).parseAsync([
        "node",
        "draft-loop",
        "knowledge",
        "source",
        "directory-reconciliation-apply",
        resolve("private-directory-store"),
        "base-one",
        "directory-opaque",
        "--approved-retirement-source-id",
        "source-missing",
      ]),
    ).rejects.toThrow("knowledge source directory-reconciliation-apply requires --confirm");
    expect(applyKnowledgeSourceDirectoryReconciliation).not.toHaveBeenCalled();
    expect(dependencies.lines).toEqual([]);
  });

  it("validates full directory reconciliation arrays and phase invariants", async () => {
    const dependencies = harness();
    const validPreview = knowledgeSourceDirectoryReconciliationPreviewResult();
    const previewResults = [
      { ...validPreview, status: "preview" },
      { ...validPreview, directoryId: "other-directory" },
      { ...validPreview, checkedAt: "not-a-timestamp" },
      { ...validPreview, members: [{ sourceId: "source-a", status: "current" }], currentCount: 0 },
      {
        ...validPreview,
        members: [
          { sourceId: "source-a", status: "current" },
          { sourceId: "source-a", status: "changed" },
        ],
        currentCount: 1,
        changedCount: 1,
        alreadyRetiredCount: 0,
        conflictedCount: 0,
        movedCandidateCount: 0,
        missingCount: 0,
      },
      { ...validPreview, scanStatus: "incomplete", skippedEntryCount: 0 },
      { ...validPreview, scanStatus: "complete", skippedEntryCount: 1 },
      { ...validPreview, discoveredFileCount: 7 },
    ];
    const previewKnowledgeSourceDirectoryReconciliation = vi.fn();
    for (const result of previewResults) {
      previewKnowledgeSourceDirectoryReconciliation.mockResolvedValueOnce(
        result as unknown as PreviewKnowledgeSourceDirectoryReconciliationResult,
      );
    }

    const validApplied = knowledgeSourceDirectoryReconciliationApplyResult("applied");
    const validCurrent = knowledgeSourceDirectoryReconciliationApplyResult("current");
    const validPartial = knowledgeSourceDirectoryReconciliationApplyResult("partial");
    const applyResults = [
      { ...validApplied, status: "invalid" },
      { ...validApplied, retiredSourceIds: ["source-a", "source-a"] },
      { ...validApplied, retiredSourceIds: ["source-a"], alreadyRetiredSourceIds: ["source-a"] },
      { ...validApplied, retiredSourceIds: [] },
      { ...validCurrent, retiredSourceIds: ["source-a"] },
      { ...validCurrent, failedSourceId: "source-failed" },
      { ...validPartial, failedSourceId: undefined },
      { ...validPartial, retiredSourceIds: ["source-missing"] },
    ];
    const applyKnowledgeSourceDirectoryReconciliation = vi.fn();
    for (const result of applyResults) {
      applyKnowledgeSourceDirectoryReconciliation.mockResolvedValueOnce(
        result as unknown as ApplyKnowledgeSourceDirectoryReconciliationResult,
      );
    }
    const knowledgeService = {
      previewKnowledgeSourceDirectoryReconciliation,
      applyKnowledgeSourceDirectoryReconciliation,
    } as unknown as CandidateKnowledgeStoreService;
    const cli = createCli({
      service: dependencies.service,
      io: dependencies.io,
      knowledgeService,
    });
    const previewCommand = [
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "directory-reconciliation-preview",
      resolve("private-directory-store"),
      "base-one",
      "directory-opaque",
    ] as const;
    const applyCommand = [
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "directory-reconciliation-apply",
      resolve("private-directory-store"),
      "base-one",
      "directory-opaque",
      "--approved-retirement-source-id",
      "source-a",
      "--approved-retirement-source-id",
      "source-missing",
      "--approved-retirement-source-id",
      "source-retired",
      "--approved-retirement-source-id",
      "source-failed",
      "--confirm",
    ] as const;

    for (let index = 0; index < previewResults.length; index += 1) {
      await expect(cli.parseAsync(previewCommand)).rejects.toThrow(
        "The candidate knowledge source directory reconciliation result was invalid.",
      );
    }
    for (let index = 0; index < applyResults.length; index += 1) {
      await expect(cli.parseAsync(applyCommand)).rejects.toThrow(
        "The candidate knowledge source directory reconciliation result was invalid.",
      );
    }
    expect(dependencies.lines).toEqual([]);
  });

  it("caps directory reconciliation arrays after validating their full contents", async () => {
    const dependencies = harness();
    const members = Array.from({ length: 300 }, (_, index) => ({
      sourceId: `source-${String(index).padStart(3, "0")}`,
      status: "current" as const,
    }));
    const sourceIds = members.map(({ sourceId }) => sourceId);
    const previewResult = knowledgeSourceDirectoryReconciliationPreviewResult({
      members,
      currentCount: members.length,
      changedCount: 0,
      alreadyRetiredCount: 0,
      conflictedCount: 0,
      movedCandidateCount: 0,
      missingCount: 0,
      newSourceCount: 0,
      scannedEntryCount: members.length,
      discoveredFileCount: members.length,
      skippedEntryCount: 0,
    });
    const applyResult = knowledgeSourceDirectoryReconciliationApplyResult("applied", {
      retiredSourceIds: sourceIds,
    });
    const previewKnowledgeSourceDirectoryReconciliation = vi.fn(async () => previewResult);
    const applyKnowledgeSourceDirectoryReconciliation = vi.fn(async () => applyResult);
    const knowledgeService = {
      previewKnowledgeSourceDirectoryReconciliation,
      applyKnowledgeSourceDirectoryReconciliation,
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
      "source",
      "directory-reconciliation-preview",
      resolve("private-directory-store"),
      "base-one",
      "directory-opaque",
    ]);
    await cli.parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "directory-reconciliation-apply",
      resolve("private-directory-store"),
      "base-one",
      "directory-opaque",
      ...sourceIds.flatMap((sourceId) => ["--approved-retirement-source-id", sourceId]),
      "--confirm",
    ]);

    const [previewOutput, applyOutput] = dependencies.lines.map((line) => JSON.parse(line));
    expect(previewOutput.memberCount).toBe(300);
    expect(previewOutput.membersTruncated).toBe(true);
    expect(previewOutput.members).toEqual(members.slice(0, 256));
    expect(applyOutput.status).toBe("applied");
    expect(applyOutput.retiredSourceCount).toBe(300);
    expect(applyOutput.retiredSourceIdsTruncated).toBe(true);
    expect(applyOutput.retiredSourceIds).toEqual(sourceIds.slice(0, 256));
  });

  it("maps moved-candidate preview and member moves with bounded path-free output", async () => {
    const dependencies = harness();
    const storeRoot = resolve("private-directory-store");
    const knowledgeBaseId = "base-one";
    const directoryId = "directory-opaque";
    const sourceId = "source-a";
    const privateDirectoryPath = resolve("private-moved-directory");
    const previewKnowledgeSourceDirectoryMovedCandidates = vi
      .fn()
      .mockResolvedValueOnce({
        ...knowledgeSourceDirectoryMovedCandidatesResult(),
        privateDirectoryPath,
        checksum: "a".repeat(64),
        content: "private directory content",
      } as unknown as PreviewKnowledgeSourceDirectoryMovedCandidatesResult)
      .mockResolvedValueOnce(knowledgeSourceDirectoryMovedCandidatesResult());
    const applyKnowledgeSourceDirectoryMemberMove = vi
      .fn()
      .mockResolvedValueOnce(knowledgeSourceDirectoryMemberMoveResult("moved"))
      .mockResolvedValueOnce(knowledgeSourceDirectoryMemberMoveResult("current"));
    const knowledgeService = {
      previewKnowledgeSourceDirectoryMovedCandidates,
      applyKnowledgeSourceDirectoryMemberMove,
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
      "source",
      "directory-moved-candidates",
      storeRoot,
      knowledgeBaseId,
      directoryId,
      "--max-depth",
      "4",
      "--max-scanned-entries",
      "8",
      "--max-accepted-files",
      "3",
      "--max-accepted-bytes",
      "32",
      "--max-source-bytes",
      "16",
      "--max-chunk-characters",
      "12",
    ]);
    await cli.parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "directory-member-move",
      storeRoot,
      knowledgeBaseId,
      directoryId,
      sourceId,
      "--confirm",
      "--max-accepted-files",
      "2",
    ]);
    await cli.parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "directory-member-move",
      storeRoot,
      knowledgeBaseId,
      directoryId,
      sourceId,
      "--confirm",
    ]);

    expect(previewKnowledgeSourceDirectoryMovedCandidates).toHaveBeenNthCalledWith(1, {
      storeRoot,
      knowledgeBaseId,
      directoryId,
      options: {
        maxDepth: 4,
        maxScannedEntries: 8,
        maxAcceptedFiles: 3,
        maxAcceptedBytes: 32,
        maxSourceBytes: 16,
        maxChunkCharacters: 12,
      },
    });
    expect(applyKnowledgeSourceDirectoryMemberMove).toHaveBeenNthCalledWith(1, {
      storeRoot,
      knowledgeBaseId,
      directoryId,
      sourceId,
      options: { maxAcceptedFiles: 2 },
    });
    expect(applyKnowledgeSourceDirectoryMemberMove).toHaveBeenNthCalledWith(2, {
      storeRoot,
      knowledgeBaseId,
      directoryId,
      sourceId,
    });
    expect(dependencies.lines.map((line) => JSON.parse(line))).toEqual([
      {
        knowledgeBaseId,
        directoryId,
        checkedAt: "2026-08-23T10:07:00.000Z",
        candidates: [
          { sourceId: "source-a", status: "moved-candidate" },
          { sourceId: "source-b", status: "moved-candidate" },
        ],
        candidateCount: 2,
        candidatesTruncated: false,
        newSourceCount: 1,
        scannedEntryCount: 5,
        discoveredFileCount: 3,
        skippedEntryCount: 2,
      },
      {
        knowledgeBaseId,
        directoryId,
        sourceId,
        checkedAt: "2026-08-23T10:07:00.000Z",
        status: "moved",
      },
      {
        knowledgeBaseId,
        directoryId,
        sourceId,
        checkedAt: "2026-08-23T10:07:00.000Z",
        status: "current",
      },
    ]);
    const output = dependencies.lines.join("\n");
    expect(output).not.toContain(storeRoot);
    expect(output).not.toContain(privateDirectoryPath);
    expect(output).not.toContain("private directory content");
    expect(output).not.toContain("a".repeat(64));
  });

  it("requires explicit confirmation before applying a directory member move", async () => {
    const dependencies = harness();
    const applyKnowledgeSourceDirectoryMemberMove = vi.fn(async () =>
      knowledgeSourceDirectoryMemberMoveResult(),
    );
    const knowledgeService = {
      applyKnowledgeSourceDirectoryMemberMove,
    } as unknown as CandidateKnowledgeStoreService;

    await expect(
      createCli({
        service: dependencies.service,
        io: dependencies.io,
        knowledgeService,
      }).parseAsync([
        "node",
        "draft-loop",
        "knowledge",
        "source",
        "directory-member-move",
        resolve("private-directory-store"),
        "base-one",
        "directory-opaque",
        "source-a",
      ]),
    ).rejects.toThrow("knowledge source directory-member-move requires --confirm");
    expect(applyKnowledgeSourceDirectoryMemberMove).not.toHaveBeenCalled();
    expect(dependencies.lines).toEqual([]);
  });

  it("validates complete moved-candidate results before truncating and projecting them", async () => {
    const dependencies = harness();
    const candidates = Array.from({ length: 300 }, (_, index) => ({
      sourceId: `source-${String(index).padStart(3, "0")}`,
      status: "moved-candidate" as const,
    }));
    const previewResult = knowledgeSourceDirectoryMovedCandidatesResult({
      candidates,
      candidateCount: candidates.length,
      newSourceCount: 0,
      scannedEntryCount: candidates.length,
      discoveredFileCount: candidates.length,
      skippedEntryCount: 0,
    });
    const previewKnowledgeSourceDirectoryMovedCandidates = vi.fn(async () => previewResult);
    const knowledgeService = {
      previewKnowledgeSourceDirectoryMovedCandidates,
    } as unknown as CandidateKnowledgeStoreService;

    await createCli({
      service: dependencies.service,
      io: dependencies.io,
      knowledgeService,
    }).parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "directory-moved-candidates",
      resolve("private-directory-store"),
      "base-one",
      "directory-opaque",
    ]);

    const output = JSON.parse(dependencies.lines[0] ?? "{}");
    expect(output.candidateCount).toBe(300);
    expect(output.candidatesTruncated).toBe(true);
    expect(output.candidates).toHaveLength(256);
    expect(output.candidates[0]).toEqual({
      sourceId: "source-000",
      status: "moved-candidate",
    });
    expect(output.candidates[255]).toEqual({
      sourceId: "source-255",
      status: "moved-candidate",
    });
    expect(output.candidates.map((candidate: { sourceId: string }) => candidate.sourceId)).toEqual(
      candidates.slice(0, 256).map(({ sourceId }) => sourceId),
    );
  });

  it("rejects malformed moved-candidate and member-move results without output", async () => {
    const dependencies = harness();
    const validPreview = knowledgeSourceDirectoryMovedCandidatesResult();
    const previewResults = [
      { ...validPreview, directoryId: "other-directory" },
      { ...validPreview, checkedAt: "not-a-timestamp" },
      { ...validPreview, candidateCount: 1 },
      { ...validPreview, candidates: [{ sourceId: "", status: "moved-candidate" }] },
      {
        ...validPreview,
        candidates: [
          { sourceId: "source-a", status: "moved-candidate" },
          { sourceId: "source-a", status: "moved-candidate" },
        ],
        candidateCount: 2,
      },
      {
        ...validPreview,
        candidates: [{ sourceId: "source-a", status: "current" }],
        candidateCount: 1,
      },
      { ...validPreview, newSourceCount: 4 },
      { ...validPreview, scannedEntryCount: 4 },
    ];
    const previewKnowledgeSourceDirectoryMovedCandidates = vi.fn();
    for (const result of previewResults) {
      previewKnowledgeSourceDirectoryMovedCandidates.mockResolvedValueOnce(
        result as unknown as PreviewKnowledgeSourceDirectoryMovedCandidatesResult,
      );
    }
    const validMove = knowledgeSourceDirectoryMemberMoveResult();
    const moveResults = [
      { ...validMove, directoryId: "other-directory" },
      { ...validMove, sourceId: "other-source" },
      { ...validMove, checkedAt: "not-a-timestamp" },
      { ...validMove, status: "invalid" },
    ];
    const applyKnowledgeSourceDirectoryMemberMove = vi.fn();
    for (const result of moveResults) {
      applyKnowledgeSourceDirectoryMemberMove.mockResolvedValueOnce(
        result as unknown as ApplyKnowledgeSourceDirectoryMemberMoveResult,
      );
    }
    const knowledgeService = {
      previewKnowledgeSourceDirectoryMovedCandidates,
      applyKnowledgeSourceDirectoryMemberMove,
    } as unknown as CandidateKnowledgeStoreService;
    const cli = createCli({
      service: dependencies.service,
      io: dependencies.io,
      knowledgeService,
    });
    const previewCommand = [
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "directory-moved-candidates",
      resolve("private-directory-store"),
      "base-one",
      "directory-opaque",
    ] as const;
    const moveCommand = [
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "directory-member-move",
      resolve("private-directory-store"),
      "base-one",
      "directory-opaque",
      "source-a",
      "--confirm",
    ] as const;

    for (let index = 0; index < previewResults.length; index += 1) {
      await expect(cli.parseAsync(previewCommand)).rejects.toThrow(
        "The candidate knowledge source directory moved-candidate result was invalid.",
      );
    }
    for (let index = 0; index < moveResults.length; index += 1) {
      await expect(cli.parseAsync(moveCommand)).rejects.toThrow(
        "The candidate knowledge source directory member move result was invalid.",
      );
    }
    expect(dependencies.lines).toEqual([]);
  });

  it("maps changed and identical file-version appends to safe latest-version JSON", async () => {
    const dependencies = harness();
    const storeRoot = resolve("private-append-store");
    const knowledgeBaseId = "base-one";
    const sourceId = "source-append";
    const changedPath = resolve("private-resume-updated.md");
    const identicalPath = resolve("private-resume-copy.md");
    const appendKnowledgeSourceFileVersion = vi
      .fn()
      .mockResolvedValueOnce(knowledgeSourceWriteResult(true, "file", sourceId))
      .mockResolvedValueOnce(knowledgeSourceWriteResult(false, "file", sourceId));
    const knowledgeService = {
      appendKnowledgeSourceFileVersion,
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
      "source",
      "append-file-version",
      storeRoot,
      knowledgeBaseId,
      sourceId,
      changedPath,
    ]);
    await cli.parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "append-file-version",
      storeRoot,
      knowledgeBaseId,
      sourceId,
      identicalPath,
    ]);

    expect(appendKnowledgeSourceFileVersion).toHaveBeenNthCalledWith(1, {
      storeRoot,
      knowledgeBaseId,
      sourceId,
      sourcePath: changedPath,
    });
    expect(appendKnowledgeSourceFileVersion).toHaveBeenNthCalledWith(2, {
      storeRoot,
      knowledgeBaseId,
      sourceId,
      sourcePath: identicalPath,
    });
    expect(dependencies.lines.map((line) => JSON.parse(line))).toEqual([
      {
        knowledgeBaseId,
        sourceId,
        kind: "file",
        versionId: "version-two",
        version: 2,
        created: true,
      },
      {
        knowledgeBaseId,
        sourceId,
        kind: "file",
        versionId: "version-two",
        version: 2,
        created: false,
      },
    ]);
    const output = dependencies.lines.join("\n");
    expect(output).not.toContain(storeRoot);
    expect(output).not.toContain(changedPath);
    expect(output).not.toContain(identicalPath);
    expect(output).not.toContain("private-source.md");
    expect(output).not.toContain("text/markdown");
    expect(output).not.toContain("d".repeat(64));
  });

  it("propagates append failures and rejects wrong-source or wrong-kind results", async () => {
    const dependencies = harness();
    const failure = new Error("file version append failed");
    const appendKnowledgeSourceFileVersion = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(knowledgeSourceWriteResult(true, "file", "other-source"))
      .mockResolvedValueOnce(knowledgeSourceWriteResult(true, "url", "source-append"));
    const knowledgeService = {
      appendKnowledgeSourceFileVersion,
    } as unknown as CandidateKnowledgeStoreService;
    const cli = createCli({
      service: dependencies.service,
      io: dependencies.io,
      knowledgeService,
    });
    const command = [
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "append-file-version",
      resolve("private-append-store"),
      "base-one",
      "source-append",
      resolve("private-resume.md"),
    ] as const;

    await expect(cli.parseAsync(command)).rejects.toBe(failure);
    await expect(cli.parseAsync(command)).rejects.toThrow(
      "The candidate knowledge source write result was invalid.",
    );
    await expect(cli.parseAsync(command)).rejects.toThrow(
      "The candidate knowledge source write result was invalid.",
    );
    expect(appendKnowledgeSourceFileVersion).toHaveBeenCalledTimes(3);
    expect(dependencies.lines).toEqual([]);
  });

  it("maps rebind and retirement controls with strict path-free status projections", async () => {
    const dependencies = harness();
    const storeRoot = resolve("private-lifecycle-store");
    const knowledgeBaseId = "base-one";
    const sourceId = "source-refresh";
    const sourcePath = resolve("private-origin.md");
    const rebindKnowledgeSourceOrigin = vi
      .fn()
      .mockResolvedValueOnce(knowledgeSourceOriginRebindResult("current"))
      .mockResolvedValueOnce({
        ...knowledgeSourceOriginRebindResult("rebound"),
        originPath: sourcePath,
        displayName: "Private origin label",
        checksum: "f".repeat(64),
      } as unknown as KnowledgeSourceOriginRebindResult);
    const getKnowledgeSourceRetirement = vi
      .fn()
      .mockResolvedValueOnce(knowledgeSourceRetirementResult("active"))
      .mockResolvedValueOnce({
        ...knowledgeSourceRetirementResult("retired"),
        originPath: sourcePath,
        content: "private content",
      } as unknown as KnowledgeSourceRetirementResult);
    const retireKnowledgeSource = vi.fn(async () => knowledgeSourceRetirementResult("retired"));
    const knowledgeService = {
      rebindKnowledgeSourceOrigin,
      getKnowledgeSourceRetirement,
      retireKnowledgeSource,
    } as unknown as CandidateKnowledgeStoreService;
    const cli = createCli({
      service: dependencies.service,
      io: dependencies.io,
      knowledgeService,
    });

    for (let index = 0; index < 2; index += 1) {
      await cli.parseAsync([
        "node",
        "draft-loop",
        "knowledge",
        "source",
        "rebind-file",
        storeRoot,
        knowledgeBaseId,
        sourceId,
        sourcePath,
      ]);
    }
    await cli.parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "retirement-state",
      storeRoot,
      knowledgeBaseId,
      sourceId,
    ]);
    await cli.parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "retirement-state",
      storeRoot,
      knowledgeBaseId,
      sourceId,
    ]);
    await cli.parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "retire",
      storeRoot,
      knowledgeBaseId,
      sourceId,
      "--confirm",
    ]);

    expect(rebindKnowledgeSourceOrigin).toHaveBeenNthCalledWith(1, {
      storeRoot,
      knowledgeBaseId,
      sourceId,
      sourcePath,
    });
    expect(rebindKnowledgeSourceOrigin).toHaveBeenNthCalledWith(2, {
      storeRoot,
      knowledgeBaseId,
      sourceId,
      sourcePath,
    });
    expect(getKnowledgeSourceRetirement).toHaveBeenCalledTimes(2);
    expect(retireKnowledgeSource).toHaveBeenCalledWith({
      storeRoot,
      knowledgeBaseId,
      sourceId,
    });
    expect(dependencies.lines.map((line) => JSON.parse(line))).toEqual([
      {
        knowledgeBaseId,
        sourceId,
        status: "current",
        boundAt: "2026-08-23T10:03:00.000Z",
      },
      {
        knowledgeBaseId,
        sourceId,
        status: "rebound",
        boundAt: "2026-08-23T10:03:00.000Z",
      },
      {
        knowledgeBaseId,
        sourceId,
        status: "active",
      },
      {
        knowledgeBaseId,
        sourceId,
        status: "retired",
        retiredAt: "2026-08-23T10:04:00.000Z",
        reason: "user-requested",
      },
      {
        knowledgeBaseId,
        sourceId,
        status: "retired",
        retiredAt: "2026-08-23T10:04:00.000Z",
        reason: "user-requested",
      },
    ]);
    const output = dependencies.lines.join("\n");
    expect(output).not.toContain(storeRoot);
    expect(output).not.toContain(sourcePath);
    expect(output).not.toContain("Private origin label");
    expect(output).not.toContain("private content");
    expect(output).not.toContain("f".repeat(64));
  });

  it("requires retirement confirmation before invoking the retirement service", async () => {
    const dependencies = harness();
    const retireKnowledgeSource = vi.fn(async () => knowledgeSourceRetirementResult("active"));
    const knowledgeService = {
      retireKnowledgeSource,
    } as unknown as CandidateKnowledgeStoreService;

    await expect(
      createCli({
        service: dependencies.service,
        io: dependencies.io,
        knowledgeService,
      }).parseAsync([
        "node",
        "draft-loop",
        "knowledge",
        "source",
        "retire",
        resolve("private-lifecycle-store"),
        "base-one",
        "source-refresh",
      ]),
    ).rejects.toThrow("knowledge source retire requires --confirm");
    expect(retireKnowledgeSource).not.toHaveBeenCalled();
    expect(dependencies.lines).toEqual([]);

    await expect(
      createCli({
        service: dependencies.service,
        io: dependencies.io,
        knowledgeService,
      }).parseAsync([
        "node",
        "draft-loop",
        "knowledge",
        "source",
        "retire",
        resolve("private-lifecycle-store"),
        "base-one",
        "source-refresh",
        "--confirm",
      ]),
    ).rejects.toThrow("The candidate knowledge source retirement result was invalid.");
    expect(retireKnowledgeSource).toHaveBeenCalledOnce();
    expect(dependencies.lines).toEqual([]);
  });

  it("maps origin status and every refresh-state status without exposing local details", async () => {
    const dependencies = harness();
    const storeRoot = resolve("private-refresh-store");
    const knowledgeBaseId = "base-one";
    const sourceId = "source-refresh";
    const checkKnowledgeSourceOriginStatus = vi
      .fn()
      .mockResolvedValueOnce({
        ...knowledgeSourceOriginStatusResult("unbound"),
        originPath: "private-origin.md",
        displayName: "Private refresh label",
        checksum: "f".repeat(64),
      } as unknown as KnowledgeSourceOriginStatusResult)
      .mockResolvedValueOnce(knowledgeSourceOriginStatusResult("current"))
      .mockResolvedValueOnce(knowledgeSourceOriginStatusResult("changed"))
      .mockResolvedValueOnce(knowledgeSourceOriginStatusResult("missing"))
      .mockResolvedValueOnce(knowledgeSourceOriginStatusResult("inaccessible"));
    const getKnowledgeSourceRefreshState = vi
      .fn()
      .mockResolvedValueOnce(knowledgeSourceRefreshStateResult("unobserved"))
      .mockResolvedValueOnce(
        knowledgeSourceRefreshStateResult("current", {
          checkedAt: "2026-08-23T10:03:00.000Z",
          observedVersionId: "version-current",
        }),
      )
      .mockResolvedValueOnce(
        knowledgeSourceRefreshStateResult("stale", {
          checkedAt: "2026-08-23T10:04:00.000Z",
          observedVersionId: "version-stale",
          lastRefreshedAt: "2026-08-23T10:02:00.000Z",
          lastRefreshedVersionId: "version-refreshed",
        }),
      )
      .mockResolvedValueOnce(
        knowledgeSourceRefreshStateResult("changed", {
          checkedAt: "2026-08-23T10:05:00.000Z",
          observedVersionId: "version-changed",
        }),
      )
      .mockResolvedValueOnce(
        knowledgeSourceRefreshStateResult("missing", {
          checkedAt: "2026-08-23T10:06:00.000Z",
          observedVersionId: "version-missing",
        }),
      )
      .mockResolvedValueOnce(
        knowledgeSourceRefreshStateResult("inaccessible", {
          checkedAt: "2026-08-23T10:07:00.000Z",
          observedVersionId: "version-inaccessible",
        }),
      )
      .mockResolvedValueOnce(
        knowledgeSourceRefreshStateResult("unbound", {
          checkedAt: "2026-08-23T10:08:00.000Z",
          observedVersionId: "version-unbound",
        }),
      );
    const knowledgeService = {
      checkKnowledgeSourceOriginStatus,
      getKnowledgeSourceRefreshState,
    } as unknown as CandidateKnowledgeStoreService;
    const cli = createCli({
      service: dependencies.service,
      io: dependencies.io,
      knowledgeService,
    });

    for (let index = 0; index < 5; index += 1) {
      await cli.parseAsync([
        "node",
        "draft-loop",
        "knowledge",
        "source",
        "origin-status",
        storeRoot,
        knowledgeBaseId,
        sourceId,
      ]);
    }
    for (let index = 0; index < 7; index += 1) {
      await cli.parseAsync([
        "node",
        "draft-loop",
        "knowledge",
        "source",
        "refresh-state",
        storeRoot,
        knowledgeBaseId,
        sourceId,
      ]);
    }

    expect(checkKnowledgeSourceOriginStatus).toHaveBeenNthCalledWith(1, {
      storeRoot,
      knowledgeBaseId,
      sourceId,
    });
    expect(getKnowledgeSourceRefreshState).toHaveBeenCalledTimes(7);
    expect(dependencies.lines.map((line) => JSON.parse(line))).toEqual([
      {
        knowledgeBaseId,
        sourceId,
        checkedAt: "2026-08-23T10:02:00.000Z",
        status: "unbound",
      },
      {
        knowledgeBaseId,
        sourceId,
        checkedAt: "2026-08-23T10:02:00.000Z",
        status: "current",
      },
      {
        knowledgeBaseId,
        sourceId,
        checkedAt: "2026-08-23T10:02:00.000Z",
        status: "changed",
      },
      {
        knowledgeBaseId,
        sourceId,
        checkedAt: "2026-08-23T10:02:00.000Z",
        status: "missing",
      },
      {
        knowledgeBaseId,
        sourceId,
        checkedAt: "2026-08-23T10:02:00.000Z",
        status: "inaccessible",
      },
      {
        knowledgeBaseId,
        sourceId,
        status: "unobserved",
      },
      {
        knowledgeBaseId,
        sourceId,
        status: "current",
        checkedAt: "2026-08-23T10:03:00.000Z",
        observedVersionId: "version-current",
      },
      {
        knowledgeBaseId,
        sourceId,
        status: "stale",
        checkedAt: "2026-08-23T10:04:00.000Z",
        observedVersionId: "version-stale",
        lastRefreshedAt: "2026-08-23T10:02:00.000Z",
        lastRefreshedVersionId: "version-refreshed",
      },
      {
        knowledgeBaseId,
        sourceId,
        status: "changed",
        checkedAt: "2026-08-23T10:05:00.000Z",
        observedVersionId: "version-changed",
      },
      {
        knowledgeBaseId,
        sourceId,
        status: "missing",
        checkedAt: "2026-08-23T10:06:00.000Z",
        observedVersionId: "version-missing",
      },
      {
        knowledgeBaseId,
        sourceId,
        status: "inaccessible",
        checkedAt: "2026-08-23T10:07:00.000Z",
        observedVersionId: "version-inaccessible",
      },
      {
        knowledgeBaseId,
        sourceId,
        status: "unbound",
        checkedAt: "2026-08-23T10:08:00.000Z",
        observedVersionId: "version-unbound",
      },
    ]);
    const output = dependencies.lines.join("\n");
    expect(output).not.toContain(storeRoot);
    expect(output).not.toContain("private-origin.md");
    expect(output).not.toContain("https://private.example/refresh");
    expect(output).not.toContain("Private refresh label");
    expect(output).not.toContain("text/markdown");
    expect(output).not.toContain("f".repeat(64));
  });

  it("maps file and approved URL refresh results, including refreshed and no-version states", async () => {
    const dependencies = harness();
    const storeRoot = resolve("private-refresh-store");
    const knowledgeBaseId = "base-one";
    const sourceId = "source-refresh";
    const refreshKnowledgeSourceFromOrigin = vi
      .fn()
      .mockResolvedValueOnce({
        ...knowledgeSourceOriginRefreshResult("refreshed", "version-new"),
        originPath: "private-origin.md",
        url: "https://private.example/refresh?secret=yes",
        displayName: "Private refresh label",
        checksum: "f".repeat(64),
        mediaType: "text/markdown",
      } as unknown as KnowledgeSourceOriginRefreshResult)
      .mockResolvedValueOnce(knowledgeSourceOriginRefreshResult("current"))
      .mockResolvedValueOnce(knowledgeSourceOriginRefreshResult("missing"))
      .mockResolvedValueOnce(knowledgeSourceOriginRefreshResult("inaccessible"))
      .mockResolvedValueOnce(knowledgeSourceOriginRefreshResult("unbound"));
    const refreshKnowledgeSourceUrl = vi.fn(async () =>
      knowledgeSourceOriginRefreshResult("refreshed", "version-url"),
    );
    const knowledgeService = {
      refreshKnowledgeSourceFromOrigin,
      refreshKnowledgeSourceUrl,
    } as unknown as CandidateKnowledgeStoreService;
    const cli = createCli({
      service: dependencies.service,
      io: dependencies.io,
      knowledgeService,
    });

    for (let index = 0; index < 5; index += 1) {
      await cli.parseAsync([
        "node",
        "draft-loop",
        "knowledge",
        "source",
        "refresh-file",
        storeRoot,
        knowledgeBaseId,
        sourceId,
      ]);
    }
    await cli.parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "refresh-url",
      storeRoot,
      knowledgeBaseId,
      sourceId,
      "--approve",
    ]);

    expect(refreshKnowledgeSourceFromOrigin).toHaveBeenCalledTimes(5);
    expect(refreshKnowledgeSourceFromOrigin).toHaveBeenNthCalledWith(1, {
      storeRoot,
      knowledgeBaseId,
      sourceId,
    });
    expect(refreshKnowledgeSourceUrl).toHaveBeenCalledWith({
      storeRoot,
      knowledgeBaseId,
      sourceId,
      approved: true,
    });
    expect(dependencies.lines.map((line) => JSON.parse(line))).toEqual([
      {
        knowledgeBaseId,
        sourceId,
        checkedAt: "2026-08-23T10:02:00.000Z",
        status: "refreshed",
        versionId: "version-new",
      },
      {
        knowledgeBaseId,
        sourceId,
        checkedAt: "2026-08-23T10:02:00.000Z",
        status: "current",
      },
      {
        knowledgeBaseId,
        sourceId,
        checkedAt: "2026-08-23T10:02:00.000Z",
        status: "missing",
      },
      {
        knowledgeBaseId,
        sourceId,
        checkedAt: "2026-08-23T10:02:00.000Z",
        status: "inaccessible",
      },
      {
        knowledgeBaseId,
        sourceId,
        checkedAt: "2026-08-23T10:02:00.000Z",
        status: "unbound",
      },
      {
        knowledgeBaseId,
        sourceId,
        checkedAt: "2026-08-23T10:02:00.000Z",
        status: "refreshed",
        versionId: "version-url",
      },
    ]);
    const output = dependencies.lines.join("\n");
    expect(output).not.toContain(storeRoot);
    expect(output).not.toContain("private-origin.md");
    expect(output).not.toContain("https://private.example/refresh?secret=yes");
    expect(output).not.toContain("Private refresh label");
    expect(output).not.toContain("text/markdown");
    expect(output).not.toContain("f".repeat(64));
  });

  it("requires refresh URL approval before calling the URL refresh service", async () => {
    const dependencies = harness();
    const refreshKnowledgeSourceUrl = vi.fn(async () =>
      knowledgeSourceOriginRefreshResult("refreshed", "version-url"),
    );
    const knowledgeService = {
      refreshKnowledgeSourceUrl,
    } as unknown as CandidateKnowledgeStoreService;

    await expect(
      createCli({
        service: dependencies.service,
        io: dependencies.io,
        knowledgeService,
      }).parseAsync([
        "node",
        "draft-loop",
        "knowledge",
        "source",
        "refresh-url",
        resolve("private-refresh-store"),
        "base-one",
        "source-refresh",
      ]),
    ).rejects.toThrow("knowledge source refresh-url requires --approve");
    expect(refreshKnowledgeSourceUrl).not.toHaveBeenCalled();
    expect(dependencies.lines).toEqual([]);
  });

  it("rejects malformed or wrong-source refresh results and propagates service failures", async () => {
    const dependencies = harness();
    const failure = new Error("origin status failed");
    const checkKnowledgeSourceOriginStatus = vi
      .fn()
      .mockResolvedValueOnce(knowledgeSourceOriginStatusResult("current", "other-source"))
      .mockRejectedValueOnce(failure);
    const getKnowledgeSourceRefreshState = vi.fn(async () =>
      knowledgeSourceRefreshStateResult("current", {
        checkedAt: "not-a-timestamp",
      }),
    );
    const refreshKnowledgeSourceFromOrigin = vi.fn(
      async () =>
        ({
          ...knowledgeSourceOriginRefreshResult("current"),
          versionId: "   ",
        }) as unknown as KnowledgeSourceOriginRefreshResult,
    );
    const knowledgeService = {
      checkKnowledgeSourceOriginStatus,
      getKnowledgeSourceRefreshState,
      refreshKnowledgeSourceFromOrigin,
    } as unknown as CandidateKnowledgeStoreService;
    const cli = createCli({
      service: dependencies.service,
      io: dependencies.io,
      knowledgeService,
    });

    await expect(
      cli.parseAsync([
        "node",
        "draft-loop",
        "knowledge",
        "source",
        "origin-status",
        resolve("private-refresh-store"),
        "base-one",
        "source-refresh",
      ]),
    ).rejects.toThrow("The candidate knowledge source origin status result was invalid.");
    await expect(
      cli.parseAsync([
        "node",
        "draft-loop",
        "knowledge",
        "source",
        "refresh-state",
        resolve("private-refresh-store"),
        "base-one",
        "source-refresh",
      ]),
    ).rejects.toThrow("The candidate knowledge source refresh state result was invalid.");
    await expect(
      cli.parseAsync([
        "node",
        "draft-loop",
        "knowledge",
        "source",
        "refresh-file",
        resolve("private-refresh-store"),
        "base-one",
        "source-refresh",
      ]),
    ).rejects.toThrow("The candidate knowledge source refresh result was invalid.");
    await expect(
      cli.parseAsync([
        "node",
        "draft-loop",
        "knowledge",
        "source",
        "origin-status",
        resolve("private-refresh-store"),
        "base-one",
        "source-refresh",
      ]),
    ).rejects.toBe(failure);
    expect(dependencies.lines).toEqual([]);
  });

  it("rejects inconsistent refresh observation and refresh-result relationships", async () => {
    const dependencies = harness();
    const getKnowledgeSourceRefreshState = vi
      .fn()
      .mockResolvedValueOnce(
        knowledgeSourceRefreshStateResult("unobserved", {
          checkedAt: "2026-08-23T10:01:00.000Z",
        }),
      )
      .mockResolvedValueOnce(
        knowledgeSourceRefreshStateResult("current", {
          checkedAt: "2026-08-23T10:01:00.000Z",
        }),
      )
      .mockResolvedValueOnce(
        knowledgeSourceRefreshStateResult("current", {
          observedVersionId: "version-current",
        }),
      )
      .mockResolvedValueOnce(
        knowledgeSourceRefreshStateResult("current", {
          checkedAt: "2026-08-23T10:01:00.000Z",
          observedVersionId: "version-current",
          lastRefreshedAt: "2026-08-23T10:01:00.000Z",
        }),
      )
      .mockResolvedValueOnce(
        knowledgeSourceRefreshStateResult("current", {
          checkedAt: "2026-08-23T10:01:00.000Z",
          observedVersionId: "version-current",
          lastRefreshedVersionId: "version-refreshed",
        }),
      )
      .mockResolvedValueOnce(
        knowledgeSourceRefreshStateResult("current", {
          checkedAt: "2026-08-23T10:01:00.000Z",
          observedVersionId: "version-current",
          lastRefreshedAt: "2026-08-23T10:02:00.000Z",
          lastRefreshedVersionId: "version-refreshed",
        }),
      );
    const refreshKnowledgeSourceFromOrigin = vi
      .fn()
      .mockResolvedValueOnce(knowledgeSourceOriginRefreshResult("refreshed"))
      .mockResolvedValueOnce({
        ...knowledgeSourceOriginRefreshResult("current"),
        versionId: "version-current",
      } as unknown as KnowledgeSourceOriginRefreshResult);
    const knowledgeService = {
      getKnowledgeSourceRefreshState,
      refreshKnowledgeSourceFromOrigin,
    } as unknown as CandidateKnowledgeStoreService;
    const cli = createCli({
      service: dependencies.service,
      io: dependencies.io,
      knowledgeService,
    });
    const stateCommand = [
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "refresh-state",
      resolve("private-refresh-store"),
      "base-one",
      "source-refresh",
    ] as const;
    const fileRefreshCommand = [
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "refresh-file",
      resolve("private-refresh-store"),
      "base-one",
      "source-refresh",
    ] as const;

    for (let index = 0; index < 6; index += 1) {
      await expect(cli.parseAsync(stateCommand)).rejects.toThrow(
        "The candidate knowledge source refresh state result was invalid.",
      );
    }
    await expect(cli.parseAsync(fileRefreshCommand)).rejects.toThrow(
      "The candidate knowledge source refresh result was invalid.",
    );
    await expect(cli.parseAsync(fileRefreshCommand)).rejects.toThrow(
      "The candidate knowledge source refresh result was invalid.",
    );
    expect(dependencies.lines).toEqual([]);
  });

  it("rejects malformed rebind and retirement results without emitting output", async () => {
    const dependencies = harness();
    const sourceId = "source-refresh";
    const rebindKnowledgeSourceOrigin = vi
      .fn()
      .mockResolvedValueOnce(knowledgeSourceOriginRebindResult("rebound", "other-source"))
      .mockResolvedValueOnce({
        ...knowledgeSourceOriginRebindResult("current"),
        boundAt: "not-a-timestamp",
      } as unknown as KnowledgeSourceOriginRebindResult)
      .mockResolvedValueOnce({
        ...knowledgeSourceOriginRebindResult("rebound"),
        status: "invalid",
      } as unknown as KnowledgeSourceOriginRebindResult);
    const getKnowledgeSourceRetirement = vi
      .fn()
      .mockResolvedValueOnce({
        ...knowledgeSourceRetirementResult("active"),
        retiredAt: "2026-08-23T10:04:00.000Z",
      } as unknown as KnowledgeSourceRetirementResult)
      .mockResolvedValueOnce({
        ...knowledgeSourceRetirementResult("retired"),
        retiredAt: "not-a-timestamp",
      } as unknown as KnowledgeSourceRetirementResult)
      .mockResolvedValueOnce({
        ...knowledgeSourceRetirementResult("retired"),
        reason: "automatic",
      } as unknown as KnowledgeSourceRetirementResult);
    const knowledgeService = {
      rebindKnowledgeSourceOrigin,
      getKnowledgeSourceRetirement,
    } as unknown as CandidateKnowledgeStoreService;
    const cli = createCli({
      service: dependencies.service,
      io: dependencies.io,
      knowledgeService,
    });
    const rebindCommand = [
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "rebind-file",
      resolve("private-lifecycle-store"),
      "base-one",
      sourceId,
      resolve("private-origin.md"),
    ] as const;
    const retirementCommand = [
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "retirement-state",
      resolve("private-lifecycle-store"),
      "base-one",
      sourceId,
    ] as const;

    for (let index = 0; index < 3; index += 1) {
      await expect(cli.parseAsync(rebindCommand)).rejects.toThrow(
        "The candidate knowledge source rebind result was invalid.",
      );
    }
    for (let index = 0; index < 3; index += 1) {
      await expect(cli.parseAsync(retirementCommand)).rejects.toThrow(
        "The candidate knowledge source retirement result was invalid.",
      );
    }
    expect(dependencies.lines).toEqual([]);
  });

  it("propagates lifecycle service failures without adding CLI output", async () => {
    const dependencies = harness();
    const failure = new Error("source lifecycle failed");
    const rebindKnowledgeSourceOrigin = vi.fn(async () => {
      throw failure;
    });
    const knowledgeService = {
      rebindKnowledgeSourceOrigin,
    } as unknown as CandidateKnowledgeStoreService;

    await expect(
      createCli({
        service: dependencies.service,
        io: dependencies.io,
        knowledgeService,
      }).parseAsync([
        "node",
        "draft-loop",
        "knowledge",
        "source",
        "rebind-file",
        resolve("private-lifecycle-store"),
        "base-one",
        "source-refresh",
        resolve("private-origin.md"),
      ]),
    ).rejects.toBe(failure);
    expect(dependencies.lines).toEqual([]);
  });

  it("propagates file-import service failures and rejects malformed results safely", async () => {
    const dependencies = harness();
    const failure = new Error("file import failed");
    const importKnowledgeSourceFile = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({} as never);
    const knowledgeService = {
      importKnowledgeSourceFile,
    } as unknown as CandidateKnowledgeStoreService;
    const cli = createCli({
      service: dependencies.service,
      io: dependencies.io,
      knowledgeService,
    });
    const command = [
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "import",
      resolve("private-intake-store"),
      "base-one",
      resolve("private-resume.md"),
    ] as const;

    await expect(cli.parseAsync(command)).rejects.toBe(failure);
    await expect(cli.parseAsync(command)).rejects.toThrow(
      "The candidate knowledge source write result was invalid.",
    );
    expect(dependencies.lines).toEqual([]);
  });

  it("maps source list, duplicate, and inventory commands to bounded safe JSON", async () => {
    const dependencies = harness();
    const storeRoot = resolve("private-inspection-store");
    const knowledgeBaseId = "base-one";
    const listKnowledgeSourceManifests = vi.fn(async () => knowledgeSourceManifests());
    const listKnowledgeSourceDuplicateGroups = vi.fn(async () => knowledgeDuplicateGroups());
    const inspectManagedCandidateKnowledgeFiles = vi.fn(async () => knowledgeInventory(true));
    const knowledgeService = {
      listKnowledgeSourceManifests,
      listKnowledgeSourceDuplicateGroups,
      inspectManagedCandidateKnowledgeFiles,
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
      "source",
      "list",
      storeRoot,
      knowledgeBaseId,
    ]);
    await cli.parseAsync([
      "node",
      "draft-loop",
      "knowledge",
      "source",
      "duplicates",
      storeRoot,
      knowledgeBaseId,
    ]);
    await cli.parseAsync(["node", "draft-loop", "knowledge", "store", "inventory", storeRoot]);

    expect(listKnowledgeSourceManifests).toHaveBeenCalledWith({ storeRoot, knowledgeBaseId });
    expect(listKnowledgeSourceDuplicateGroups).toHaveBeenCalledWith({
      storeRoot,
      knowledgeBaseId,
    });
    expect(inspectManagedCandidateKnowledgeFiles).toHaveBeenCalledWith({ storeRoot });

    const [sourceOutput, duplicateOutput, inventoryOutput] = dependencies.lines.map((line) =>
      JSON.parse(line),
    );
    expect(sourceOutput).toEqual({
      knowledgeBaseId,
      sourceCount: 2,
      sources: [
        {
          sourceId: "source-a",
          kind: "file",
          versionCount: 1,
          versionIds: ["version-a1"],
          versionIdsTruncated: false,
        },
        {
          sourceId: "source-b",
          kind: "url",
          versionCount: 2,
          versionIds: ["version-b1", "version-b2"],
          versionIdsTruncated: false,
        },
      ],
      sourcesTruncated: false,
    });
    expect(duplicateOutput).toEqual({
      knowledgeBaseId,
      groupCount: 1,
      groups: [
        {
          memberCount: 2,
          members: [
            { sourceId: "source-a", versionId: "version-a1" },
            { sourceId: "source-b", versionId: "version-b2" },
          ],
          membersTruncated: false,
        },
      ],
      groupsTruncated: false,
    });
    expect(inventoryOutput).toEqual({
      schemaVersion: 1,
      verifiedManagedFileCount: 2,
      scannedEntryCount: 4,
      unknownEntries: {
        intakeShapedFilesAtSourcesRoot: 0,
        opaqueEntriesAtSourcesRoot: 0,
        entriesInsideManagedSourceDirectories: 0,
        symbolicLinks: 0,
        otherEntries: 0,
      },
      complete: true,
      scanLimitReached: false,
    });
    const output = dependencies.lines.join("\n");
    expect(output).not.toContain(storeRoot);
    expect(output).not.toContain("resume-private.md");
    expect(output).not.toContain("https://private.example/source");
    expect(output).not.toContain("Private display name");
    expect(output).not.toContain("a".repeat(64));
    expect(output).not.toContain("relative-path-hash");
  });

  it("reports empty source results and an incomplete inventory without paths", async () => {
    const dependencies = harness();
    const storeRoot = resolve("private-empty-inspection-store");
    const knowledgeBaseId = "base-empty";
    const knowledgeService = {
      listKnowledgeSourceManifests: vi.fn(async () => []),
      listKnowledgeSourceDuplicateGroups: vi.fn(async () => []),
      inspectManagedCandidateKnowledgeFiles: vi.fn(async () => knowledgeInventory(false)),
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
      "source",
      "list",
      storeRoot,
      knowledgeBaseId,
    ]);
    await cli.parseAsync(["node", "draft-loop", "knowledge", "store", "inventory", storeRoot]);

    expect(JSON.parse(dependencies.lines[0] ?? "{}")).toMatchObject({
      knowledgeBaseId,
      sourceCount: 0,
      sources: [],
      sourcesTruncated: false,
    });
    expect(JSON.parse(dependencies.lines[1] ?? "{}")).toMatchObject({
      verifiedManagedFileCount: 0,
      complete: false,
      scanLimitReached: true,
    });
    expect(dependencies.lines.join("\n")).not.toContain(storeRoot);
  });

  it("propagates source inspection service failures", async () => {
    const dependencies = harness();
    const failure = new Error("source inspection failed");
    const listKnowledgeSourceManifests = vi.fn(async () => {
      throw failure;
    });
    const knowledgeService = {
      listKnowledgeSourceManifests,
    } as unknown as CandidateKnowledgeStoreService;

    await expect(
      createCli({
        service: dependencies.service,
        io: dependencies.io,
        knowledgeService,
      }).parseAsync([
        "node",
        "draft-loop",
        "knowledge",
        "source",
        "list",
        resolve("private-inspection-store"),
        "base-one",
      ]),
    ).rejects.toBe(failure);
    expect(dependencies.lines).toEqual([]);
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
