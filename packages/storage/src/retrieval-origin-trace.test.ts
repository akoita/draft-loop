import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteStorage, StorageConflictError, StorageValidationError } from "./index.js";
import type { RetrievalOriginTraceInput } from "./retrieval-origin-trace.js";

interface RawDatabase {
  readonly prepare: (sql: string) => {
    readonly get: (...args: unknown[]) => Record<string, unknown> | undefined;
    readonly run: (...args: unknown[]) => unknown;
  };
  readonly close: () => void;
}

const openRaw = createRequire(import.meta.url)("better-sqlite3") as new (
  path: string,
) => RawDatabase;

const workspaceId = "workspace-origin";
const createdAt = "2026-10-10T10:00:00.000Z";

const trace: RetrievalOriginTraceInput = {
  workspaceId,
  traceId: "origin-trace-1",
  queryChecksum: "a".repeat(64),
  profile: { profileId: "Default profile", version: 3, checksum: "b".repeat(64) },
  factRankingMode: "hybrid",
  selectedItems: [
    { itemId: "profile-fact-0123456789abcdef", origin: "profile-fact", sourceId: "ckb-source-1" },
    { itemId: "chunk-a1", origin: "knowledge-chunk", sourceId: "ckb-source-1" },
    { itemId: "chunk-b1", origin: "knowledge-chunk", sourceId: "ckb-source-2" },
  ],
  createdAt,
};

describe("retrieval origin trace storage", () => {
  let directory: string;
  let filename: string;
  let storage: SqliteStorage;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "draft-loop-origin-trace-"));
    filename = join(directory, "workspace.sqlite");
    storage = new SqliteStorage(filename);
  });

  afterEach(async () => {
    storage.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("writes and reads a trace with its profile reference and item origins", async () => {
    const port = storage.candidateKnowledgeRetrievalOriginTrace;
    const record = await port.appendRetrievalOriginTrace(trace);

    expect(record).toEqual({ ...trace, payloadChecksum: expect.stringMatching(/^[0-9a-f]{64}$/u) });
    await expect(port.getRetrievalOriginTrace(workspaceId, trace.traceId)).resolves.toEqual(record);
    await expect(port.getRetrievalOriginTrace(workspaceId, "missing")).resolves.toBeUndefined();

    const later = await port.appendRetrievalOriginTrace({
      ...trace,
      traceId: "origin-trace-2",
      factRankingMode: "lexical",
      selectedItems: [],
      createdAt: "2026-10-10T10:00:01.000Z",
    });
    await expect(port.listRetrievalOriginTraces(workspaceId)).resolves.toEqual([record, later]);
    await expect(port.listRetrievalOriginTraces("other-workspace")).resolves.toEqual([]);
  });

  it("stores only ids, origins and counts", async () => {
    await storage.candidateKnowledgeRetrievalOriginTrace.appendRetrievalOriginTrace(trace);
    const raw = new openRaw(filename);
    const row = raw
      .prepare(
        "SELECT payload_json, fact_count, chunk_count FROM candidate_knowledge_retrieval_origin_traces WHERE trace_id = ?",
      )
      .get(trace.traceId) as { payload_json: string; fact_count: number; chunk_count: number };
    raw.close();

    expect(row).toMatchObject({ fact_count: 1, chunk_count: 2 });
    expect(JSON.parse(row.payload_json)).toEqual({ selectedItems: trace.selectedItems });
  });

  it("is idempotent for an identical trace and rejects a different one as a conflict", async () => {
    const port = storage.candidateKnowledgeRetrievalOriginTrace;
    const first = await port.appendRetrievalOriginTrace(trace);

    await expect(port.appendRetrievalOriginTrace(trace)).resolves.toEqual(first);
    for (const changed of [
      { selectedItems: trace.selectedItems.slice(1) },
      { profile: { ...trace.profile, version: 4 } },
      { factRankingMode: "lexical" as const },
      { queryChecksum: "c".repeat(64) },
    ]) {
      await expect(port.appendRetrievalOriginTrace({ ...trace, ...changed })).rejects.toThrow(
        StorageConflictError,
      );
    }
    await expect(port.getRetrievalOriginTrace(workspaceId, trace.traceId)).resolves.toEqual(first);
  });

  it("blocks updates and deletes", async () => {
    await storage.candidateKnowledgeRetrievalOriginTrace.appendRetrievalOriginTrace(trace);
    const raw = new openRaw(filename);
    expect(() =>
      raw
        .prepare(
          "UPDATE candidate_knowledge_retrieval_origin_traces SET fact_ranking_mode = 'lexical'",
        )
        .run(),
    ).toThrow(/immutable/u);
    expect(() =>
      raw.prepare("DELETE FROM candidate_knowledge_retrieval_origin_traces").run(),
    ).toThrow(/immutable/u);
    raw.close();
  });

  it("rejects content-bearing, unexpected and malformed fields", async () => {
    const port = storage.candidateKnowledgeRetrievalOriginTrace;
    for (const extra of [{ query: "raw query" }, { factValue: "TypeScript" }, { quote: "x" }]) {
      await expect(
        port.appendRetrievalOriginTrace({ ...trace, ...extra } as never),
      ).rejects.toThrow(/unexpected fields/u);
    }
    await expect(
      port.appendRetrievalOriginTrace({
        ...trace,
        selectedItems: [
          { itemId: "chunk-a1", origin: "knowledge-chunk", sourceId: "s", text: "chunk text" },
        ],
      } as never),
    ).rejects.toThrow(/unexpected fields/u);
    const invalid: readonly Partial<RetrievalOriginTraceInput>[] = [
      { queryChecksum: "not-a-checksum" },
      { profile: { ...trace.profile, checksum: "B".repeat(64) } },
      { profile: { ...trace.profile, version: 0 } },
      { profile: { ...trace.profile, profileId: " padded " } },
      { factRankingMode: "full-source" as never },
      {
        selectedItems: [
          { itemId: "chunk a1", origin: "knowledge-chunk", sourceId: "ckb-source-1" },
        ],
      },
      {
        selectedItems: [{ itemId: "chunk-a1", origin: "profile-quote" as never, sourceId: "s" }],
      },
      { selectedItems: [trace.selectedItems[1], trace.selectedItems[1]] as never },
      { createdAt: "yesterday" },
    ];
    for (const changed of invalid) {
      await expect(
        port.appendRetrievalOriginTrace({ ...trace, ...changed }),
      ).rejects.toBeInstanceOf(StorageValidationError);
    }
  });

  it("rejects a stored payload whose checksum no longer matches", async () => {
    await storage.candidateKnowledgeRetrievalOriginTrace.appendRetrievalOriginTrace(trace);
    const raw = new openRaw(filename);
    raw.prepare("DROP TRIGGER candidate_knowledge_retrieval_origin_traces_immutable_update").run();
    raw
      .prepare(
        "UPDATE candidate_knowledge_retrieval_origin_traces SET payload_json = '{\"selectedItems\":[]}'",
      )
      .run();
    raw.close();

    await expect(
      storage.candidateKnowledgeRetrievalOriginTrace.getRetrievalOriginTrace(
        workspaceId,
        trace.traceId,
      ),
    ).rejects.toThrow(/checksum does not match/u);
  });
});
