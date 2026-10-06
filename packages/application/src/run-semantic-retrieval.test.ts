import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CandidateKnowledgeRetrievalTraceInput,
  CandidateKnowledgeSelectionSnapshot,
  ContextSnapshot,
} from "@draft-loop/domain";
import type { EmbeddingRole, TextEmbedder } from "@draft-loop/embeddings";
import { SqliteStorage } from "@draft-loop/storage";
import {
  type CandidateKnowledgeStoreHandle,
  openCandidateKnowledgeStore,
} from "@draft-loop/storage/knowledge-store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { candidateContactEvidenceQuery } from "./candidate-contact-evidence.js";
import { announceRunEvidenceMode } from "./full-source-evidence.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";
import { openRunCandidateRetrieval } from "./run-evidence-retrieval.js";
import { resetRunEmbedderCacheForTests } from "./run-semantic-retrieval.js";
import { createSourceSensitivityService } from "./source-sensitivity-service.js";
import {
  type RetrievalMode,
  retrievalModeInvalidMessage,
  writeWorkspaceRetrievalMode,
} from "./workspace-retrieval-mode.js";

const createdAt = "2026-09-02T09:00:00.000Z";
const workspaceId = "workspace-semantic-run";
const withheldMarker = "xray";
const vocabulary = [
  "alpha",
  "beta",
  "gamma",
  "kubernetes",
  "typescript",
  "interfaces",
  "xray",
  "yankee",
];

const markdown = [
  "# Fictional Candidate",
  "Opening line about alpha delivery.",
  "",
  "## Infrastructure",
  "Operated kubernetes clusters for the beta platform.",
  "",
  "## Frontend",
  "Built typescript interfaces for the gamma portal.",
  "",
  "## Compensation",
  `Fictional salary history ${withheldMarker} for the synthetic former employer.`,
  "",
].join("\n");

// The paraphrase shares no keyword with the Infrastructure chunk; the fake embedder maps it there.
const paraphrase = "container orchestration background";
const hybridQuery = "container orchestration typescript interfaces";
const salaryQuery = "pay history";

interface FakeEmbedder extends TextEmbedder {
  readonly queryTexts: string[];
  failQueries: boolean;
}

function createFakeEmbedder(): FakeEmbedder {
  const queryTexts: string[] = [];
  const steer = (query: string): string =>
    query
      .replace(/container orchestration/gu, "kubernetes")
      .replace(/pay history/gu, withheldMarker);
  const embedder: FakeEmbedder = {
    identity: {
      modelId: "fake-keyword-embedder",
      sourceRepository: "example/fake",
      revision: "rev-1",
      modelFileSha256: "a".repeat(64),
      dimensions: vocabulary.length + 1,
      pooling: "cls",
      runtime: "fake-runtime",
    },
    queryTexts,
    failQueries: false,
    embed: async (texts, role: EmbeddingRole) => {
      if (role === "query") {
        if (embedder.failQueries) throw new Error("embedding runtime failed");
        queryTexts.push(...texts);
      }
      return texts.map((text) => {
        const words = (role === "query" ? steer(text) : text).toLowerCase().split(/[^a-z]+/u);
        const vector = new Float32Array(vocabulary.length + 1);
        for (const word of words) {
          const axis = vocabulary.indexOf(word);
          if (axis >= 0) vector[axis] = (vector[axis] as number) + 1;
        }
        vector[vocabulary.length] = 0.01;
        const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
        return vector.map((value) => value / norm);
      });
    },
    dispose: async () => undefined,
  };
  return embedder;
}

const readyService = (state = "ready", modelDirectory = "/models/granite") => ({
  status: async () =>
    ({ state, modelDirectory }) as Awaited<
      ReturnType<import("./embedding-model-install.js").EmbeddingModelService["status"]>
    >,
});

const checksumOf = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");

describe("run semantic retrieval", () => {
  const directories: string[] = [];
  const storages: SqliteStorage[] = [];
  const knowledge = createCandidateKnowledgeStoreService();
  const sensitivity = createSourceSensitivityService();

  afterEach(async () => {
    vi.restoreAllMocks();
    resetRunEmbedderCacheForTests();
    for (const storage of storages.splice(0)) storage.close();
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
    );
  });

  interface Fixture {
    readonly directory: string;
    readonly root: string;
    readonly storeRoot: string;
    readonly knowledgeBaseId: string;
    readonly sourceId: string;
    readonly selection: CandidateKnowledgeSelectionSnapshot;
    readonly storage: SqliteStorage;
  }

  async function createFixture(): Promise<Fixture> {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-run-semantic-"));
    directories.push(directory);
    const root = join(directory, "workspace");
    const storeRoot = join(directory, "store");
    const view = await knowledge.initializeStore({ storeRoot });
    const knowledgeBaseId = view.knowledgeBases[0]?.id ?? "";
    const sourcePath = join(directory, "history.md");
    await writeFile(sourcePath, markdown, "utf8");
    const imported = await knowledge.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId,
      sourcePath,
    });
    const selection = await knowledge.createKnowledgeSelectionSnapshot({
      selections: [{ storeRoot, knowledgeBaseId }],
    });
    const storage = new SqliteStorage(join(directory, "history.sqlite"));
    storages.push(storage);
    for (const id of [workspaceId, "workspace-other"]) {
      await storage.saveWorkspace({ id, state: "collecting", createdAt, updatedAt: createdAt });
    }
    return {
      directory,
      root,
      storeRoot,
      knowledgeBaseId,
      sourceId: imported.source.id,
      selection,
      storage,
    };
  }

  interface Run {
    readonly runtime: NonNullable<Awaited<ReturnType<typeof openRunCandidateRetrieval>>>;
    readonly v1Traces: CandidateKnowledgeRetrievalTraceInput[];
    readonly embedder: FakeEmbedder;
    readonly createEmbedderCalls: () => number;
  }

  async function openRun(
    fixture: Fixture,
    mode: RetrievalMode | "unset",
    dependencies: {
      readonly state?: string;
      readonly embedder?: FakeEmbedder;
      readonly createEmbedderError?: Error;
      readonly shareEmbedder?: boolean;
      readonly modelDirectory?: string;
      readonly open?: (storeRoot: string) => Promise<CandidateKnowledgeStoreHandle>;
      readonly relevanceFloor?: {
        readonly maxMarginFromTop: number;
        readonly minimumScore: number;
      };
    } = {},
    id = workspaceId,
  ): Promise<Run> {
    if (mode !== "unset") await writeWorkspaceRetrievalMode(fixture.root, { mode });
    const embedder = dependencies.embedder ?? createFakeEmbedder();
    let created = 0;
    const v1Traces: CandidateKnowledgeRetrievalTraceInput[] = [];
    const storage = {
      appendCandidateKnowledgeRetrievalTrace: async (
        input: CandidateKnowledgeRetrievalTraceInput,
      ) => {
        v1Traces.push(input);
        return fixture.storage.appendCandidateKnowledgeRetrievalTrace(input);
      },
      get candidateKnowledgeSemanticRetrievalTrace() {
        return fixture.storage.candidateKnowledgeSemanticRetrievalTrace;
      },
    };
    const runtime = await openRunCandidateRetrieval(
      storage,
      fixture.root,
      {
        id,
        requiredSections: [],
        candidateKnowledgeSelection: {
          entries: [{ storeRoot: fixture.storeRoot, knowledgeBaseId: fixture.knowledgeBaseId }],
        },
      },
      {
        candidateKnowledgeSelection: fixture.selection,
        modelConfiguration: { author: { role: "author" }, critic: { role: "critic" } },
      } as unknown as ContextSnapshot,
      undefined,
      {
        modelRoot: "/models",
        modelService: readyService(dependencies.state, dependencies.modelDirectory),
        ...(dependencies.shareEmbedder === true ? { shareEmbedder: true } : {}),
        createEmbedder: async () => {
          created += 1;
          if (dependencies.createEmbedderError !== undefined)
            throw dependencies.createEmbedderError;
          return embedder;
        },
        ...(dependencies.open === undefined ? {} : { open: dependencies.open }),
        ...(dependencies.relevanceFloor === undefined
          ? {}
          : { relevanceFloor: dependencies.relevanceFloor }),
      },
    );
    if (runtime === undefined) throw new Error("Expected candidate knowledge retrieval.");
    return { runtime, v1Traces, embedder, createEmbedderCalls: () => created };
  }

  const companionFor = (fixture: Fixture, traceId: string, id = workspaceId) =>
    fixture.storage.candidateKnowledgeSemanticRetrievalTrace.getSemanticRetrievalTrace(id, traceId);

  const tracesFor = (run: Run, query: string) =>
    run.v1Traces.filter((trace) => trace.queryChecksum === checksumOf(query));

  async function announce(run: Run, id = workspaceId) {
    const lines: string[] = [];
    const appendAuditEvent = vi.fn(async (input: unknown) => input as never);
    await announceRunEvidenceMode({ appendAuditEvent }, run.runtime, id, "run-1", (line) =>
      lines.push(line),
    );
    return { lines, appendAuditEvent };
  }

  it("keeps lexical mode unchanged: no embedder, companions, line or event", async () => {
    const fixture = await createFixture();
    for (const mode of ["unset", "lexical"] as const) {
      const run = await openRun(fixture, mode);
      const result = await run.runtime.inspect(paraphrase);
      expect(run.runtime.retrievalModeDecision).toBeUndefined();
      expect(run.createEmbedderCalls()).toBe(0);
      expect(run.v1Traces.length).toBeGreaterThan(0);
      for (const trace of run.v1Traces) {
        expect(await companionFor(fixture, trace.id)).toBeUndefined();
      }
      const { lines, appendAuditEvent } = await announce(run);
      expect(lines).toEqual([]);
      expect(appendAuditEvent).not.toHaveBeenCalled();
      expect(result.hits.length).toBeGreaterThan(0);
    }
  });

  it.each(["semantic", "hybrid"] as const)(
    "%s mode takes primary hits from the vector index and traces the companion",
    async (mode) => {
      const fixture = await createFixture();
      const lexicalRun = await openRun(fixture, "lexical");
      await lexicalRun.runtime.inspect(paraphrase);
      // No keyword of the paraphrase matches, so BM25 had no relevance signal to offer.
      expect(tracesFor(lexicalRun, paraphrase)[0]?.status).toBe("bounded-fallback");

      const run = await openRun(fixture, mode);
      const result = await run.runtime.inspect(paraphrase);
      expect(result.hits[0]?.text).toContain("kubernetes");

      const primary = tracesFor(run, paraphrase);
      expect(primary).toHaveLength(1);
      const trace = primary[0] as CandidateKnowledgeRetrievalTraceInput;
      const companion = await companionFor(fixture, trace.id);
      expect(companion).toMatchObject({
        workspaceId,
        traceId: trace.id,
        retrievalMode: mode,
        outcome: "semantic-used",
        reason: null,
        embeddingIdentity: { modelId: "fake-keyword-embedder", revision: "rev-1" },
      });
      expect(companion?.selectedChunks[0]).toMatchObject({ vectorRank: 1 });
      expect(companion?.selectedChunks[0]?.vectorScore).toBeGreaterThan(0.5);
      expect(companion?.selectedChunks[0]?.chunkId).toBe(result.hits[0]?.chunkId);
      const selected = new Set(trace.selectedChunks.map(({ chunkId }) => chunkId));
      for (const chunk of companion?.selectedChunks ?? []) {
        expect(selected.has(chunk.chunkId)).toBe(true);
      }

      // The structural contact query stays lexical: it has no companion and is never embedded.
      const contact = tracesFor(run, candidateContactEvidenceQuery);
      expect(contact.length).toBeGreaterThan(0);
      for (const other of contact) {
        expect(await companionFor(fixture, other.id)).toBeUndefined();
      }
      expect(run.embedder.queryTexts).toEqual([paraphrase]);

      const { lines, appendAuditEvent } = await announce(run);
      expect(lines).toEqual([
        expect.stringMatching(
          new RegExp(`^Retrieval mode: ${mode} \\(311m\\), \\d+ chunks embedded$`),
        ),
      ]);
      expect(appendAuditEvent.mock.calls[0]?.[0]).toMatchObject({
        eventType: "run.retrieval-mode",
        entityType: "run",
        entityId: "run-1",
        workspaceId,
        payload: {
          requestedMode: mode,
          effectiveMode: mode,
          tier: "311m",
          modelId: "fake-keyword-embedder",
          revision: "rev-1",
        },
      });
      const event = appendAuditEvent.mock.calls[0]?.[0] as
        | { payload: Record<string, unknown> }
        | undefined;
      const payload = event?.payload ?? {};
      expect(payload.reason).toBeUndefined();
      expect(JSON.stringify(payload)).not.toContain(paraphrase);
    },
  );

  it("fuses lexical and vector rankings in hybrid mode", async () => {
    const fixture = await createFixture();
    const run = await openRun(fixture, "hybrid");
    const result = await run.runtime.inspect(hybridQuery);
    const texts = result.hits.map(({ text }) => text).join("\n");
    expect(texts).toContain("kubernetes");
    expect(texts).toContain("typescript");
    const trace = tracesFor(run, hybridQuery)[0] as CandidateKnowledgeRetrievalTraceInput;
    const companion = await companionFor(fixture, trace.id);
    expect(companion?.outcome).toBe("semantic-used");
    expect(companion?.selectedChunks.length).toBeGreaterThan(0);
  });

  it.each([
    ["absent", "model-absent", undefined],
    ["corrupt", "model-corrupt", undefined],
    ["unsupported-platform", "unsupported-platform", undefined],
    ["ready", "runtime-failed", new Error("native runtime missing")],
  ] as const)(
    "falls back to lexical visibly when the model is %s (%s)",
    async (state, reason, createEmbedderError) => {
      const fixture = await createFixture();
      const baseline = await (await openRun(fixture, "lexical")).runtime.inspect(paraphrase);
      const run = await openRun(fixture, "semantic", {
        state,
        ...(createEmbedderError === undefined ? {} : { createEmbedderError }),
      });
      const result = await run.runtime.inspect(paraphrase);
      expect(result.hits).toEqual(baseline.hits);

      const trace = tracesFor(run, paraphrase)[0] as CandidateKnowledgeRetrievalTraceInput;
      expect(await companionFor(fixture, trace.id)).toMatchObject({
        retrievalMode: "semantic",
        outcome: "semantic-unavailable",
        reason,
        embeddingIdentity: null,
        selectedChunks: [],
      });

      const { lines, appendAuditEvent } = await announce(run);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(`Retrieval mode: semantic requested; using lexical (${reason}).`);
      if (reason === "model-absent" || reason === "model-corrupt") {
        expect(lines[0]).toContain("draft-loop embeddings install --tier 311m");
      }
      expect(appendAuditEvent.mock.calls[0]?.[0]).toMatchObject({
        eventType: "run.retrieval-mode",
        payload: {
          requestedMode: "semantic",
          effectiveMode: "lexical",
          tier: "311m",
          reason,
          embeddedChunkCount: 0,
        },
      });
    },
  );

  it("falls back with index-stale when the vector index cannot be made current", async () => {
    const fixture = await createFixture();
    const baseline = await (await openRun(fixture, "lexical")).runtime.inspect(paraphrase);
    const run = await openRun(fixture, "hybrid", {
      open: async (storeRoot) => {
        const handle = await openCandidateKnowledgeStore(storeRoot);
        return {
          ...handle,
          inspectCandidateKnowledgeVectorIndex: async () => ({
            status: "stale",
            index: null,
            indexedScope: null,
            indexedChunkCount: 0,
          }),
        } as unknown as CandidateKnowledgeStoreHandle;
      },
    });
    const result = await run.runtime.inspect(paraphrase);
    expect(result.hits).toEqual(baseline.hits);
    const trace = tracesFor(run, paraphrase)[0] as CandidateKnowledgeRetrievalTraceInput;
    expect(await companionFor(fixture, trace.id)).toMatchObject({
      outcome: "semantic-unavailable",
      reason: "index-stale",
    });
    const { lines } = await announce(run);
    expect(lines[0]).toContain("using lexical (index-stale)");
  });

  it("falls back for one query when embedding it fails after the model opened", async () => {
    const fixture = await createFixture();
    const baseline = await (await openRun(fixture, "lexical")).runtime.inspect(paraphrase);
    const embedder = createFakeEmbedder();
    embedder.failQueries = true;
    const run = await openRun(fixture, "semantic", { embedder });
    const result = await run.runtime.inspect(paraphrase);
    expect(result.hits).toEqual(baseline.hits);
    const trace = tracesFor(run, paraphrase)[0] as CandidateKnowledgeRetrievalTraceInput;
    expect(await companionFor(fixture, trace.id)).toMatchObject({
      outcome: "semantic-unavailable",
      reason: "runtime-failed",
    });
  });

  it("keeps the lexical result when the relevance floor rejects every semantic hit", async () => {
    const fixture = await createFixture();
    const baseline = await (await openRun(fixture, "lexical")).runtime.inspect(paraphrase);
    const run = await openRun(fixture, "semantic", {
      relevanceFloor: { maxMarginFromTop: 0, minimumScore: 1.5 },
    });
    const result = await run.runtime.inspect(paraphrase);
    expect(result.hits).toEqual(baseline.hits);
    const trace = tracesFor(run, paraphrase)[0] as CandidateKnowledgeRetrievalTraceInput;
    expect(await companionFor(fixture, trace.id)).toMatchObject({
      outcome: "semantic-used",
      reason: null,
      selectedChunks: [],
    });
  });

  it("never lets a withheld chunk reach hits or companion traces", async () => {
    const fixture = await createFixture();
    const control = await openRun(fixture, "semantic");
    const controlResult = await control.runtime.inspect(salaryQuery);
    const withheld = controlResult.hits.find(({ text }) => text.includes(withheldMarker));
    expect(withheld).toBeDefined();
    expect(controlResult.hits[0]?.chunkId).toBe(withheld?.chunkId);

    await sensitivity.addSensitivityRule({
      storeRoot: fixture.storeRoot,
      knowledgeBaseId: fixture.knowledgeBaseId,
      rule: { tier: "never-share", match: { kind: "heading-contains", text: "compensation" } },
    });
    const run = await openRun(fixture, "semantic", {}, "workspace-other");
    const result = await run.runtime.inspect(salaryQuery);
    expect(result.hits.map(({ text }) => text).join("\n")).not.toContain(withheldMarker);
    expect(result.hits.map(({ chunkId }) => chunkId)).not.toContain(withheld?.chunkId);

    const trace = tracesFor(run, salaryQuery)[0] as CandidateKnowledgeRetrievalTraceInput;
    expect(trace.selectedChunks.map(({ chunkId }) => chunkId)).not.toContain(withheld?.chunkId);
    const companion = await companionFor(fixture, trace.id, "workspace-other");
    expect(companion?.outcome).toBe("semantic-used");
    expect(companion?.selectedChunks.map(({ chunkId }) => chunkId)).not.toContain(
      withheld?.chunkId,
    );
  });

  it("stays within the pinned exact versions, knowledge bases and workspace", async () => {
    const fixture = await createFixture();
    // A newer version of the same source supersedes the old one; an unselected knowledge base also
    // mentions the topic.
    const newer = join(fixture.directory, "newer.md");
    await writeFile(newer, "# Newer\nOperated kubernetes clusters in a later version.\n", "utf8");
    await knowledge.appendKnowledgeSourceFileVersion({
      storeRoot: fixture.storeRoot,
      knowledgeBaseId: fixture.knowledgeBaseId,
      sourceId: fixture.sourceId,
      sourcePath: newer,
    });
    const view = await knowledge.createKnowledgeBase({
      storeRoot: fixture.storeRoot,
      displayName: "Unselected",
    });
    const otherKnowledgeBaseId =
      view.knowledgeBases.find(({ id }) => id !== fixture.knowledgeBaseId)?.id ?? "";
    const otherPath = join(fixture.directory, "other.md");
    await writeFile(otherPath, "# Other\nOperated kubernetes clusters elsewhere.\n", "utf8");
    await knowledge.importKnowledgeSourceFile({
      storeRoot: fixture.storeRoot,
      knowledgeBaseId: otherKnowledgeBaseId,
      sourcePath: otherPath,
    });

    const run = await openRun(fixture, "semantic");
    const result = await run.runtime.inspect(paraphrase);
    // Retrieval indexes the exact versions current at query time; superseded versions never leak.
    const current = await knowledge.createKnowledgeSelectionSnapshot({
      selections: [{ storeRoot: fixture.storeRoot, knowledgeBaseId: fixture.knowledgeBaseId }],
    });
    const currentVersion = current.entries[0]?.sources[0]?.versionId;
    expect(currentVersion).not.toBe(fixture.selection.entries[0]?.sources[0]?.versionId);
    expect(result.hits.length).toBeGreaterThan(0);
    for (const hit of result.hits) {
      expect(hit.metadata.provenance).toMatchObject({
        knowledgeBaseId: fixture.knowledgeBaseId,
        sourceId: fixture.sourceId,
        versionId: currentVersion,
      });
      expect(hit.text).not.toContain("beta platform");
    }
    expect(result.hits[0]?.text).toContain("later version");

    const trace = tracesFor(run, paraphrase)[0] as CandidateKnowledgeRetrievalTraceInput;
    expect(trace.workspaceId).toBe(workspaceId);
    expect(await companionFor(fixture, trace.id)).toMatchObject({
      outcome: "semantic-used",
      reason: null,
    });
    expect(await companionFor(fixture, trace.id, "workspace-other")).toBeUndefined();
  });

  it("opens one embedder for every run in the process", async () => {
    const fixture = await createFixture();
    const embedder = createFakeEmbedder();
    const shared = { embedder, shareEmbedder: true, modelDirectory: "/models/shared-one" };
    const first = await openRun(fixture, "semantic", shared);
    await first.runtime.inspect(paraphrase);
    const second = await openRun(fixture, "semantic", shared);
    const result = await second.runtime.inspect(paraphrase);
    expect(result.hits[0]?.text).toContain("kubernetes");
    expect(first.createEmbedderCalls() + second.createEmbedderCalls()).toBe(1);
    // A different model directory is a different model.
    const other = await openRun(fixture, "semantic", {
      ...shared,
      modelDirectory: "/models/shared-two",
    });
    await other.runtime.inspect(paraphrase);
    expect(other.createEmbedderCalls()).toBe(1);
  });

  it("does not cache a failed open, so a later run picks the model up", async () => {
    const fixture = await createFixture();
    const shared = { shareEmbedder: true, modelDirectory: "/models/shared-retry" };
    const failing = await openRun(fixture, "semantic", {
      ...shared,
      createEmbedderError: new Error("native runtime missing"),
    });
    await failing.runtime.inspect(paraphrase);
    expect(failing.createEmbedderCalls()).toBe(1);
    expect((await failing.runtime.retrievalModeDecision?.())?.effectiveMode).toBe("lexical");

    const retry = await openRun(fixture, "semantic", shared);
    const result = await retry.runtime.inspect(paraphrase);
    expect(retry.createEmbedderCalls()).toBe(1);
    expect((await retry.runtime.retrievalModeDecision?.())?.effectiveMode).toBe("semantic");
    expect(result.hits[0]?.text).toContain("kubernetes");
  });

  it("stops run setup before any query when the retrieval mode file is invalid", async () => {
    const fixture = await createFixture();
    await writeWorkspaceRetrievalMode(fixture.root, { mode: "semantic" });
    await writeFile(join(fixture.root, ".draft-loop", "retrieval-mode.json"), "{not json", "utf8");
    const appended = vi.fn();
    const created = vi.fn();
    await expect(
      openRunCandidateRetrieval(
        { appendCandidateKnowledgeRetrievalTrace: appended },
        fixture.root,
        {
          id: workspaceId,
          requiredSections: [],
          candidateKnowledgeSelection: {
            entries: [{ storeRoot: fixture.storeRoot, knowledgeBaseId: fixture.knowledgeBaseId }],
          },
        },
        { candidateKnowledgeSelection: fixture.selection } as unknown as ContextSnapshot,
        undefined,
        { createEmbedder: created },
      ),
    ).rejects.toThrow(retrievalModeInvalidMessage);
    expect(appended).not.toHaveBeenCalled();
    expect(created).not.toHaveBeenCalled();
  });
});
