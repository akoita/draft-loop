import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createCli } from "./index.js";
import type {
  ApplicationIo,
  ApplicationService,
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
