import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CandidateKnowledgeLexicalHit,
  type CandidateKnowledgeRetrievalTrace,
  type CandidateKnowledgeRetrievalTraceInput,
  type ContextSnapshot,
  createCandidateKnowledgeLexicalHit,
  type ScoredEvidenceChunk,
} from "@draft-loop/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertCandidateKnowledgeProviderBounds,
  candidateKnowledgeChronologyProviderByteLimit,
  candidateKnowledgeChronologyQueries,
  requiresExperienceChronology,
  selectCandidateKnowledgeChronologyHits,
} from "./candidate-knowledge-chronology.js";
import { candidateKnowledgeRuntimeRetrieval } from "./candidate-knowledge-retrieval.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";

const createdAt = "2026-09-26T10:00:00.000Z";

function lexicalHit(
  chunkId: string,
  text: string,
  options: {
    readonly storeId?: string;
    readonly sourceId?: string;
    readonly ordinal?: number;
  } = {},
): CandidateKnowledgeLexicalHit {
  return createCandidateKnowledgeLexicalHit({
    chunkId,
    ordinal: options.ordinal ?? 0,
    lineStart: (options.ordinal ?? 0) + 1,
    lineEnd: (options.ordinal ?? 0) + 1,
    text,
    bm25Rank: 0,
    metadata: {
      provenance: {
        storeId: options.storeId ?? "store-a",
        knowledgeBaseId: "knowledge-a",
        sourceId: options.sourceId ?? "source-a",
        versionId: "version-a",
      },
    },
  });
}

function providerEvidence(id: string, text: string): ScoredEvidenceChunk {
  return {
    id,
    workspaceId: "workspace-1",
    sourceId: "source-1",
    ordinal: 0,
    lineStart: 1,
    lineEnd: 1,
    checksum: "a".repeat(64),
    text,
    rank: 0,
  };
}

describe("candidate knowledge chronology supplement", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  it("builds six lexical queries within the CKB term and query bounds", () => {
    expect(candidateKnowledgeChronologyQueries).toHaveLength(6);
    expect(candidateKnowledgeChronologyQueries[0]?.split(/\s+/u)).toEqual(
      expect.arrayContaining([
        "jan",
        "january",
        "feb",
        "february",
        "mar",
        "march",
        "apr",
        "april",
        "may",
        "jun",
        "june",
        "jul",
        "july",
        "aug",
        "august",
        "sep",
        "sept",
        "september",
        "oct",
        "october",
        "nov",
        "november",
        "dec",
        "december",
        "present",
        "current",
        "now",
      ]),
    );
    expect(
      candidateKnowledgeChronologyQueries.every(
        (query) => query.split(/\s+/u).length < 48 && query.length < 2_000,
      ),
    ).toBe(true);
    expect(
      candidateKnowledgeChronologyQueries
        .slice(1)
        .flatMap((query) => query.split(/\s+/u).map(Number)),
    ).toEqual(Array.from({ length: 200 }, (_, index) => 1900 + index));
    expect(requiresExperienceChronology([" education ", " professional experience "])).toBe(false);
    expect(requiresExperienceChronology([" education ", " E X P E R I E N C E "])).toBe(true);
  });

  it("keeps matched dated headings, ignores non-headings and bounded fallbacks", () => {
    const heading = lexicalHit(
      "dated",
      "## Juniper Systems — Engineer — January 2020 to December 2022",
    );
    const notHeading = lexicalHit("paragraph", "Work experience: January 2020 to December 2022");
    const fallback = lexicalHit(
      "fallback",
      "## Lumen Systems — Engineer — January 2023 to present",
    );

    expect(
      selectCandidateKnowledgeChronologyHits(
        [
          { status: "matched", hits: [notHeading, heading] },
          { status: "bounded-fallback", hits: [fallback] },
        ],
        20,
      ).map(({ chunkId }) => chunkId),
    ).toEqual(["dated"]);
  });

  it("deduplicates and orders headings by source provenance, ordinal, and id", () => {
    const later = lexicalHit("later", "## Lumen Systems — Engineer — January 2022 to present", {
      sourceId: "source-b",
      ordinal: 0,
    });
    const first = lexicalHit(
      "first",
      "## Juniper Systems — Engineer — January 2020 to December 2021",
      { sourceId: "source-a", ordinal: 1 },
    );
    const duplicateEarlierSource = lexicalHit(
      "duplicate",
      "## Duplicate — Engineer — January 2019 to December 2019",
      { storeId: "store-a", sourceId: "source-a", ordinal: 0 },
    );
    const duplicateLaterSource = lexicalHit(
      "duplicate",
      "## Duplicate — Engineer — January 2019 to December 2019",
      { storeId: "store-z", sourceId: "source-a", ordinal: 0 },
    );
    const results = [
      {
        status: "matched" as const,
        hits: [later, duplicateLaterSource, first, duplicateEarlierSource],
      },
    ];

    const selected = selectCandidateKnowledgeChronologyHits(results, 20);
    const reversed = selectCandidateKnowledgeChronologyHits(
      [{ status: "matched", hits: [...(results[0]?.hits ?? [])].reverse() }],
      20,
    );

    expect(selected.map(({ chunkId }) => chunkId)).toEqual(["duplicate", "first", "later"]);
    expect(selected[0]?.metadata.provenance.storeId).toBe("store-a");
    expect(reversed.map(({ chunkId }) => chunkId)).toEqual(selected.map(({ chunkId }) => chunkId));
  });

  it("fails closed on matched-query saturation and heading-count overflow", () => {
    const saturated = Array.from({ length: 100 }, (_, index) =>
      lexicalHit(`heading-${index}`, `## Role ${index} — January 2020 to December 2021`),
    );
    expect(() =>
      selectCandidateKnowledgeChronologyHits([{ status: "matched", hits: saturated }], 20),
    ).toThrow("Chronology query saturated its retrieval limit.");
    expect(
      selectCandidateKnowledgeChronologyHits([{ status: "bounded-fallback", hits: saturated }], 20),
    ).toEqual([]);
    expect(() =>
      selectCandidateKnowledgeChronologyHits(
        [
          {
            status: "matched",
            hits: [
              lexicalHit("one", "## One — January 2020 to December 2021"),
              lexicalHit("two", "## Two — January 2022 to present", { ordinal: 1 }),
            ],
          },
        ],
        1,
      ),
    ).toThrow("Chronology heading count exceeds the provider retrieval limit.");
  });

  it("enforces the final evidence byte cap", () => {
    const oversized = Array.from({ length: 35 }, (_, index) =>
      providerEvidence(`heading-${index}`, "x".repeat(4_000)),
    );

    expect(Buffer.byteLength(JSON.stringify(oversized), "utf8")).toBeGreaterThan(
      candidateKnowledgeChronologyProviderByteLimit,
    );
    expect(() => assertCandidateKnowledgeProviderBounds(oversized, 40)).toThrow(
      "Chronology evidence exceeds provider bounds.",
    );
  });

  it("retains dated employer headings beside dense job facts and required education", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-chronology-runtime-"));
    temporaryRoots.push(parent);
    const storeRoot = join(parent, "candidate-knowledge");
    const sourcePath = join(parent, "fictional-candidate.md");
    const denseFacts = Array.from(
      { length: 32 },
      (_, index) =>
        `Platform Engineer delivery workflow ${index + 1}: designed testing systems and build automation for engineering teams.`,
    );
    await writeFile(
      sourcePath,
      [
        "# Fictional Candidate",
        "",
        ...denseFacts,
        "",
        "## Juniper Civic Systems — Application Engineer — January 2018 to December 2020",
        "Maintained the inherited municipal scheduling service and added reliability fixes.",
        "",
        "## Lumen Works — Platform Engineer — January 2021 to present",
        "Built asynchronous ingestion and durable replay workflows.",
        "",
        "## Meadow Systems — Software Engineer — January 2008 to December 2017",
        "Maintained shared build tooling.",
        "",
        "Education",
        "",
        "Bachelor of Computing, Example University, 2017.",
      ].join("\n"),
      "utf8",
    );
    const ids = ["runtime-store", "runtime-ckb", "runtime-source", "runtime-version"];
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => createdAt,
    });
    await service.initializeStore({ storeRoot });
    await service.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId: "runtime-ckb",
      sourcePath,
    });
    const selection = await service.createKnowledgeSelectionSnapshot({
      selections: [{ storeRoot, knowledgeBaseId: "runtime-ckb" }],
    });
    const appendTrace = vi.fn(
      async (
        input: CandidateKnowledgeRetrievalTraceInput,
      ): Promise<CandidateKnowledgeRetrievalTrace> =>
        input as unknown as CandidateKnowledgeRetrievalTrace,
    );
    const runtime = candidateKnowledgeRuntimeRetrieval(
      { appendCandidateKnowledgeRetrievalTrace: appendTrace },
      {
        id: "workspace-1",
        requiredSections: ["Experience", "Education"],
        candidateKnowledgeSelection: {
          entries: [{ storeRoot, knowledgeBaseId: "runtime-ckb" }],
        },
      },
      { candidateKnowledgeSelection: selection } as ContextSnapshot,
    );
    if (runtime === undefined) throw new Error("Expected candidate knowledge runtime retrieval.");

    const result = await runtime.inspect("Platform Engineer");

    expect(result.hits.length).toBeLessThanOrEqual(20);
    expect(result.hits.map(({ text }) => text)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Juniper Civic Systems"),
        expect.stringContaining("Lumen Works"),
        expect.stringContaining("Bachelor of Computing"),
      ]),
    );
    expect(result.hits.some(({ text }) => text.includes("delivery workflow"))).toBe(true);
    expect(appendTrace).toHaveBeenCalledTimes(9);
    await expect(runtime.port.queryEvidence("Platform Engineer", { limit: 3 })).rejects.toThrow(
      "Chronology evidence could not fit within the provider retrieval limit.",
    );
    await expect(runtime.port.queryEvidence("Platform Engineer", { limit: 0 })).rejects.toThrow(
      "Candidate knowledge provider retrieval limit must be from 1 through 20.",
    );
    await expect(runtime.port.queryEvidence("Platform Engineer", { limit: 21 })).rejects.toThrow(
      "Candidate knowledge provider retrieval limit must be from 1 through 20.",
    );
  });
});
