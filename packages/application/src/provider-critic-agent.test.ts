import type { ContextSnapshot, ScoredEvidenceChunk } from "@draft-loop/domain";
import type { JsonObject, ModelRequest, ModelResponse } from "@draft-loop/providers";
import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it, vi } from "vitest";

import { coverageJudgementInstructions } from "./critic-adjudication.js";
import { critiqueOutputSchemaWithCoverageJudgements } from "./critic-critique-contract.js";
import { createProviderCriticAgent } from "./provider-critic-agent.js";

// The model-facing artifact projection is covered elsewhere; here only the request layout matters.
vi.mock("./provider-artifact-input.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  modelFacingArtifactWithEvidenceTable: (artifact: DraftArtifact) => artifact,
  modelFacingArtifactWithCompactEvidenceTable: (
    artifact: DraftArtifact,
    _context: unknown,
    retrievedEvidence: readonly { readonly id: string }[],
  ) => ({ ...artifact, compactFor: retrievedEvidence.map(({ id }) => id) }),
}));

const evidence: readonly ScoredEvidenceChunk[] = [0, 1].map((ordinal) => ({
  id: `chunk-${ordinal}`,
  workspaceId: "workspace",
  sourceId: "source",
  ordinal,
  lineStart: ordinal + 1,
  lineEnd: ordinal + 1,
  checksum: "b".repeat(64),
  text: `Built TypeScript tools in 202${ordinal}.`,
  rank: ordinal,
}));

const context = {
  id: "context",
  language: "en",
  requirements: [{ id: "requirement", text: "TypeScript tools", priority: "critical" }],
  modelConfiguration: {
    author: { company: "anthropic", modelId: "a", role: "author" },
    critic: {
      company: "openai",
      modelId: "c",
      role: "critic",
      promptTemplateVersion: "cli-critic-v5",
    },
  },
} as unknown as ContextSnapshot;

const artifact = {
  sections: [{ id: "experience", blocks: [{ id: "block-1", text: "Built TypeScript tools." }] }],
} as unknown as DraftArtifact;

/** Records each request and answers with the shared format's output, coverage list included. */
function recordingCritic(requests: ModelRequest<JsonObject>[], runContext = context) {
  return createProviderCriticAgent({
    context: runContext,
    promptContext: runContext,
    dataPolicy: () => ({}) as ModelRequest<JsonObject>["dataPolicy"],
    criticCompany: "openai",
    criticModel: "c",
    userError: (message) => new Error(message),
    createAdapter: async () => ({
      execute: async (request: ModelRequest<JsonObject>) => {
        requests.push(request);
        return {
          output: { findings: [], coverageJudgements: [] },
          provider: "openai",
          modelId: "c",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          cost: { estimatedUsd: 0 },
        } as unknown as ModelResponse<JsonObject>;
      },
    }),
  });
}

const critique = (round: number, coverageJudgementRequests?: readonly object[]) => ({
  executionId: `run:critic:${round}`,
  runId: "run",
  round,
  artifact,
  deterministicFindings: [],
  retrievedEvidence: evidence,
  ...(coverageJudgementRequests === undefined ? {} : { coverageJudgementRequests }),
});

describe("provider critic agent", () => {
  it("gives every critique of a run the same cached prefix and output format", async () => {
    const requests: ModelRequest<JsonObject>[] = [];
    const critic = recordingCritic(requests);
    const first = await critic.execute(critique(1) as never);
    await critic.execute(
      critique(2, [{ requirementId: "requirement", candidateBlockIds: ["block-1"] }]) as never,
    );

    const [plain, judged] = requests;
    for (const request of [plain, judged]) {
      expect(request?.outputSchema).toBe(critiqueOutputSchemaWithCoverageJudgements);
      expect(request?.promptCache?.stableInputMembers).toBe(3);
      expect(Object.keys(request?.input ?? {}).slice(0, 3)).toEqual([
        "context",
        "retrievedEvidence",
        "achievementPlan",
      ]);
    }
    expect(judged?.promptCache?.systemPrompt).toBe(plain?.promptCache?.systemPrompt);
    expect(plain?.promptCache?.callInstructions).toBe("");
    expect(judged?.promptCache?.callInstructions).toBe(coverageJudgementInstructions);
    // A provider without a cache still gets the whole prompt for the call.
    expect(plain?.systemPrompt).toBe(plain?.promptCache?.systemPrompt);
    expect(judged?.systemPrompt).toContain(coverageJudgementInstructions);

    // The shared format's empty coverage list is not recorded for a critique that judged none.
    expect(first.output).not.toHaveProperty("coverageJudgements");
  });

  it("sends the compact evidence table from critic v6 on, citing retrieved chunks (#1986)", async () => {
    const v6 = {
      ...context,
      modelConfiguration: {
        ...context.modelConfiguration,
        critic: { ...context.modelConfiguration.critic, promptTemplateVersion: "cli-critic-v6" },
      },
    } as ContextSnapshot;
    const requests: ModelRequest<JsonObject>[] = [];
    await recordingCritic(requests, v6).execute(critique(1) as never);
    await recordingCritic(requests).execute(critique(1) as never);

    const [compact, full] = requests;
    expect(compact?.input.artifact).toMatchObject({ compactFor: ["chunk-0", "chunk-1"] });
    expect(compact?.systemPrompt).toContain("reference-table-v2");
    expect(full?.input.artifact).not.toHaveProperty("compactFor");
    expect(full?.systemPrompt).not.toContain("reference-table-v2");
  });
});
