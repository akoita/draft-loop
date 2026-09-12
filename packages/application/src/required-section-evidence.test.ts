import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  CandidateKnowledgeRetrievalTrace,
  CandidateKnowledgeRetrievalTraceInput,
  ContextSnapshot,
  ScoredEvidenceChunk,
} from "@draft-loop/domain";
import type { AuthorArtifactProposal } from "@draft-loop/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAuthorArtifact } from "./author-output.js";
import { candidateKnowledgeRuntimeRetrieval } from "./candidate-knowledge-retrieval.js";
import * as knowledgeBase from "./knowledge-base.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";
import {
  mergeRequiredSectionEvidence,
  requiredSectionProposalIssues,
  requiredSectionQueries,
} from "./required-section-evidence.js";

const checksum = "a".repeat(64);

function evidence(id: string, text: string, rank = 0): ScoredEvidenceChunk {
  return {
    id,
    workspaceId: "workspace-1",
    sourceId: "source-1",
    ordinal: rank,
    lineStart: rank + 1,
    lineEnd: rank + 1,
    checksum,
    text,
    rank,
  };
}

const placeholderProposal = {
  sections: [
    {
      title: "Education",
      kind: "education",
      blocks: [{ type: "paragraph", text: "Education information unavailable", claims: [] }],
    },
  ],
} satisfies AuthorArtifactProposal;

describe("required-section evidence", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  it("reserves bounded matched evidence for required sections and ignores fallback supplements", () => {
    const primary = {
      status: "matched" as const,
      hits: [
        evidence("role", "Platform Engineer at Example Systems.", 0),
        evidence("role-2", "Led a TypeScript platform migration.", 1),
      ],
    };
    const supplements = [
      {
        section: "Education",
        result: {
          status: "matched" as const,
          hits: [evidence("education", "MSc Computer Science.", 2)],
        },
      },
      {
        section: "Certifications",
        result: {
          status: "matched" as const,
          hits: [evidence("certification", "AWS Certified Developer.", 3)],
        },
      },
      {
        section: "Languages",
        result: {
          status: "matched" as const,
          hits: [evidence("language", "English and French.", 4)],
        },
      },
      {
        section: "Projects",
        result: {
          status: "bounded-fallback" as const,
          hits: [evidence("fallback", "Unrelated first chunk.", 5)],
        },
      },
    ];

    const selected = mergeRequiredSectionEvidence(primary, supplements, 4);

    expect(selected.map(({ id }) => id)).toEqual([
      "role",
      "education",
      "certification",
      "language",
    ]);
    expect(selected).not.toContainEqual(expect.objectContaining({ id: "fallback" }));
  });

  it("keeps required-section queries deterministic, unique, and within the result budget", () => {
    const queries = requiredSectionQueries(
      ["Education", "education", "Certifications", "Languages", "Projects"],
      4,
    );

    expect(queries).toHaveLength(3);
    expect(queries.map(({ section }) => section)).toEqual([
      "Education",
      "Certifications",
      "Languages",
    ]);
    expect(queries[0]?.query).toContain("university");
  });

  it("rejects an unavailable required section only when retrieved evidence establishes content", () => {
    const education = evidence("education", "Education\nMSc Computer Science, Example University.");
    const roleOnly = evidence("role", "Platform Engineer delivered TypeScript systems.");

    expect(requiredSectionProposalIssues(placeholderProposal, ["Education"], [education])).toEqual([
      expect.objectContaining({
        code: "required_section_evidence_omitted",
        path: ["sections", 0],
      }),
    ]);
    expect(requiredSectionProposalIssues(placeholderProposal, ["Education"], [roleOnly])).toEqual(
      [],
    );
  });

  it("accepts honest no-source placeholders and accepts supplied section content", () => {
    const roleOnly = evidence("role", "Platform Engineer delivered TypeScript systems.");
    const education = evidence("education", "MSc Computer Science, Example University.");
    const contentProposal = {
      sections: [
        {
          title: "Education",
          kind: "education",
          blocks: [
            { type: "paragraph", text: "MSc Computer Science, Example University.", claims: [] },
          ],
        },
      ],
    } satisfies AuthorArtifactProposal;

    expect(requiredSectionProposalIssues(placeholderProposal, ["Education"], [roleOnly])).toEqual(
      [],
    );
    expect(requiredSectionProposalIssues(contentProposal, ["Education"], [education])).toEqual([]);
  });

  it("applies the required-section invariant at the author artifact boundary", () => {
    const education = evidence("education", "MSc Computer Science, Example University.");

    expect(() =>
      buildAuthorArtifact({
        proposal: placeholderProposal,
        executionId: "required-section-rejection",
        context: {
          language: "en",
          evidenceManifest: [{ id: "source-1", path: "/local/cv.md", checksum }],
        },
        retrievedEvidence: [education],
        requiredSections: ["Education"],
      }),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({
            params: expect.objectContaining({
              invariantCode: "required_section_evidence_omitted",
            }),
          }),
        ]),
      }),
    );
  });

  it.each([
    "MSc Computer Science, Example University; graduation date not provided.",
    "MSc Computer Science, Example University. Graduation date unknown.",
    "MSc Computer Science, Example University, graduation date not provided.",
  ])("retains supported education with an unavailable detail: %s", (text) => {
    const proposal = {
      sections: [
        {
          title: "Education",
          kind: "education" as const,
          blocks: [{ type: "paragraph" as const, text, claims: [] }],
        },
      ],
    };
    expect(
      requiredSectionProposalIssues(proposal, ["Education"], [evidence("degree", text)]),
    ).toEqual([]);
    expect(
      requiredSectionProposalIssues(placeholderProposal, ["Education"], [evidence("degree", text)]),
    ).toHaveLength(1);
  });

  it.each([
    "No education information was provided by the candidate.",
    "Education information is not available in the supplied documents.",
    "Education\nN/A",
    "Education\nNone provided",
  ])("does not infer positive evidence from an absence statement: %s", (text) => {
    expect(
      requiredSectionProposalIssues(
        placeholderProposal,
        ["Education"],
        [evidence("absence", text)],
      ),
    ).toEqual([]);
    expect(
      mergeRequiredSectionEvidence(
        { status: "matched", hits: [] },
        [
          {
            section: "Education",
            result: { status: "matched", hits: [evidence("absence", text)] },
          },
        ],
        20,
      ),
    ).toEqual([]);
  });

  it("supplements role-focused retrieval with disjoint education, certification, and language chunks", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-required-sections-"));
    temporaryRoots.push(root);
    const storeRoot = join(root, "candidate-knowledge");
    const sourcePath = join(root, "candidate.md");
    await writeFile(
      sourcePath,
      [
        "Platform Engineer",
        "",
        "Built distributed systems with TypeScript.",
        "",
        "Education",
        "",
        "MSc Computer Science, Example University, 2018.",
        "",
        "Certifications",
        "",
        "AWS Certified Developer, 2020.",
        "",
        "Languages",
        "",
        "English and French.",
      ].join("\n"),
      "utf8",
    );
    const ids = ["runtime-store", "runtime-ckb", "runtime-source", "runtime-version"];
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => "2026-09-12T10:00:00.000Z",
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
        requiredSections: ["Experience", "Education", "Certifications", "Languages"],
        candidateKnowledgeSelection: {
          entries: [{ storeRoot, knowledgeBaseId: "runtime-ckb" }],
        },
      },
      { candidateKnowledgeSelection: selection } as ContextSnapshot,
    );
    if (runtime === undefined) throw new Error("Expected candidate knowledge runtime retrieval.");

    const result = await runtime.inspect("Platform Engineer");

    expect(result.status).toBe("matched");
    expect(result.selectedChunkCount).toBe(4);
    expect(result.hits.map(({ text }) => text)).toEqual(
      expect.arrayContaining([
        "Platform Engineer",
        "MSc Computer Science, Example University, 2018.",
        "AWS Certified Developer, 2020.",
        "English and French.",
      ]),
    );
    expect(result.hits.map(({ text }) => text)).not.toContain(
      "Built distributed systems with TypeScript.",
    );
    expect(appendTrace).toHaveBeenCalledTimes(5);
    expect(new Set(appendTrace.mock.calls.map(([input]) => input.queryChecksum)).size).toBe(5);

    // A saturated result cannot prove absence: a supported degree may rank fifth.
    const degree = result.hits.find((hit) => hit.text.includes("MSc"));
    if (!degree) throw new Error("Missing degree fixture");
    vi.spyOn(knowledgeBase, "createCandidateKnowledgeStoreService").mockReturnValue({
      ...service,
      queryCandidateKnowledge: async () => ({
        ...result,
        hits: Array.from({ length: 4 }, (_, index) => ({
          ...degree,
          chunkId: `heading-${index}` as typeof degree.chunkId,
          text: "Education",
        })),
        selectedChunkCount: 4,
        diagnostics: [],
      }),
    });
    const saturated = candidateKnowledgeRuntimeRetrieval(
      { appendCandidateKnowledgeRetrievalTrace: appendTrace },
      {
        id: "workspace-1",
        requiredSections: ["Education"],
        candidateKnowledgeSelection: { entries: [{ storeRoot, knowledgeBaseId: "runtime-ckb" }] },
      },
      { candidateKnowledgeSelection: selection } as ContextSnapshot,
    );
    await expect(saturated?.port.queryEvidence("Platform Engineer")).rejects.toThrow(
      "Required-section evidence coverage could not be established within the retrieval limit.",
    );
  });
});
