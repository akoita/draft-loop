import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CandidateKnowledgeRetrievalTrace,
  CandidateKnowledgeRetrievalTraceInput,
  ContextSnapshot,
} from "@draft-loop/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { candidateKnowledgeChronologyProviderByteLimit } from "./candidate-knowledge-chronology.js";
import { candidateKnowledgeRuntimeRetrieval } from "./candidate-knowledge-retrieval.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";

describe("candidate knowledge retrieval with requested independent projects", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  it("retains requested project details alongside contact, chronology, and section reservations", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-requested-projects-"));
    temporaryRoots.push(parent);
    const storeRoot = join(parent, "candidate-knowledge");
    const sourcePath = join(parent, "fictional-candidate.md");
    const sourceText = [
      "# Fictional Candidate",
      "",
      "**Candidate contact:** Fictional Candidate | email: fictional.candidate@example.invalid | phone: +1 202 555 0100 | https://linkedin.com/in/fictional-candidate",
      "",
      ...Array.from(
        { length: 12 },
        (_, index) =>
          `## Fictional Employer ${index + 1} — Platform Engineer — January ${2000 + index} to December ${2000 + index}\nMaintained a fictional service and documented reliable operations.\n`,
      ),
      "## Independent Work — January 2022 to present",
      "**MessageBridge**, a Java event-processing service.",
      "- Built a Java event processor with reliable asynchronous replay.",
      "**CivicShelf / Civic Catalog**, a community library catalogue.",
      "- Curated a searchable lending index for community equipment.",
      "",
      "## Education",
      "Bachelor of Computing, Fictional University, 2019.",
    ].join("\n");
    await writeFile(sourcePath, sourceText, "utf8");

    const ids = ["requested-store", "requested-ckb", "requested-source", "requested-version"];
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
    });
    await service.initializeStore({ storeRoot });
    await service.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId: "requested-ckb",
      sourcePath,
    });
    const selection = await service.createKnowledgeSelectionSnapshot({
      selections: [{ storeRoot, knowledgeBaseId: "requested-ckb" }],
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
        id: "workspace-requested-projects",
        requiredSections: ["Experience", "Education"],
        candidateKnowledgeSelection: {
          entries: [{ storeRoot, knowledgeBaseId: "requested-ckb" }],
        },
      },
      {
        candidateKnowledgeSelection: selection,
        candidateInstructions: "Prioritize Civic Catalog before MessageBridge.",
      } as ContextSnapshot,
    );
    if (runtime === undefined) throw new Error("Expected candidate knowledge retrieval.");

    const result = await runtime.inspect("Java event processing");
    const independent = result.hits.find(({ text }) =>
      text.startsWith("## Independent Work — January 2022 to present"),
    );
    if (independent === undefined) throw new Error("Expected the independent work record.");

    expect(independent.text.indexOf("**CivicShelf / Civic Catalog**")).toBeLessThan(
      independent.text.indexOf("**MessageBridge**"),
    );
    expect(independent.text).toContain(
      "Curated a searchable lending index for community equipment.",
    );
    expect(independent.text).toContain(
      "Built a Java event processor with reliable asynchronous replay.",
    );
    expect(independent.text.length).toBeLessThanOrEqual(4_000);
    expect(independent.metadata.provenance).toMatchObject({
      storeId: "requested-store",
      knowledgeBaseId: "requested-ckb",
      sourceId: "requested-source",
      versionId: "requested-version",
    });
    expect(result.hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining("fictional.candidate@example.invalid"),
        }),
        expect.objectContaining({ text: expect.stringContaining("Fictional Employer 1") }),
        expect.objectContaining({ text: expect.stringContaining("Fictional Employer 12") }),
        expect.objectContaining({ text: expect.stringContaining("Bachelor of Computing") }),
      ]),
    );
    expect(
      result.hits.filter(({ text }) => /^## .*\b(?:19|20)\d{2}.*\bto\b/iu.test(text)),
    ).toHaveLength(13);
    expect(result.hits.length).toBeLessThanOrEqual(20);
    expect(Buffer.byteLength(JSON.stringify(result.hits), "utf8")).toBeLessThanOrEqual(
      candidateKnowledgeChronologyProviderByteLimit,
    );
    const selectedIds = new Set(
      result.diagnostics.flatMap(({ selectedChunks }) =>
        selectedChunks.map(({ chunkId }) => chunkId),
      ),
    );
    expect(result.hits.every(({ chunkId }) => selectedIds.has(chunkId))).toBe(true);
  });
});
