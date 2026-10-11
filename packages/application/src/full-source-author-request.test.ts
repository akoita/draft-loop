import type { ContextSnapshot, ScoredEvidenceChunk } from "@draft-loop/domain";
import type { JsonObject, ModelRequest, ModelResponse } from "@draft-loop/providers";
import { describe, expect, it } from "vitest";
import { resetAuthorRevisionMemoryForTests } from "./author-revision-memory.js";
import { createProviderAuthorAgent } from "./provider-author-agent.js";

const evidenceCount = 45;

function chunkText(index: number): string {
  return `Built synthetic platform milestone ${index} in 2021.`;
}

const evidence: readonly ScoredEvidenceChunk[] = Array.from(
  { length: evidenceCount },
  (_, index) => ({
    id: `chunk-${index}`,
    workspaceId: "workspace",
    sourceId: "source",
    ordinal: index,
    lineStart: index + 1,
    lineEnd: index + 1,
    checksum: "b".repeat(64),
    text: chunkText(index),
    rank: 0,
  }),
);

const context = {
  id: "context",
  language: "en",
  evidenceManifest: [{ id: "source", path: "/private/resume.md", checksum: "a".repeat(64) }],
  requirements: [{ id: "requirement", text: "platform milestones" }],
  outputConstraints: { requiredSections: [] },
  modelConfiguration: { author: { promptTemplateVersion: "cli-author-v3" } },
} as unknown as ContextSnapshot;

describe("author request over full-source evidence", () => {
  it("carries more than twenty evidence items and accepts a citation beyond the first twenty", async () => {
    resetAuthorRevisionMemoryForTests();
    const requests: ModelRequest<JsonObject>[] = [];
    const cited = 33;
    const text = chunkText(cited);
    const author = createProviderAuthorAgent({
      context,
      promptContext: context,
      dataPolicy: () => ({
        allowTransmission: true,
        allowedCompanies: ["anthropic"],
        sensitiveData: true,
        sensitiveDataAcknowledged: true,
        requestedRetention: "ephemeral-request",
      }),
      createAdapter: async () => ({
        execute: async (request) => {
          requests.push(request);
          return {
            output: {
              sections: [
                {
                  title: "Summary",
                  kind: "summary",
                  blocks: [
                    {
                      type: "paragraph",
                      text,
                      claims: [{ text, substantive: true, evidenceChunkIds: [`E${cited + 1}`] }],
                    },
                  ],
                },
              ],
            },
            contextSnapshotId: "context",
            provider: "anthropic",
            company: "anthropic",
            modelId: "test-model",
            providerRequestId: "request",
            structuredOutputSha256: "c".repeat(64),
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            cost: { estimatedUsd: null },
          } satisfies ModelResponse<JsonObject>;
        },
      }),
      authorCompany: "anthropic",
      authorModel: "test-model",
      authorProposalCaptureDirectory: undefined,
      userError: (message) => new Error(message),
    });

    const execution = await author.execute({
      executionId: "execution",
      runId: "run-full-source",
      round: 1,
      context,
      currentArtifact: null,
      findings: [],
      retrievedEvidence: evidence,
    });

    const sent = requests[0];
    if (sent === undefined) throw new Error("Expected an author request.");
    expect((sent.input.retrievedEvidence as readonly unknown[]).length).toBe(evidenceCount);
    const schema = sent.outputSchema as {
      properties: {
        sections: {
          items: {
            properties: {
              blocks: {
                items: {
                  properties: {
                    claims: {
                      items: { properties: { evidenceChunkIds: { items: { enum: string[] } } } };
                    };
                  };
                };
              };
            };
          };
        };
      };
    };
    const allowed =
      schema.properties.sections.items.properties.blocks.items.properties.claims.items.properties
        .evidenceChunkIds.items.enum;
    expect(allowed).toHaveLength(evidenceCount);
    // The author cites short request-local aliases, mapped back to chunk IDs before validation.
    expect(allowed).toContain(`E${cited + 1}`);
    const claim = execution.output.claims[0];
    expect(claim?.text).toBe(text);
    expect(claim?.evidence[0]?.excerpt).toBe(text);
  });
});
