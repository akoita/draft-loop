import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CandidateKnowledgeLexicalChunkInput,
  type CandidateKnowledgeLexicalHit,
  type CandidateKnowledgeRetrievalTrace,
  type CandidateKnowledgeRetrievalTraceInput,
  type CandidateKnowledgeSelectionSnapshot,
  type ContextSnapshot,
  createCandidateKnowledgeLexicalHit,
} from "@draft-loop/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as experienceBodyEvidence from "./candidate-experience-body-evidence.js";
import { combineCandidateExperienceBodyEvidence } from "./candidate-experience-body-evidence.js";
import { candidateKnowledgeChronologyProviderByteLimit } from "./candidate-knowledge-chronology.js";
import { candidateKnowledgeRuntimeRetrieval } from "./candidate-knowledge-retrieval.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";

const provenance = {
  storeId: "store-a",
  knowledgeBaseId: "knowledge-a",
  sourceId: "source-a",
  versionId: "version-a",
};

function sourceChunk(
  chunkId: string,
  ordinal: number,
  text: string,
  lineStart: number,
  lineEnd = lineStart,
  source = provenance,
): CandidateKnowledgeLexicalChunkInput {
  return {
    chunkId,
    ordinal,
    lineStart,
    lineEnd,
    text,
    metadata: { provenance: source },
  };
}

function hit(input: CandidateKnowledgeLexicalChunkInput): CandidateKnowledgeLexicalHit {
  return createCandidateKnowledgeLexicalHit({ ...input, bm25Rank: 0 });
}

describe("candidate experience body evidence", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  it("retains nested body chunks, stops at the next same-level heading, and has stable provenance IDs", () => {
    const heading = sourceChunk(
      "role-a",
      0,
      "## Juniper Systems — Engineer — January 2020 to December 2021",
      1,
    );
    const chunks = [
      heading,
      sourceChunk("body-a", 1, "Maintained the inherited scheduling service.", 3),
      sourceChunk("nested-heading", 2, "### Reliability work", 5),
      sourceChunk("nested-body", 3, "Added retry handling and regression tests.", 6),
      sourceChunk("nested-role", 4, "### Other Employer — January 2021 to December 2022", 8),
      sourceChunk("nested-role-body", 5, "Delivered work for the other employer.", 9),
      sourceChunk("role-b", 6, "## Lumen Works — Engineer — January 2022 to present", 11),
      sourceChunk("body-b", 7, "Built asynchronous ingestion and replay.", 13),
    ];
    const original = hit(heading);
    const combined = combineCandidateExperienceBodyEvidence([original], chunks)[0];
    if (combined === undefined) throw new Error("Expected a combined role record.");

    expect(combined.text).toContain("Maintained the inherited scheduling service.");
    expect(combined.text).toContain("### Reliability work");
    expect(combined.text).toContain("Added retry handling and regression tests.");
    expect(combined.text).not.toContain("Other Employer");
    expect(combined.text).not.toContain("Delivered work for the other employer.");
    expect(combined.text).not.toContain("Lumen Works");
    expect(combined.chunkId).not.toBe(original.chunkId);
    expect(combined.lineStart).toBe(1);
    expect(combined.lineEnd).toBe(6);
    expect(combined.metadata.provenance).toEqual(provenance);
    expect(combineCandidateExperienceBodyEvidence([original], chunks)[0]?.chunkId).toBe(
      combined.chunkId,
    );
  });

  it("does not cross provenance or accept a mismatched pinned heading", () => {
    const heading = sourceChunk("role-a", 0, "## Juniper — Engineer — January 2020 to present", 1);
    const otherSource = { ...provenance, sourceId: "source-b" };
    const otherVersion = { ...provenance, versionId: "version-b" };
    const composed = combineCandidateExperienceBodyEvidence(
      [hit(heading)],
      [
        heading,
        sourceChunk("foreign-body", 1, "Foreign-source accomplishment.", 3, 3, otherSource),
        sourceChunk(
          "foreign-version-body",
          2,
          "Foreign-version accomplishment.",
          4,
          4,
          otherVersion,
        ),
      ],
    );
    expect(composed[0]?.text).toBe(heading.text);
    expect(composed[0]?.chunkId).toBe(heading.chunkId);
    expect(() =>
      combineCandidateExperienceBodyEvidence(
        [hit(heading)],
        [sourceChunk("role-a", 0, "Altered source text", 1)],
      ),
    ).toThrow("Chronology heading did not match its pinned source chunk.");
  });

  it("does not truncate or skip an overflowing whole paragraph", () => {
    const heading = sourceChunk("role-a", 0, "## Juniper — Engineer — January 2020 to present", 1);
    const longBody = sourceChunk("body-a", 1, "A".repeat(3_990), 3);
    const laterBody = sourceChunk("body-b", 2, "Later supported detail.", 5);
    const result = combineCandidateExperienceBodyEvidence(
      [hit(heading)],
      [heading, longBody, laterBody],
    );

    expect(result[0]?.text).toBe(heading.text);
    expect(result[0]?.text).not.toContain("Later supported detail.");
  });

  it("uses only the dated source line and stops at a nested dated role in the same chunk", () => {
    const headingText = "## Juniper Systems — Engineer — January 2020 to present";
    const accomplishment =
      "- Maintained the inherited scheduling service and fixed reliability issues.";
    const nestedRole = "#### Other Employer — January 2024 to present";
    const nestedAccomplishment = "- Built an unrelated event pipeline.";
    const prefix = `${headingText}\nIntro `;
    const suffix = `\n### Contributions\n${accomplishment}\n${nestedRole}\n${nestedAccomplishment}`;
    const text = `${prefix}${"x".repeat(3_990 - prefix.length - suffix.length)}${suffix}`;
    const source = sourceChunk("combined-role-source", 0, text, 1, text.split("\n").length);
    const original = hit(source);
    const result = combineCandidateExperienceBodyEvidence(
      [original],
      [source],
      "scheduling reliability inherited",
    );

    expect(text).toHaveLength(3_990);
    expect(result[0]?.text).toBe(`${headingText}\n\n${accomplishment}`);
    expect(result[0]?.text).not.toContain("Intro");
    expect(result[0]?.text).not.toContain("Other Employer");
    expect(result[0]?.chunkId).not.toBe(original.chunkId);
    expect(result[0]?.text.length).toBeLessThanOrEqual(4_000);
  });

  it("hands off bounded role records with body text and required section records from a pinned CKB", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-experience-body-"));
    temporaryRoots.push(parent);
    const storeRoot = join(parent, "candidate-knowledge");
    const sourcePath = join(parent, "fictional-candidate.md");
    const sourceText = [
      "# Fictional Candidate",
      "",
      ...Array.from(
        { length: 18 },
        (_, index) =>
          `Engineering delivery ${index + 1}: platform testing and service reliability practices.`,
      ),
      "",
      "## Juniper Civic Systems — Application Engineer — January 2018 to December 2020",
      "",
      ...Array.from(
        { length: 18 },
        (_, index) =>
          `Platform team context ${index + 1}: coordinated shared service ownership and engineering planning across distributed teams. ${"Planning context. ".repeat(12)}`,
      ),
      "",
      "### CV-usable facts",
      "- Maintained the inherited municipal scheduling service and fixed recurring reliability issues.",
      "  Caveat: the scheduling service was inherited and was not created by the candidate.",
      "- Added retry-safe validation and regression tests for event processing.",
      "- Improved delivery handoffs for event processing reliability.",
      "",
      "### Interview notes",
      "Discussed event processing tradeoffs during a planning exercise.",
      "",
      "## Lumen Works — Backend Engineer — January 2021 to December 2023",
      "",
      "Built a parcel-event ingestion service with idempotent replay and partial-failure handling.",
      "",
      "## Northstar Systems — Platform Engineer — January 2024 to present",
      "",
      "Introduced build checks and contract tests that the team retained.",
      "",
      "## Education",
      "",
      "Bachelor of Computing, Example University, 2017.",
      "",
      "## Certifications",
      "",
      "Cloud Platform Practitioner Certificate, 2022.",
      "",
      "## Languages",
      "",
      "English — fluent; French — professional working proficiency.",
      "",
      "**Production experience:** Operated Java services in production with retries and incident response.",
    ].join("\n");
    await writeFile(sourcePath, sourceText, "utf8");

    const generatedIds = [
      "experience-body-store",
      "experience-body-ckb",
      "experience-body-source",
      "experience-body-version",
    ];
    const service = createCandidateKnowledgeStoreService({
      generateId: () => generatedIds.shift() ?? "unexpected-id",
    });
    await service.initializeStore({ storeRoot });
    await service.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId: "experience-body-ckb",
      sourcePath,
    });
    const selection = await service.createKnowledgeSelectionSnapshot({
      selections: [{ storeRoot, knowledgeBaseId: "experience-body-ckb" }],
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
        requiredSections: ["Experience", "Education", "Certifications", "Languages", "Skills"],
        candidateKnowledgeSelection: {
          entries: [{ storeRoot, knowledgeBaseId: "experience-body-ckb" }],
        },
      },
      { candidateKnowledgeSelection: selection } as ContextSnapshot,
    );
    if (runtime === undefined) throw new Error("Expected candidate knowledge runtime retrieval.");

    const jobQuery = "event processing scheduling reliability inherited retry tests";
    const result = await runtime.inspect(jobQuery);
    const roleHits = result.hits.filter(({ text }) =>
      /^## (?:Juniper Civic Systems|Lumen Works|Northstar Systems)/u.test(text),
    );
    expect(roleHits).toHaveLength(3);
    expect(roleHits.map(({ text }) => text)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Maintained the inherited municipal scheduling service"),
        expect.stringContaining("Built a parcel-event ingestion service with idempotent replay"),
        expect.stringContaining("Introduced build checks and contract tests"),
      ]),
    );
    const juniper = roleHits.find(({ text }) => text.includes("Juniper Civic Systems"));
    if (juniper === undefined) throw new Error("Expected the Juniper role record.");
    expect(juniper.text).not.toContain("### CV-usable facts");
    expect(juniper.text).toContain("Caveat: the scheduling service was inherited");
    expect(juniper.text).not.toContain("Platform team context");
    expect(juniper.text).not.toContain("Interview notes");
    expect(juniper.text).not.toContain("Lumen Works");
    expect(juniper.lineEnd).toBeGreaterThan(juniper.lineStart);
    const lumen = roleHits.find(({ text }) => text.includes("Lumen Works"));
    const northstar = roleHits.find(({ text }) => text.includes("Northstar Systems"));
    expect(lumen?.text).toContain("Built a parcel-event ingestion service");
    expect(lumen?.text).not.toContain("Northstar Systems");
    expect(northstar?.text).toContain("Introduced build checks and contract tests");
    expect(roleHits.every(({ lineEnd, lineStart }) => lineEnd > lineStart)).toBe(true);
    expect(result.hits.map(({ text }) => text)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Bachelor of Computing, Example University, 2017"),
        expect.stringContaining("Cloud Platform Practitioner Certificate, 2022"),
        expect.stringContaining("English — fluent; French — professional working proficiency"),
        expect.stringContaining("Production experience:"),
      ]),
    );
    expect(result.hits.length).toBeLessThanOrEqual(20);
    expect(Buffer.byteLength(JSON.stringify(result.hits), "utf8")).toBeLessThanOrEqual(
      candidateKnowledgeChronologyProviderByteLimit,
    );
    expect(roleHits.every(({ text }) => text.length <= 4_000)).toBe(true);

    const repeated = await runtime.inspect(jobQuery);
    expect(
      repeated.hits
        .filter(({ text }) =>
          /^## (?:Juniper Civic Systems|Lumen Works|Northstar Systems)/u.test(text),
        )
        .map(({ chunkId }) => chunkId),
    ).toEqual(roleHits.map(({ chunkId }) => chunkId));

    const directResult = await service.queryCandidateKnowledge({
      selections: [{ storeRoot, knowledgeBaseId: "experience-body-ckb" }],
      purpose: "achievement-recall",
      query: "Juniper Civic Systems Application Engineer",
      limit: 20,
    });
    const rawJuniperHeading = directResult.hits.find(({ text }) =>
      text.includes("Juniper Civic Systems"),
    );
    if (rawJuniperHeading === undefined) throw new Error("Expected the raw Juniper CKB hit.");
    expect(result.hits.map(({ chunkId }) => chunkId)).not.toContain(rawJuniperHeading.chunkId);
    const diagnosticIds = new Set(
      result.diagnostics.flatMap(({ selectedChunks }) =>
        selectedChunks.map(({ chunkId }) => chunkId),
      ),
    );
    expect(result.hits.every(({ chunkId }) => diagnosticIds.has(chunkId))).toBe(true);
    const wrongVersionSnapshot = {
      ...selection,
      entries: selection.entries.map((entry) => ({
        ...entry,
        sources: entry.sources.map((source) => ({
          ...source,
          versionId: `missing-${source.versionId}` as typeof source.versionId,
        })),
      })),
    } satisfies CandidateKnowledgeSelectionSnapshot;
    const mismatchedLoader = experienceBodyEvidence.createPinnedCandidateKnowledgeSourceChunkLoader(
      [{ storeRoot, knowledgeBaseId: "experience-body-ckb" }],
      wrongVersionSnapshot,
    );
    await expect(mismatchedLoader([rawJuniperHeading])).rejects.toThrow(
      "Pinned candidate knowledge evidence could not be verified.",
    );

    const bodyLoader = vi.fn(async () => []);
    vi.spyOn(
      experienceBodyEvidence,
      "createPinnedCandidateKnowledgeSourceChunkLoader",
    ).mockReturnValue(bodyLoader);
    const noExperienceRuntime = candidateKnowledgeRuntimeRetrieval(
      { appendCandidateKnowledgeRetrievalTrace: appendTrace },
      {
        id: "workspace-without-experience",
        requiredSections: ["Education"],
        candidateKnowledgeSelection: {
          entries: [{ storeRoot, knowledgeBaseId: "experience-body-ckb" }],
        },
      },
      { candidateKnowledgeSelection: selection } as ContextSnapshot,
    );
    if (noExperienceRuntime === undefined) {
      throw new Error("Expected the non-Experience candidate knowledge runtime.");
    }
    await noExperienceRuntime.inspect("Bachelor of Computing");
    expect(bodyLoader).not.toHaveBeenCalled();
  });
});
