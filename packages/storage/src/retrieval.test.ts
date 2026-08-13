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
