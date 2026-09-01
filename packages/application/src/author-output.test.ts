import {
  authorArtifactProposalJsonSchema,
  authorArtifactProposalJsonSchemaForEvidence,
} from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { buildAuthorArtifact } from "./author-output.js";

const sourceChecksum = "a".repeat(64);
const chunkText = "Built reliable systems for local-first workflows.";

const context = {
  language: "en",
  evidenceManifest: [
    {
      id: "source-1",
      path: "/local/candidate/resume.md",
      checksum: sourceChecksum,
    },
  ],
} as const;

const retrievedEvidence = [
  {
    id: "chunk-1",
    workspaceId: "workspace-1",
    sourceId: "source-1",
    ordinal: 0,
    lineStart: 4,
    lineEnd: 5,
    checksum: "b".repeat(64),
    text: chunkText,
    rank: 0,
  },
] as const;

function proposal(text = "Engineer building reliable systems.") {
  return {
    sections: [
      {
        title: "Summary",
        kind: "summary" as const,
        blocks: [
          {
            type: "paragraph" as const,
            text,
            claims: [
              {
                text,
                substantive: true,
                evidenceChunkIds: ["chunk-1"],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("live author proposal boundary", () => {
  it("exposes a strict provider schema without canonical artifact metadata", () => {
    expect(authorArtifactProposalJsonSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["sections"],
    });
    const serialized = JSON.stringify(authorArtifactProposalJsonSchema);
    expect(serialized).not.toContain("schemaVersion");
    expect(serialized).not.toContain("parentVersionId");
    expect(serialized).not.toContain("createdAt");
  });

  it("constrains provider evidence references to chunks included in the request", () => {
    const schema = authorArtifactProposalJsonSchemaForEvidence(["chunk-2", "chunk-1", "chunk-1"]);
    const serialized = JSON.stringify(schema);

    expect(serialized).toContain('"enum":["chunk-2","chunk-1"]');
    expect(serialized).not.toContain('"uniqueItems"');
    expect(serialized).not.toContain('"maxItems"');
    expect(JSON.stringify(authorArtifactProposalJsonSchema)).not.toContain('"chunk-1"');
  });

  it("leaves empty evidence enforcement to the prompt and local validation boundary", () => {
    const schema = authorArtifactProposalJsonSchemaForEvidence([]);
    const serialized = JSON.stringify(schema);

    expect(serialized).not.toContain('"uniqueItems"');
    expect(serialized).not.toContain('"maxItems"');
  });

  it("constructs canonical v1 metadata and maps local evidence", () => {
    const artifact = buildAuthorArtifact({
      proposal: proposal(),
      executionId: "run/author attempt 1",
      context,
      retrievedEvidence,
      createdAt: "2026-08-15T10:00:00.000Z",
    });

    expect(artifact.schemaVersion).toBe(1);
    expect(artifact.version).toBe(1);
    expect(artifact.parentVersionId).toBeNull();
    expect(artifact.createdAt).toBe("2026-08-15T10:00:00.000Z");
    expect(artifact.id).not.toContain("run/author attempt 1");
    expect(artifact.sections[0]).toMatchObject({
      id: expect.stringMatching(/^section-[a-f0-9]{64}-0$/),
      order: 0,
    });
    expect(artifact.sections[0]?.blocks[0]?.claimIds).toEqual([
      expect.stringMatching(/^claim-[a-f0-9]{64}-0-0-0$/),
    ]);
    expect(artifact.claims[0]).toMatchObject({
      id: expect.stringMatching(/^claim-[a-f0-9]{64}-0-0-0$/),
      status: "unverified",
      substantive: true,
      evidence: [
        {
          sourcePath: "/local/candidate/resume.md",
          sourceChecksum,
          locator: "line:4-5",
          excerpt: chunkText,
        },
      ],
    });
  });

  it("completes exact citations before canonical evidence normalization without changing content", () => {
    const text = "Staff Engineer at Example Systems, 2024.";
    const evidenceText = "staff engineer at example systems, 2024.";
    const artifact = buildAuthorArtifact({
      proposal: {
        sections: [
          {
            title: "Summary",
            kind: "summary",
            blocks: [
              {
                type: "paragraph",
                text,
                claims: [{ text, substantive: true, evidenceChunkIds: [] }],
              },
            ],
          },
        ],
      },
      executionId: "exact-citation-completion",
      context,
      retrievedEvidence: [
        {
          id: "chunk-exact-support",
          workspaceId: "workspace-1",
          sourceId: "source-1",
          ordinal: 1,
          lineStart: 10,
          lineEnd: 11,
          checksum: "c".repeat(64),
          text: evidenceText,
          rank: 1,
        },
      ],
      createdAt: "2026-08-15T10:00:00.000Z",
    });

    expect(artifact.claims[0]).toMatchObject({
      text,
      evidence: [
        {
          sourcePath: "/local/candidate/resume.md",
          sourceChecksum,
          locator: "line:10-11",
          excerpt: evidenceText,
        },
      ],
    });
  });

  it("creates a canonical child version without trusting proposal metadata", () => {
    const parent = buildAuthorArtifact({
      proposal: proposal(),
      executionId: "execution-1",
      context,
      retrievedEvidence,
      createdAt: "2026-08-15T10:00:00.000Z",
    });
    const child = buildAuthorArtifact({
      proposal: proposal("Engineer delivering dependable systems."),
      executionId: "execution-2",
      context,
      retrievedEvidence,
      currentArtifact: parent,
      createdAt: "2026-08-15T10:01:00.000Z",
    });

    expect(child.schemaVersion).toBe(1);
    expect(child.version).toBe(2);
    expect(child.parentVersionId).toBe(parent.id);
    expect(child.id).not.toBe(parent.id);
  });

  it("rejects unknown chunk references without exposing retrieved source text", () => {
    const secretText = "PRIVATE CANDIDATE SOURCE CONTENT";

    try {
      buildAuthorArtifact({
        proposal: {
          ...proposal(),
          sections: [
            {
              ...proposal().sections[0],
              blocks: [
                {
                  ...proposal().sections[0]?.blocks[0],
                  claims: [
                    {
                      text: secretText,
                      substantive: true,
                      evidenceChunkIds: ["missing-chunk"],
                    },
                  ],
                },
              ],
            },
          ],
        },
        executionId: "execution-unknown",
        context,
        retrievedEvidence,
      });
      throw new Error("expected unknown evidence reference to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(z.ZodError);
      expect((error as z.ZodError).issues).toContainEqual({
        code: "custom",
        path: ["sections", 0, "blocks", 0, "claims", 0, "evidenceChunkIds", 0],
        message: "evidence chunk reference is not available in retrieved context",
      });
      expect(String(error)).not.toContain(secretText);
      expect(String(error)).not.toContain(chunkText);
    }
  });

  it("rejects duplicate chunk references with a proposal path diagnostic", () => {
    expect(() =>
      buildAuthorArtifact({
        proposal: {
          ...proposal(),
          sections: [
            {
              ...proposal().sections[0],
              blocks: [
                {
                  ...proposal().sections[0]?.blocks[0],
                  claims: [
                    {
                      text: "A claim",
                      substantive: true,
                      evidenceChunkIds: ["chunk-1", "chunk-1"],
                    },
                  ],
                },
              ],
            },
          ],
        },
        executionId: "execution-duplicate",
        context,
        retrievedEvidence,
      }),
    ).toThrow(/evidence chunk ids must be unique/i);
  });
});
