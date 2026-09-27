import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CandidateKnowledgeRetrievalTrace,
  CandidateKnowledgeRetrievalTraceInput,
  ContextSnapshot,
} from "@draft-loop/domain";
import { createCandidateKnowledgeLexicalHit } from "@draft-loop/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as experienceBodyEvidence from "./candidate-experience-body-evidence.js";
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
      "All independent projects are prototypes, not in production.",
      "**MessageBridge**, a Java event-processing service.",
      `- Built a Java event processor with reliable asynchronous replay. ${"Fictional bounded detail. ".repeat(55)}`,
      "**Honesty constraints:** Prototype only; no production users.",
      "**CivicShelf / Civic Catalog**, a community library catalogue.",
      `- Curated a searchable lending index for community equipment. ${"Fictional bounded detail. ".repeat(55)}`,
      "**Honesty constraints:** Demonstration only; no production users.",
      "**AsterKit**, a fictional civic archive.",
      `- Catalogued a complete collection of community equipment records. ${"Fictional bounded detail. ".repeat(55)}`,
      "**Honesty constraints:** Prototype only; no production users.",
      "**BerylHub**, a fictional library index.",
      `- Built a complete fictional borrowing index for library tools. ${"Fictional bounded detail. ".repeat(55)}`,
      "**Honesty constraints:** Demonstration only; no production users.",
      "",
      "## Summary",
      "Professional summary: Fictional candidate with a background in platform engineering.",
      "",
      "## Education",
      "Bachelor of Computing, Fictional University, 2019.",
      "",
      "## Certifications",
      "Fictional Platform Operations Certificate, 2021.",
      "",
      "## Languages",
      "English — fluent; French — professional working proficiency.",
      "",
      "**Production experience:** Operated Java services with retries and incident response.",
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
        requiredSections: [
          "Summary",
          "Experience",
          "Education",
          "Certifications",
          "Languages",
          "Skills",
        ],
        candidateKnowledgeSelection: {
          entries: [{ storeRoot, knowledgeBaseId: "requested-ckb" }],
        },
      },
      {
        candidateKnowledgeSelection: selection,
        candidateInstructions: "Prioritize Civic Catalog, AsterKit, BerylHub, then MessageBridge.",
      } as ContextSnapshot,
    );
    if (runtime === undefined) throw new Error("Expected candidate knowledge retrieval.");

    const result = await runtime.inspect("Java event processing");
    const independent = result.hits.find(({ text }) =>
      text.startsWith("## Independent Work — January 2022 to present"),
    );
    if (independent === undefined) throw new Error("Expected the independent work record.");

    expect(independent.text.indexOf("**CivicShelf / Civic Catalog**")).toBeLessThan(
      independent.text.indexOf("**AsterKit**"),
    );
    expect(independent.text).toContain(
      "Curated a searchable lending index for community equipment.",
    );
    expect(independent.text).not.toContain("**MessageBridge**");
    expect(independent.text).not.toContain("**BerylHub**");
    expect(independent.text).toContain(
      "All independent projects are prototypes, not in production.",
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
        expect.objectContaining({
          text: expect.stringContaining("a background in platform engineering"),
        }),
        expect.objectContaining({
          text: expect.stringContaining("Fictional Platform Operations Certificate"),
        }),
        expect.objectContaining({
          text: expect.stringContaining(
            "English — fluent; French — professional working proficiency",
          ),
        }),
        expect.objectContaining({ text: expect.stringContaining("Production experience:") }),
        expect.objectContaining({ text: expect.stringContaining("**BerylHub**") }),
        expect.objectContaining({ text: expect.stringContaining("**MessageBridge**") }),
      ]),
    );
    const overflowHits = result.hits.filter(({ text }) =>
      /^\*\*(?:BerylHub|MessageBridge)\*\*/u.test(text),
    );
    expect(overflowHits).toHaveLength(1);
    expect(overflowHits[0]?.text).toContain("**BerylHub**");
    expect(overflowHits[0]?.text).toContain("**MessageBridge**");
    for (const overflow of overflowHits) {
      expect(overflow.text).toContain("Honesty constraints");
      expect(overflow.text).toContain(
        "All independent projects are prototypes, not in production.",
      );
      expect(overflow.text.length).toBeLessThanOrEqual(4_000);
      expect(overflow.metadata.provenance).toMatchObject({
        storeId: "requested-store",
        knowledgeBaseId: "requested-ckb",
        sourceId: "requested-source",
        versionId: "requested-version",
      });
    }
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

    const overflowCandidates = Array.from({ length: 4 }, (_, index) =>
      createCandidateKnowledgeLexicalHit({
        chunkId: `over-capacity-project-${index}`,
        ordinal: independent.ordinal,
        lineStart: independent.lineEnd + index + 1,
        lineEnd: independent.lineEnd + index + 1,
        text: `**OverflowProject${index}**, complete fictional contribution and caveat.`,
        metadata: independent.metadata,
        bm25Rank: independent.bm25Rank,
      }),
    );
    vi.spyOn(experienceBodyEvidence, "composeCandidateExperienceBodyEvidence").mockImplementation(
      (chronologyHits) => ({ chronologyHits, requestedProjectOverflowHits: overflowCandidates }),
    );
    const overCapacityRuntime = candidateKnowledgeRuntimeRetrieval(
      { appendCandidateKnowledgeRetrievalTrace: appendTrace },
      {
        id: "workspace-over-capacity-projects",
        requiredSections: [
          "Summary",
          "Experience",
          "Education",
          "Certifications",
          "Languages",
          "Skills",
        ],
        candidateKnowledgeSelection: {
          entries: [{ storeRoot, knowledgeBaseId: "requested-ckb" }],
        },
      },
      {
        candidateKnowledgeSelection: selection,
        candidateInstructions: "Prioritize fictional project evidence.",
      } as ContextSnapshot,
    );
    if (overCapacityRuntime === undefined) {
      throw new Error("Expected over-capacity candidate knowledge retrieval.");
    }
    await expect(overCapacityRuntime.inspect("Java event processing")).rejects.toThrow(
      "Requested independent project evidence exceeds the bounded priority evidence slots.",
    );
  });
});
