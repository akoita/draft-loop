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
  IndependentReviewRecord,
  InitializeWorkspaceCommand,
  KnowledgeBaseLifecycleReadinessResult,
  KnowledgeSourceDuplicateGroup,
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
): CandidateKnowledgeSourceWriteResult {
  return {
    source: {
      id: "source-imported",
      knowledgeBaseId: "base-one",
      kind,
      displayName: kind === "url" ? "https://private.example/source" : "private-source.md",
      createdAt: "2026-08-23T10:00:00.000Z",
    },
    versions: [
      {
        id: "version-two",
        sourceId: "source-imported",
        version: 2,
        parentVersionId: "version-one",
        mediaType: "text/markdown",
        checksum: "d".repeat(64),
        sizeBytes: 12,
        createdAt: "2026-08-23T10:01:00.000Z",
      },
      {
        id: "version-one",
        sourceId: "source-imported",
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
      "The imported candidate knowledge source result was invalid.",
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
      "The imported candidate knowledge source result was invalid.",
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
