import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CandidateKnowledgeLexicalChunkInput,
  CandidateKnowledgeLexicalHit,
  CandidateKnowledgeRetrievalTrace,
  CandidateKnowledgeRetrievalTraceInput,
  CandidateKnowledgeSelectionSnapshot,
  ContextSnapshot,
} from "@draft-loop/domain";
import {
  createCandidateKnowledgeLexicalHit,
  createCandidateKnowledgeRetrievalSourceVersionReference,
} from "@draft-loop/domain";
import * as knowledgeStore from "@draft-loop/storage/knowledge-store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPinnedCandidateKnowledgeSourceReferenceChunkLoader } from "./candidate-experience-body-evidence.js";
import {
  candidateKnowledgeChronologyLocalSourceByteLimit,
  candidateKnowledgeChronologyQueries,
  selectCandidateKnowledgeChronologyHits,
  selectCandidateKnowledgeChronologySourceChunks,
} from "./candidate-knowledge-chronology.js";
import { candidateKnowledgeRuntimeRetrieval } from "./candidate-knowledge-retrieval.js";
import type {
  CandidateKnowledgeRetrievalResult,
  QueryCandidateKnowledgeCommand,
} from "./knowledge-base.js";
import * as knowledgeBase from "./knowledge-base.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";

const createdAt = "2026-09-26T10:00:00.000Z";
const saturationQuery = candidateKnowledgeChronologyQueries[0];

function hit(
  index: number,
  text: string,
  provenance: CandidateKnowledgeLexicalHit["metadata"]["provenance"],
): CandidateKnowledgeLexicalHit {
  return createCandidateKnowledgeLexicalHit({
    chunkId: `probe-${index}`,
    ordinal: index,
    lineStart: index + 1,
    lineEnd: index + 1,
    text,
    bm25Rank: index,
    metadata: { provenance },
  });
}

function sourceChunk(index: number, text: string): CandidateKnowledgeLexicalChunkInput {
  return {
    chunkId: `source-${index}`,
    ordinal: index,
    lineStart: index + 1,
    lineEnd: index + 1,
    text,
    metadata: {
      provenance: {
        storeId: "store-a",
        knowledgeBaseId: "knowledge-a",
        sourceId: "source-a",
        versionId: "version-a",
      },
    },
  };
}

describe("saturated chronology local source scan", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  async function createFixture(sourceText: string, prefix: string) {
    const parent = await mkdtemp(join(tmpdir(), `draft-loop-${prefix}-`));
    temporaryRoots.push(parent);
    const storeRoot = join(parent, "candidate-knowledge");
    const sourcePath = join(parent, "fictional-candidate.md");
    await writeFile(sourcePath, sourceText, "utf8");
    const ids = [`${prefix}-store`, `${prefix}-ckb`, `${prefix}-source`, `${prefix}-version`];
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => createdAt,
    });
    await service.initializeStore({ storeRoot });
    await service.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId: `${prefix}-ckb`,
      sourcePath,
    });
    const selection = await service.createKnowledgeSelectionSnapshot({
      selections: [{ storeRoot, knowledgeBaseId: `${prefix}-ckb` }],
    });
    return { storeRoot, service, selection };
  }

  function onlyReference(selection: CandidateKnowledgeSelectionSnapshot) {
    const entry = selection.entries[0];
    const source = entry?.sources[0];
    if (entry === undefined || source === undefined) throw new Error("Missing fictional source.");
    return {
      storeId: entry.storeId,
      knowledgeBaseId: entry.knowledgeBaseId,
      sourceId: source.sourceId,
      versionId: source.versionId,
    };
  }

  function installQueryFixture(
    service: ReturnType<typeof createCandidateKnowledgeStoreService>,
    provenance: CandidateKnowledgeLexicalHit["metadata"]["provenance"],
    saturated: boolean,
  ) {
    const noQuery: CandidateKnowledgeRetrievalResult = {
      status: "no-query",
      indexedChunkCount: 0,
      selectedChunkCount: 0,
      selectedSourceCount: 0,
      hits: [],
      diagnostics: [],
    };
    const saturatedResult: CandidateKnowledgeRetrievalResult = {
      status: "matched",
      indexedChunkCount: 105,
      selectedChunkCount: 100,
      selectedSourceCount: 1,
      hits: Array.from({ length: 100 }, (_, index) =>
        hit(index, `Employment note: January 2020 to December 2021, item ${index}.`, provenance),
      ),
      diagnostics: [],
    };
    const queryCandidateKnowledge = vi.fn(
      async (
        command: QueryCandidateKnowledgeCommand,
      ): Promise<CandidateKnowledgeRetrievalResult> =>
        saturated && command.query === saturationQuery ? saturatedResult : noQuery,
    );
    vi.spyOn(knowledgeBase, "createCandidateKnowledgeStoreService").mockReturnValue({
      ...service,
      queryCandidateKnowledge,
      createCandidateKnowledgeQueryBatch: (selection) => ({
        query: (query) => queryCandidateKnowledge({ ...selection, ...query }),
        verify: async () => undefined,
      }),
    });
    return queryCandidateKnowledge;
  }

  it("recovers all dated headings from pinned sources when a body-date probe saturates", async () => {
    const bodyDateMatches = Array.from(
      { length: 105 },
      (_, index) => `Work note ${index + 1}: January 2020 to December 2021.`,
    );
    const sourceText = [
      "# Fictional Candidate",
      "",
      ...bodyDateMatches,
      "",
      "## Juniper Systems — Engineer — January 2018 to December 2019",
      "Maintained a fictional scheduling service.",
      "",
      "## Lumen Works — Platform Engineer — January 2020 to December 2022",
      "Built a fictional asynchronous ingestion system.",
      "",
      "## Meadow Labs — Developer — January 2023 to present",
      "Documented a fictional operations workflow.",
    ].join("\n");
    const { storeRoot, service, selection } = await createFixture(sourceText, "saturated");
    const reference = onlyReference(selection);
    installQueryFixture(service, reference, true);
    const appendTrace = vi.fn(
      async (
        input: CandidateKnowledgeRetrievalTraceInput,
      ): Promise<CandidateKnowledgeRetrievalTrace> =>
        input as unknown as CandidateKnowledgeRetrievalTrace,
    );
    const runtime = candidateKnowledgeRuntimeRetrieval(
      { appendCandidateKnowledgeRetrievalTrace: appendTrace },
      {
        id: "fictional-workspace",
        requiredSections: ["Experience"],
        candidateKnowledgeSelection: {
          entries: [{ storeRoot, knowledgeBaseId: reference.knowledgeBaseId }],
        },
      },
      { candidateKnowledgeSelection: selection } as ContextSnapshot,
    );
    if (runtime === undefined) throw new Error("Expected fictional retrieval runtime.");

    const result = await runtime.inspect("fictional engineering");
    const roleHeadings = result.hits
      .map(({ text }) => text.split("\n", 1)[0] ?? "")
      .filter((text) => /^## (?:Juniper Systems|Lumen Works|Meadow Labs)/u.test(text));

    expect(roleHeadings).toEqual([
      "## Juniper Systems — Engineer — January 2018 to December 2019",
      "## Lumen Works — Platform Engineer — January 2020 to December 2022",
      "## Meadow Labs — Developer — January 2023 to present",
    ]);
    expect(appendTrace).toHaveBeenCalledTimes(0);
  });

  it("fails the bounded local scan on byte overflow and source verification failures", async () => {
    const { storeRoot, selection } = await createFixture(
      "# Fictional Candidate\n\n## Juniper Systems — Engineer — January 2020 to present\nMaintained a fictional service.\n",
      "bounded",
    );
    const reference = onlyReference(selection);
    const load = createPinnedCandidateKnowledgeSourceReferenceChunkLoader(
      [{ storeRoot, knowledgeBaseId: reference.knowledgeBaseId }],
      selection,
    );

    await expect(load([reference], 1)).rejects.toThrow(
      "Pinned candidate knowledge scan exceeded its local text limit.",
    );
    await expect(load([{ ...reference, versionId: "missing-version" }])).rejects.toThrow(
      "Pinned candidate knowledge evidence could not be verified.",
    );
  });

  it("rejects an unverifiable managed payload whose bytes no longer match its checksum", async () => {
    const { storeRoot, selection } = await createFixture(
      "# Fictional Candidate\n\nFictional checksum verification source.\n",
      "checksum",
    );
    const reference = onlyReference(selection);
    const openOriginal = knowledgeStore.openCandidateKnowledgeStore;
    vi.spyOn(knowledgeStore, "openCandidateKnowledgeStore").mockImplementation(async (root) => {
      const handle = await openOriginal(root);
      return {
        ...handle,
        readManagedCandidateKnowledgeSourceVersion: async (...args) => {
          const content = await handle.readManagedCandidateKnowledgeSourceVersion(...args);
          if (content === undefined) return undefined;
          const bytes = Buffer.from(content.bytes);
          bytes[0] = (bytes[0] ?? 0) ^ 0xff;
          return { ...content, bytes };
        },
      };
    });
    const load = createPinnedCandidateKnowledgeSourceReferenceChunkLoader(
      [{ storeRoot, knowledgeBaseId: reference.knowledgeBaseId }],
      selection,
    );

    await expect(load([reference])).rejects.toThrow(
      "Pinned candidate knowledge evidence could not be verified.",
    );
  });

  it("rejects more complete headings than the provider retrieval bound without truncation", () => {
    const headings = Array.from({ length: 21 }, (_, index) =>
      sourceChunk(index, `## Role ${index} — January 2020 to December 2021`),
    );

    expect(() => selectCandidateKnowledgeChronologySourceChunks(headings, 20)).toThrow(
      "Chronology heading count exceeds the provider retrieval limit.",
    );
  });

  it("keeps the unsaturated probe selector on its existing bounded path", () => {
    const selected = hit(0, "## Fictional Role — January 2020 to present", {
      ...createCandidateKnowledgeRetrievalSourceVersionReference({
        storeId: "store-a",
        knowledgeBaseId: "knowledge-a",
        sourceId: "source-a",
        versionId: "version-a",
      }),
    });
    expect(
      selectCandidateKnowledgeChronologyHits([{ status: "matched", hits: [selected] }], 20),
    ).toEqual([selected]);
    expect(candidateKnowledgeChronologyLocalSourceByteLimit).toBe(512 * 1024);
  });
});
