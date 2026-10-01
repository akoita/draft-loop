import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CandidateKnowledgeRetrievalTrace,
  type CandidateKnowledgeRetrievalTraceInput,
  createContextSnapshot,
  maximumCandidateKnowledgeRetrievalQueryLength,
} from "@draft-loop/domain";
import { evidenceQueryTerms } from "@draft-loop/storage/evidence-retrieval-precision";
import { afterEach, describe, expect, it, vi } from "vitest";
import { candidateKnowledgeSearchText } from "./candidate-knowledge-query.js";
import { candidateKnowledgeRuntimeRetrieval } from "./candidate-knowledge-retrieval.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";

const createdAt = "2026-09-26T10:00:00.000Z";

describe("candidate knowledge lexical query adaptation", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  it("preserves short search text and uses the storage term projection for longer text", () => {
    const shortText = `Nebula ${"x".repeat(maximumCandidateKnowledgeRetrievalQueryLength - 7)}`;
    expect(shortText).toHaveLength(maximumCandidateKnowledgeRetrievalQueryLength);
    expect(candidateKnowledgeSearchText(shortText)).toBe(shortText);

    const longText = [
      "Nebula telemetry parser Kotlin PostgreSQL distributed replay",
      ...Array.from({ length: 280 }, (_, index) => `responsibility${index}`),
    ].join(" ");
    expect(longText.length).toBeGreaterThan(maximumCandidateKnowledgeRetrievalQueryLength);
    expect(candidateKnowledgeSearchText(longText)).toBe(evidenceQueryTerms(longText).join(" "));
  });

  it("fails safely when one effective term still exceeds storage bounds", () => {
    const longTerm = "nebula".repeat(400);
    expect(() => candidateKnowledgeSearchText(longTerm)).toThrow(
      "Candidate knowledge search text exceeds the effective query limit; shorten unusually long terms and try again.",
    );
  });

  it("retrieves with bounded terms while retaining the full job context and empty-query behavior", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-long-candidate-query-"));
    temporaryRoots.push(parent);
    const storeRoot = join(parent, "candidate-knowledge");
    const sourcePath = join(parent, "fictional-candidate.md");
    await writeFile(
      sourcePath,
      [
        "# Fictional Candidate",
        "",
        "## Fictional Experience",
        "",
        "Built a Nebula telemetry parser with Kotlin and PostgreSQL for distributed replay.",
        "Documented fictional test coverage and maintained a sample ingestion workflow.",
      ].join("\n"),
      "utf8",
    );
    const ids = ["query-store", "query-ckb", "query-source", "query-version"];
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => createdAt,
    });
    await service.initializeStore({ storeRoot });
    await service.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId: "query-ckb",
      sourcePath,
    });
    const selection = await service.createKnowledgeSelectionSnapshot({
      selections: [{ storeRoot, knowledgeBaseId: "query-ckb" }],
    });
    const originalJobText = [
      "Nebula telemetry parser Kotlin PostgreSQL distributed replay",
      ...Array.from({ length: 280 }, (_, index) => `responsibility${index}`),
    ].join(" ");
    const context = createContextSnapshot({
      id: "snapshot-query",
      workspaceId: "fictional-query-workspace",
      createdAt,
      jobDescription: originalJobText,
      requirements: [
        { id: "requirement-query", text: "Nebula telemetry parser", priority: "high" },
      ],
      candidateInstructions: "Use only supported fictional facts.",
      language: "en",
      outputConstraints: { format: "markdown", requiredSections: ["Experience"] },
      truthfulnessPolicy: "Do not add unsupported claims.",
      readinessRubric: {
        relevance: 0.8,
        evidence: 0.8,
        accuracy: 0.8,
        differentiation: 0.8,
        clarity: 0.8,
        format: 0.8,
        credibility: 0.8,
      },
      evidenceManifest: [
        {
          id: "fictional-candidate-source",
          path: "/fictional/candidate.md",
          mediaType: "text/markdown",
          checksum: "a".repeat(64),
        },
      ],
      modelConfiguration: {
        author: {
          company: "anthropic",
          modelId: "claude-sonnet-5-5",
          role: "author",
          promptTemplateVersion: "author-v1",
        },
        critic: {
          company: "openai",
          modelId: "gpt-6-luna",
          role: "critic",
          promptTemplateVersion: "critic-v1",
        },
        requireProviderDiversity: true,
      },
      candidateKnowledgeSelection: selection,
    });
    const searchText = candidateKnowledgeSearchText(originalJobText);
    const appendTrace = vi.fn(
      async (
        input: CandidateKnowledgeRetrievalTraceInput,
      ): Promise<CandidateKnowledgeRetrievalTrace> =>
        input as unknown as CandidateKnowledgeRetrievalTrace,
    );
    const runtime = candidateKnowledgeRuntimeRetrieval(
      { appendCandidateKnowledgeRetrievalTrace: appendTrace },
      {
        id: "fictional-query-workspace",
        requiredSections: [],
        candidateKnowledgeSelection: {
          entries: [{ storeRoot, knowledgeBaseId: "query-ckb" }],
        },
      },
      context,
    );
    if (runtime === undefined) throw new Error("Expected fictional knowledge retrieval runtime.");

    const result = await runtime.inspect(originalJobText);
    const stopwordQuery = `${"the and with ".repeat(180)}`;
    expect(stopwordQuery.length).toBeGreaterThan(maximumCandidateKnowledgeRetrievalQueryLength);
    expect(candidateKnowledgeSearchText(stopwordQuery)).toBe("");
    await runtime.inspect(stopwordQuery);
    const emptyQueryChecksum = createHash("sha256").update("", "utf8").digest("hex");
    const emptyQueryTraces = appendTrace.mock.calls
      .map(([trace]) => trace)
      .filter(({ queryChecksum }) => queryChecksum === emptyQueryChecksum);

    expect(result.hits.some(({ text }) => text.includes("Nebula telemetry parser"))).toBe(true);
    expect(result.status).toBe("matched");
    expect(emptyQueryTraces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "no-query", selectedChunkCount: 0 }),
      ]),
    );
    expect(context.jobDescription).toBe(originalJobText);
    const checksums = appendTrace.mock.calls.map(([trace]) => trace.queryChecksum);
    expect(checksums).toContain(createHash("sha256").update(searchText, "utf8").digest("hex"));
    expect(checksums).not.toContain(
      createHash("sha256").update(originalJobText, "utf8").digest("hex"),
    );
    expect(checksums).toContain(emptyQueryChecksum);
  });
});
