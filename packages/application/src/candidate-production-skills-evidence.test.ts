import { createHash } from "node:crypto";
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

import { candidateKnowledgeChronologyProviderByteLimit } from "./candidate-knowledge-chronology.js";
import { candidateKnowledgeRuntimeRetrieval } from "./candidate-knowledge-retrieval.js";
import {
  candidateProductionSkillsEvidenceQuery,
  candidateProductionSkillsEvidenceQueryLimit,
  isProductionSkillsRecord,
  selectCandidateProductionSkillsEvidence,
} from "./candidate-production-skills-evidence.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";
import {
  isSkillsRequiredSection,
  matchesRequiredSectionEvidence,
} from "./required-section-evidence.js";

const createdAt = "2026-09-26T10:00:00.000Z";

function lexicalHit(chunkId: string, text: string): CandidateKnowledgeLexicalHit {
  return createCandidateKnowledgeLexicalHit({
    chunkId,
    ordinal: 0,
    lineStart: 1,
    lineEnd: 1,
    text,
    bm25Rank: 0,
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

async function createRuntimeFixture(temporaryRoots: string[], includeProductionRecord = true) {
  const parent = await mkdtemp(join(tmpdir(), "draft-loop-production-skills-"));
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
      ...Array.from(
        { length: 11 },
        (_, index) =>
          `## Fictional archived assignment ${index + 1} — January 2000 to December 2001\nMaintained an internal service.\n`,
      ),
      "Skills and technology transition: moved from PHP to Java as the platform adopted event processing; this records a stack change, not a production accomplishment.",
      "",
      ...(includeProductionRecord
        ? [
            ...Array.from(
              { length: 64 },
              (_, index) =>
                `Archive marker ${index + 1}: retained source ordering without added interpretation.`,
            ),
            "",
            "**Production experience:** Operated Java event processors in production, handling retries and on-call incidents.",
            "",
          ]
        : []),
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
    ].join("\n"),
    "utf8",
  );
  const ids = [
    "production-skills-store",
    "production-skills-ckb",
    "production-skills-source",
    "production-skills-version",
  ];
  const service = createCandidateKnowledgeStoreService({
    generateId: () => ids.shift() ?? "unexpected-id",
    now: () => createdAt,
  });
  await service.initializeStore({ storeRoot });
  await service.importKnowledgeSourceFile({
    storeRoot,
    knowledgeBaseId: "production-skills-ckb",
    sourcePath,
  });
  const selection = await service.createKnowledgeSelectionSnapshot({
    selections: [{ storeRoot, knowledgeBaseId: "production-skills-ckb" }],
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
  requiredSections: readonly string[],
) {
  const runtime = candidateKnowledgeRuntimeRetrieval(
    { appendCandidateKnowledgeRetrievalTrace: fixture.appendTrace },
    {
      id: "workspace-1",
      requiredSections,
      candidateKnowledgeSelection: {
        entries: [{ storeRoot: fixture.storeRoot, knowledgeBaseId: "production-skills-ckb" }],
      },
    },
    { candidateKnowledgeSelection: fixture.selection } as ContextSnapshot,
  );
  if (runtime === undefined) throw new Error("Expected candidate knowledge runtime retrieval.");
  return runtime;
}

describe("candidate production skills evidence", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  it("accepts only substantive plain or bold Production experience records", () => {
    expect(
      isProductionSkillsRecord(
        "Production experience: operated Java services and owned their reliability.",
      ),
    ).toBe(true);
    expect(
      isProductionSkillsRecord(
        "**Production experience:** operated Java services and owned their reliability.",
      ),
    ).toBe(true);
    expect(
      isProductionSkillsRecord(
        "**Production experience**: operated Java services and owned their reliability.",
      ),
    ).toBe(true);

    for (const text of [
      "## Production experience",
      "Production experience:",
      "Production experience:\nOperated Java services in production.",
      "Production experience: unavailable",
      "Production experience: not recorded",
      "Production experience: no production experience recorded",
      "Production experience: - none listed",
      "Production experience: none",
      "Production experience: lacks evidence",
      "Production experience: lacking evidence",
      "**Production experience:** N/A",
    ]) {
      expect(isProductionSkillsRecord(text), text).toBe(false);
    }
  });

  it("selects the first valid matched record and ignores fallbacks", () => {
    const first = lexicalHit(
      "first-record",
      "**Production experience:** operated a Java service in production.",
    );
    const second = lexicalHit("second-record", "Production experience: built service checks.");
    const staleTransition = lexicalHit(
      "transition",
      "Technology transition: moved from PHP to Java and learned event processing.",
    );
    expect(
      selectCandidateProductionSkillsEvidence({
        status: "matched",
        hits: [staleTransition, first, second],
      }),
    ).toBe(first);
    expect(
      selectCandidateProductionSkillsEvidence({ status: "bounded-fallback", hits: [first] }),
    ).toBeUndefined();
    expect(
      selectCandidateProductionSkillsEvidence({ status: "matched", hits: [staleTransition] }),
    ).toBeUndefined();
  });

  it("adds production records to the Skills vocabulary without dropping existing matching", () => {
    const transition =
      "Technology transition: moved from PHP to Java and learned event processing.";
    const record = "Production experience: operated a Java event processor in production.";
    expect(isSkillsRequiredSection("Skills")).toBe(true);
    expect(isSkillsRequiredSection(" Technical Skills ")).toBe(true);
    expect(isSkillsRequiredSection("Education")).toBe(false);
    expect(matchesRequiredSectionEvidence("Skills", record)).toBe(true);
    expect(matchesRequiredSectionEvidence("Technical Skills", transition)).toBe(true);
  });

  it("reserves the explicit record with chronology and actual required records", async () => {
    const fixture = await createRuntimeFixture(temporaryRoots);
    const runtime = createRuntime(fixture, [
      "Experience",
      "Education",
      "Certifications",
      "Languages",
      "Technical Skills",
      "Skills",
    ]);

    const result = await runtime.inspect("Platform Engineer");
    const productionRecord = result.hits.find(({ text }) =>
      text.includes("**Production experience:**"),
    );

    expect(result.hits.map(({ text }) => text)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Juniper Civic Systems"),
        expect.stringContaining("Lumen Works"),
        expect.stringContaining("Bachelor of Computing, Example University, 2017"),
        expect.stringContaining("Cloud Platform Practitioner Certificate, 2022"),
        expect.stringContaining("English — fluent; French — professional working proficiency"),
        expect.stringContaining("**Production experience:** Operated Java event processors"),
      ]),
    );
    expect(
      result.hits.filter(({ text }) => /^## .*\b(?:19|20)\d{2}.*\bto\b/u.test(text)),
    ).toHaveLength(13);
    expect(result.hits.length).toBeLessThanOrEqual(20);
    expect(Buffer.byteLength(JSON.stringify(result.hits), "utf8")).toBeLessThanOrEqual(
      candidateKnowledgeChronologyProviderByteLimit,
    );
    expect(productionRecord?.metadata.provenance).toMatchObject({
      storeId: "production-skills-store",
      knowledgeBaseId: "production-skills-ckb",
      sourceId: "production-skills-source",
      versionId: "production-skills-version",
    });

    const queryChecksum = createHash("sha256")
      .update(candidateProductionSkillsEvidenceQuery, "utf8")
      .digest("hex");
    expect(
      fixture.appendTrace.mock.calls.filter(([trace]) => trace.queryChecksum === queryChecksum),
    ).toHaveLength(1);
    expect(candidateProductionSkillsEvidenceQueryLimit).toBe(20);
  });

  it("uses the explicit record as Skills evidence instead of transition prose", async () => {
    const fixture = await createRuntimeFixture(temporaryRoots);
    const runtime = createRuntime(fixture, ["Skills"]);

    const result = await runtime.inspect("Platform Engineer");

    expect(
      result.hits.some(({ text }) => text.includes("**Production experience:** Operated Java")),
    ).toBe(true);
  });

  it("does not issue the production-record query when Skills is not required", async () => {
    const fixture = await createRuntimeFixture(temporaryRoots);
    const runtime = createRuntime(fixture, ["Experience", "Education"]);

    await runtime.inspect("Platform Engineer");

    const queryChecksum = createHash("sha256")
      .update(candidateProductionSkillsEvidenceQuery, "utf8")
      .digest("hex");
    expect(fixture.appendTrace).toHaveBeenCalledTimes(10);
    expect(
      fixture.appendTrace.mock.calls.some(([trace]) => trace.queryChecksum === queryChecksum),
    ).toBe(false);
  });

  it("preserves ordinary Skills retrieval when the production query finds no labeled record", async () => {
    const fixture = await createRuntimeFixture(temporaryRoots, false);
    const runtime = createRuntime(fixture, ["Skills"]);

    const result = await runtime.inspect("Platform Engineer");

    expect(result.hits.some(({ text }) => text.includes("Skills and technology transition"))).toBe(
      true,
    );
    expect(result.hits.some(({ text }) => isProductionSkillsRecord(text))).toBe(false);
  });
});
