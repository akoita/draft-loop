import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { EvidenceChunkRecord, EvidenceSourceRecord, WorkspaceRecord } from "./index.js";
import { openSqliteStorage } from "./index.js";

function workspace(id = "workspace-1"): WorkspaceRecord {
  return {
    id,
    state: "collecting",
    createdAt: "2026-08-13T10:00:00.000Z",
    updatedAt: "2026-08-13T10:00:00.000Z",
  };
}

function source(id: string, workspaceId = "workspace-1"): EvidenceSourceRecord {
  return {
    id,
    workspaceId,
    path: `sources/${id}.md`,
    mediaType: "text/markdown",
    checksum: "0123456789abcdef0123456789abcdef01234567",
    createdAt: "2026-08-13T10:00:00.000Z",
  };
}

function chunk(
  id: string,
  text: string,
  ordinal: number,
  workspaceId = "workspace-1",
  sourceId = "source-1",
): EvidenceChunkRecord {
  return {
    id,
    workspaceId,
    sourceId,
    ordinal,
    lineStart: ordinal * 10 + 1,
    lineEnd: (ordinal + 1) * 10,
    checksum: "0123456789abcdef0123456789abcdef01234567",
    text,
    createdAt: "2026-08-13T10:00:00.000Z",
  };
}

describe("SQLite FTS5 / BM25 Evidence Retrieval", () => {
  it("indexes and retrieves evidence chunks using BM25 ranking", async () => {
    const dir = await mkdtemp(join(tmpdir(), "draft-loop-retrieval-"));
    const storage = openSqliteStorage(join(dir, "workspace.sqlite"));

    await storage.saveWorkspace(workspace("ws-1"));
    await storage.saveEvidenceSource(source("src-1", "ws-1"));

    await storage.saveEvidenceChunk(
      chunk(
        "c-1",
        "Designed scalable distributed systems with Node.js and TypeScript.",
        0,
        "ws-1",
        "src-1",
      ),
    );
    await storage.saveEvidenceChunk(
      chunk("c-2", "Built React UI components and modern CSS design systems.", 1, "ws-1", "src-1"),
    );
    await storage.saveEvidenceChunk(
      chunk(
        "c-3",
        "Managed SQLite local database storage and offline synchronization.",
        2,
        "ws-1",
        "src-1",
      ),
    );

    // Single term search
    const tsResults = await storage.queryEvidence("TypeScript", { workspaceId: "ws-1" });
    expect(tsResults).toHaveLength(1);
    expect(tsResults[0]?.id).toBe("c-1");
    expect(tsResults[0]?.rank).toBeDefined();

    // Multi-term search
    const sqlResults = await storage.queryEvidence("SQLite database", { workspaceId: "ws-1" });
    expect(sqlResults).toHaveLength(1);
    expect(sqlResults[0]?.id).toBe("c-3");

    await storage.close();
  });

  it("retrieves relevant evidence from a long multi-sentence job description", async () => {
    const dir = await mkdtemp(join(tmpdir(), "draft-loop-retrieval-long-query-"));
    const storage = openSqliteStorage(join(dir, "workspace.sqlite"));

    await storage.saveWorkspace(workspace("ws-1"));
    await storage.saveEvidenceSource(source("src-1", "ws-1"));
    await storage.saveEvidenceChunk(
      chunk(
        "c-relevant",
        "Built event-driven data pipelines with Python, Airflow, dbt, and ClickHouse.",
        0,
        "ws-1",
        "src-1",
      ),
    );
    await storage.saveEvidenceChunk(
      chunk("c-unrelated", "Designed accessible React component libraries.", 1, "ws-1", "src-1"),
    );

    const description = `
      We are looking for a senior data engineer to join our remote product team.
      The successful candidate will design reliable event-driven pipelines and operate
      production analytics systems using Python, Airflow, dbt, and ClickHouse while
      collaborating with product and infrastructure stakeholders.
    `;
    const inspection = await storage.inspectEvidenceRetrieval(description, {
      workspaceId: "ws-1",
      limit: 5,
    });

    expect(inspection.status).toBe("matched");
    expect(inspection.hits.map((hit) => hit.id)).toContain("c-relevant");
    expect(inspection.selectedSourceCount).toBe(1);
    await storage.close();
  });

  it("bounds and de-duplicates stop-word-heavy queries without collapsing retrieval", async () => {
    const dir = await mkdtemp(join(tmpdir(), "draft-loop-retrieval-bounded-query-"));
    const storage = openSqliteStorage(join(dir, "workspace.sqlite"));

    await storage.saveWorkspace(workspace("ws-1"));
    await storage.saveEvidenceSource(source("src-1", "ws-1"));
    await storage.saveEvidenceChunk(
      chunk("c-1", "Operated reliable distributed data platforms.", 0, "ws-1", "src-1"),
    );

    const noise = Array.from({ length: 200 }, (_, index) => `keyword${index}`).join(" ");
    const inspection = await storage.inspectEvidenceRetrieval(
      `the and we are looking for reliable reliable distributed ${noise}`,
      { workspaceId: "ws-1" },
    );

    expect(inspection.status).toBe("matched");
    expect(inspection.hits[0]?.id).toBe("c-1");
    await storage.close();
  });

  it("distinguishes an empty index from a deterministic workspace-scoped fallback", async () => {
    const dir = await mkdtemp(join(tmpdir(), "draft-loop-retrieval-fallback-"));
    const storage = openSqliteStorage(join(dir, "workspace.sqlite"));

    await storage.saveWorkspace(workspace("ws-empty"));
    await expect(
      storage.inspectEvidenceRetrieval("quantum chemistry", { workspaceId: "ws-empty" }),
    ).resolves.toMatchObject({
      status: "not-indexed",
      indexedChunkCount: 0,
      selectedChunkCount: 0,
      selectedSourceCount: 0,
      hits: [],
    });

    await storage.saveWorkspace(workspace("ws-alpha"));
    await storage.saveEvidenceSource(source("src-alpha", "ws-alpha"));
    await storage.saveEvidenceChunk(
      chunk("alpha-2", "Private platform operations.", 1, "ws-alpha", "src-alpha"),
    );
    await storage.saveEvidenceChunk(
      chunk("alpha-1", "Private backend delivery.", 0, "ws-alpha", "src-alpha"),
    );
    await storage.saveWorkspace(workspace("ws-beta"));
    await storage.saveEvidenceSource(source("src-beta", "ws-beta"));
    await storage.saveEvidenceChunk(
      chunk("beta-1", "Other workspace material.", 0, "ws-beta", "src-beta"),
    );

    const first = await storage.inspectEvidenceRetrieval("quantum chemistry", {
      workspaceId: "ws-alpha",
      limit: 1,
    });
    const second = await storage.inspectEvidenceRetrieval("quantum chemistry", {
      workspaceId: "ws-alpha",
      limit: 1,
    });
    expect(first).toMatchObject({
      status: "fallback",
      indexedChunkCount: 2,
      selectedChunkCount: 1,
      selectedSourceCount: 1,
    });
    expect(first.hits.map((hit) => hit.id)).toEqual(["alpha-1"]);
    expect(second.hits).toEqual(first.hits);
    expect(first.hits.every((hit) => hit.workspaceId === "ws-alpha")).toBe(true);
    await storage.close();
  });

  it("strictly enforces workspace isolation in retrieval queries (T-008)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "draft-loop-retrieval-iso-"));
    const storage = openSqliteStorage(join(dir, "workspace.sqlite"));

    await storage.saveWorkspace(workspace("ws-alpha"));
    await storage.saveEvidenceSource(source("src-alpha", "ws-alpha"));
    await storage.saveEvidenceChunk(
      chunk("c-alpha", "Confidential architecture for Project Alpha.", 0, "ws-alpha", "src-alpha"),
    );

    await storage.saveWorkspace(workspace("ws-beta"));
    await storage.saveEvidenceSource(source("src-beta", "ws-beta"));
    await storage.saveEvidenceChunk(
      chunk("c-beta", "Confidential architecture for Project Beta.", 0, "ws-beta", "src-beta"),
    );

    // Searching within ws-alpha only returns ws-alpha chunks
    const alphaHits = await storage.queryEvidence("Confidential architecture", {
      workspaceId: "ws-alpha",
    });
    expect(alphaHits).toHaveLength(1);
    expect(alphaHits[0]?.id).toBe("c-alpha");
    expect(alphaHits[0]?.workspaceId).toBe("ws-alpha");

    // Searching within ws-beta only returns ws-beta chunks
    const betaHits = await storage.queryEvidence("Confidential architecture", {
      workspaceId: "ws-beta",
    });
    expect(betaHits).toHaveLength(1);
    expect(betaHits[0]?.id).toBe("c-beta");
    expect(betaHits[0]?.workspaceId).toBe("ws-beta");

    await storage.close();
  });

  it("handles punctuation, special characters, and empty queries safely", async () => {
    const dir = await mkdtemp(join(tmpdir(), "draft-loop-retrieval-safe-"));
    const storage = openSqliteStorage(join(dir, "workspace.sqlite"));

    await storage.saveWorkspace(workspace("ws-1"));
    await storage.saveEvidenceSource(source("src-1", "ws-1"));
    await storage.saveEvidenceChunk(
      chunk("c-1", "Full-stack developer with C++ and C# experience.", 0, "ws-1", "src-1"),
    );

    // Punctuation and symbols should not crash FTS5
    await expect(storage.queryEvidence("!@#$%^&*()")).resolves.toEqual([]);
    await expect(storage.queryEvidence("")).resolves.toEqual([]);
    await expect(storage.queryEvidence("   ")).resolves.toEqual([]);
    await expect(storage.queryEvidence("' OR '1'='1")).resolves.toEqual([]);

    // Hyphenated search
    const results = await storage.queryEvidence("Full-stack", { workspaceId: "ws-1" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]?.id).toBe("c-1");

    await storage.close();
  });

  it("respects limit parameter in retrieval options", async () => {
    const dir = await mkdtemp(join(tmpdir(), "draft-loop-retrieval-limit-"));
    const storage = openSqliteStorage(join(dir, "workspace.sqlite"));

    await storage.saveWorkspace(workspace("ws-1"));
    await storage.saveEvidenceSource(source("src-1", "ws-1"));

    for (let i = 0; i < 10; i++) {
      await storage.saveEvidenceChunk(
        chunk(
          `chunk-${i}`,
          `Engineering leadership and distributed systems contribution ${i}`,
          i,
          "ws-1",
          "src-1",
        ),
      );
    }

    const limited = await storage.queryEvidence("Engineering leadership", {
      workspaceId: "ws-1",
      limit: 3,
    });
    expect(limited).toHaveLength(3);

    await storage.close();
  });
});
