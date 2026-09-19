import { readFileSync } from "node:fs";

import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import {
  type EvidenceChunkRecord,
  type EvidenceSourceRecord,
  openSqliteStorage,
  type WorkspaceRecord,
} from "@draft-loop/storage";
import { describe, expect, it } from "vitest";

import {
  benchmarkRetrieval,
  createHybridRetriever,
  LocalVectorRetriever,
  type RetrievalBenchmarkCase,
} from "./index.js";

interface RetrievalFixture {
  readonly workspaceId: string;
  readonly sourceId: string;
  readonly corpus: readonly {
    readonly id: string;
    readonly text: string;
    readonly ordinal: number;
  }[];
  readonly cases: readonly Omit<RetrievalBenchmarkCase, "corpus">[];
}

const fixtureText = readFileSync(
  new URL("../fixtures/retrieval-quality/cases.json", import.meta.url),
  "utf8",
);
const fixture = JSON.parse(fixtureText) as RetrievalFixture;
const timestamp = "2026-09-19T18:00:00.000Z";
const checksum = "a".repeat(64);

function workspace(): WorkspaceRecord {
  return {
    id: fixture.workspaceId,
    state: "collecting",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function source(): EvidenceSourceRecord {
  return {
    id: fixture.sourceId,
    workspaceId: fixture.workspaceId,
    path: "fixture://sanitized/retrieval-source",
    mediaType: "text/markdown",
    checksum,
    createdAt: timestamp,
  };
}

function chunk(input: RetrievalFixture["corpus"][number]): EvidenceChunkRecord {
  return {
    ...input,
    workspaceId: fixture.workspaceId,
    sourceId: fixture.sourceId,
    lineStart: input.ordinal + 1,
    lineEnd: input.ordinal + 1,
    checksum,
    createdAt: timestamp,
  };
}

describe("production lexical retrieval baseline", () => {
  it("contains only invented local fixture content", () => {
    expect(fixtureText).not.toContain("anthropic");
    expect(fixtureText).not.toContain("openai");
    expect(fixtureText).not.toContain("/private/");
    expect(fixtureText).not.toContain("@draft-loop");
  });

  it("compares SQLite BM25 with the local term-frequency hybrid deterministically", async () => {
    const storage = openSqliteStorage(":memory:");
    try {
      await storage.saveWorkspace(workspace());
      await storage.saveEvidenceSource(source());
      for (const fixtureChunk of fixture.corpus)
        await storage.saveEvidenceChunk(chunk(fixtureChunk));

      const corpus: readonly ScoredEvidenceChunk[] = fixture.corpus.map((fixtureChunk) => ({
        ...chunk(fixtureChunk),
        rank: 0,
      }));
      const cases: readonly RetrievalBenchmarkCase[] = fixture.cases.map((benchmarkCase) => ({
        ...benchmarkCase,
        corpus,
      }));
      const lexical = {
        mode: "lexical" as const,
        queryEvidence: (query: string) =>
          storage.queryEvidence(query, { workspaceId: fixture.workspaceId, limit: 3 }),
      };
      const localVector = new LocalVectorRetriever(corpus);
      const hybridPort = createHybridRetriever(lexical, localVector);
      const hybrid = {
        mode: "hybrid" as const,
        queryEvidence: (query: string) => hybridPort.queryEvidence(query, { limit: 3 }),
      };

      const first = await benchmarkRetrieval(cases, lexical, hybrid);
      const second = await benchmarkRetrieval(cases, lexical, hybrid);

      expect(second).toEqual(first);
      expect(first).toEqual({
        baselineMode: "lexical",
        candidateMode: "hybrid",
        caseCount: 3,
        baselineMetrics: {
          citationAccuracy: 1,
          requirementCoverage: 1,
          irrelevantContextRatio: 0,
          unsupportedClaimCount: 0,
          meanReciprocalRank: 1,
        },
        candidateMetrics: {
          citationAccuracy: 2 / 3,
          requirementCoverage: 1,
          irrelevantContextRatio: 1 / 3,
          unsupportedClaimCount: 0,
          meanReciprocalRank: 1,
        },
        deltas: {
          citationAccuracyDelta: -0.33333333333333337,
          requirementCoverageDelta: 0,
          irrelevantContextRatioDelta: 1 / 3,
          unsupportedClaimDelta: 0,
          meanReciprocalRankDelta: 0,
        },
        passed: false,
        regressionReasons: ["Citation accuracy dropped by 0.3333"],
      });
      await expect(
        storage.queryEvidence("TypeScript", { workspaceId: "other-workspace", limit: 3 }),
      ).resolves.toEqual([]);
    } finally {
      await storage.close();
    }
  });
});
