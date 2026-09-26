import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CandidateKnowledgeLexicalHit,
  type CandidateKnowledgeRetrievalTrace,
  type CandidateKnowledgeRetrievalTraceInput,
  type ContextSnapshot,
  createCandidateKnowledgeLexicalHit,
} from "@draft-loop/domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import { candidateKnowledgeRuntimeRetrieval } from "./candidate-knowledge-retrieval.js";
import {
  candidatePriorityEvidenceChunkLimit,
  candidatePriorityEvidenceQuery,
  candidatePriorityEvidenceQueryLimit,
  candidatePriorityEvidenceTextLimit,
  selectCandidatePriorityEvidence,
} from "./candidate-priority-evidence.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";

const createdAt = "2026-09-26T10:00:00.000Z";
const candidateInstructions = "Production Java contributions";

function lexicalHit(chunkId: string, text: string, bm25Rank = 0): CandidateKnowledgeLexicalHit {
  return createCandidateKnowledgeLexicalHit({
    chunkId,
    ordinal: bm25Rank,
    lineStart: bm25Rank + 1,
    lineEnd: bm25Rank + 1,
    text,
    bm25Rank,
    metadata: {
      provenance: {
        storeId: "store-a",
        knowledgeBaseId: "knowledge-a",
        sourceId: "source-a",
        versionId: "version-a",
      },
    },
  });
}

async function createRuntimeFixture(
  temporaryRoots: string[],
  extraHeadingCount = 11,
  extraExperienceEvidence = false,
) {
  const parent = await mkdtemp(join(tmpdir(), "draft-loop-priority-runtime-"));
  temporaryRoots.push(parent);
  const storeRoot = join(parent, "candidate-knowledge");
  const sourcePath = join(parent, "fictional-candidate.md");
  const denseJobFacts = Array.from(
    { length: 32 },
    (_, index) =>
      `Platform Engineer delivery workflow ${index + 1}: designed testing systems and build automation for engineering teams.`,
  );
  await writeFile(
    sourcePath,
    [
      "# Fictional Candidate",
      "",
      ...denseJobFacts,
      "",
      ...(extraExperienceEvidence
        ? ["Experience as an engineer includes reliability work and service maintenance.", ""]
        : []),
      "## Juniper Civic Systems — Application Engineer — January 2018 to December 2020",
      "Maintained the inherited municipal scheduling service and added reliability fixes.",
      "",
      "## Lumen Works — Platform Engineer — January 2021 to present",
      "Built asynchronous ingestion and durable replay workflows.",
      "",
      ...Array.from(
        { length: extraHeadingCount },
        (_, index) =>
          `## Fictional archived assignment ${index + 1} — January 2000 to December 2001\nMaintained an internal service.\n`,
      ),
      "Production Java contribution: implemented Kafka event ingestion with idempotent replay and regression tests.",
      "",
      "Production Java contribution: built reliable retries and deduplication for asynchronous jobs.",
      "",
      "Production Java contribution: added integration checks to the release pipeline.",
      "",
      "## Education",
      "",
      "Bachelor of Computing, Example University, 2017.",
    ].join("\n"),
    "utf8",
  );
  const ids = ["priority-store", "priority-ckb", "priority-source", "priority-version"];
  const service = createCandidateKnowledgeStoreService({
    generateId: () => ids.shift() ?? "unexpected-id",
    now: () => createdAt,
  });
  await service.initializeStore({ storeRoot });
  await service.importKnowledgeSourceFile({
    storeRoot,
    knowledgeBaseId: "priority-ckb",
    sourcePath,
  });
  const selection = await service.createKnowledgeSelectionSnapshot({
    selections: [{ storeRoot, knowledgeBaseId: "priority-ckb" }],
  });
  const appendTrace = vi.fn(
    async (
      input: CandidateKnowledgeRetrievalTraceInput,
    ): Promise<CandidateKnowledgeRetrievalTrace> =>
      input as unknown as CandidateKnowledgeRetrievalTrace,
  );
  return { storeRoot, selection, appendTrace };
}

function createRuntime(
  fixture: Awaited<ReturnType<typeof createRuntimeFixture>>,
  instructions: string,
  requiredSections = ["Experience", "Education"],
) {
  const runtime = candidateKnowledgeRuntimeRetrieval(
    { appendCandidateKnowledgeRetrievalTrace: fixture.appendTrace },
    {
      id: "workspace-1",
      requiredSections,
      candidateKnowledgeSelection: {
        entries: [{ storeRoot: fixture.storeRoot, knowledgeBaseId: "priority-ckb" }],
      },
    },
    {
      candidateKnowledgeSelection: fixture.selection,
      candidateInstructions: instructions,
    } as ContextSnapshot,
  );
  if (runtime === undefined) throw new Error("Expected candidate knowledge runtime retrieval.");
  return runtime;
}

describe("candidate-priority evidence", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  it("trims and bounds instruction queries, skipping blank input", () => {
    expect(candidatePriorityEvidenceQuery(" \n\t ")).toBeUndefined();
    expect(candidatePriorityEvidenceQuery(undefined)).toBeUndefined();
    expect(candidatePriorityEvidenceQuery("  prioritize Java contributions  ")).toBe(
      "prioritize Java contributions",
    );
    const bounded = candidatePriorityEvidenceQuery(` ${"x".repeat(2_001)} `);
    expect(bounded).toHaveLength(candidatePriorityEvidenceTextLimit);
    expect(candidatePriorityEvidenceQueryLimit).toBe(20);
    expect(candidatePriorityEvidenceChunkLimit).toBe(3);
  });

  it("selects matched body chunks in query order, excluding headings and duplicates", () => {
    const first = lexicalHit("first", "Production Java event ingestion.", 0);
    const second = lexicalHit("second", "Production Java test automation.", 1);
    const result = {
      status: "matched" as const,
      hits: [
        lexicalHit("heading-undated", "## Experience"),
        first,
        lexicalHit("heading-dated", "### Juniper — January 2020 to December 2021"),
        first,
        second,
        lexicalHit("fourth", "Production Java deployment tooling.", 3),
      ],
    };

    expect(selectCandidatePriorityEvidence(result, 20).map(({ chunkId }) => chunkId)).toEqual([
      "first",
      "second",
      "fourth",
    ]);
    expect(selectCandidatePriorityEvidence(result, 1).map(({ chunkId }) => chunkId)).toEqual([
      "first",
    ]);
    expect(
      selectCandidatePriorityEvidence({ status: "bounded-fallback", hits: result.hits }, 20),
    ).toEqual([]);
  });

  it("preserves a requested contribution alongside chronology and required-section evidence", async () => {
    const fixture = await createRuntimeFixture(temporaryRoots);
    const runtime = createRuntime(fixture, candidateInstructions);

    const result = await runtime.inspect("Platform Engineer");

    expect(result.hits.map(({ text }) => text)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Juniper Civic Systems"),
        expect.stringContaining("Lumen Works"),
        expect.stringContaining("Production Java contribution: implemented Kafka event ingestion"),
        expect.stringContaining("Bachelor of Computing"),
      ]),
    );
    const contribution = result.hits.find((hit) => hit.text.includes("Kafka event ingestion"));
    expect(contribution?.metadata.provenance).toMatchObject({
      storeId: "priority-store",
      knowledgeBaseId: "priority-ckb",
      sourceId: "priority-source",
      versionId: "priority-version",
    });
    expect(
      result.diagnostics[0]?.selectedChunks.some(
        ({ chunkId }) => chunkId === contribution?.chunkId,
      ),
    ).toBe(true);
    expect(
      result.hits.filter(({ text }) => /^## .*\b(?:19|20)\d{2}.*\bto\b/u.test(text)),
    ).toHaveLength(13);
    expect(result.hits.length).toBeLessThanOrEqual(20);
    expect(fixture.appendTrace).toHaveBeenCalledTimes(10);
  });

  it("adds no priority query for blank instructions", async () => {
    const fixture = await createRuntimeFixture(temporaryRoots);
    const runtime = createRuntime(fixture, " ");
    const result = await runtime.inspect("Platform Engineer");
    expect(result.hits.some(({ text }) => text.includes("Kafka event ingestion"))).toBe(false);
    expect(fixture.appendTrace).toHaveBeenCalledTimes(9);
  });

  it("keeps the largest priority prefix that fits beside chronology and education", async () => {
    const fixture = await createRuntimeFixture(temporaryRoots, 0);
    const runtime = createRuntime(fixture, candidateInstructions);
    const result = await runtime.port.queryEvidence("Platform Engineer", { limit: 4 });

    expect(result.filter(({ text }) => /^## .*\b(?:19|20)\d{2}/u.test(text))).toHaveLength(2);
    expect(result.filter(({ text }) => text.includes("Production Java contribution"))).toHaveLength(
      1,
    );
    expect(result.some(({ text }) => text.includes("Bachelor of Computing"))).toBe(true);
    expect(result).toHaveLength(4);
  });

  it("fits chronology when reserved priority evidence replaces redundant section supplements", async () => {
    const fixture = await createRuntimeFixture(temporaryRoots, 0, true);
    const withoutPriorities = createRuntime(fixture, "");
    await expect(
      withoutPriorities.port.queryEvidence("Platform Engineer", { limit: 3 }),
    ).rejects.toThrow("Chronology evidence could not fit");
    const runtime = createRuntime(fixture, "Education Bachelor Java");
    const result = await runtime.port.queryEvidence("Platform Engineer", { limit: 3 });
    expect(result.filter(({ text }) => /^## .*\b(?:19|20)\d{2}/u.test(text))).toHaveLength(2);
    expect(result.some(({ text }) => text.includes("Bachelor of Computing"))).toBe(true);
    expect(result).toHaveLength(3);
  });

  it("fails closed when no priority candidate fits beside chronology and education", async () => {
    const fixture = await createRuntimeFixture(temporaryRoots, 0);
    const runtime = createRuntime(fixture, candidateInstructions);

    await expect(runtime.port.queryEvidence("Platform Engineer", { limit: 3 })).rejects.toThrow(
      "Candidate-priority evidence could not fit within the provider retrieval limit.",
    );
  });
});
