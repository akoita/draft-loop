import { createContextSnapshot, createWorkspace } from "@draft-loop/domain";
import { createOrchestrationEngine, InMemoryRunStore } from "@draft-loop/orchestrator";
import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it, vi } from "vitest";

import { createRunCoverageJudgementPlanner } from "./run-coverage-judgement.js";

/*
 * A fictional reviewed brief: two requirements and one responsibility. The draft meets both
 * requirements in its own words, so the word match finds neither, and no embedding model is
 * installed (#1835).
 */
const stamp = "2026-10-27T09:00:00.000Z";
const requirements = [
  { id: "req-orchestration", text: "Container orchestration at scale", priority: "high" as const },
  { id: "req-mentoring", text: "Mentoring junior engineers", priority: "high" as const },
  { id: "resp-roadmap", text: "Own the quarterly platform roadmap", priority: "medium" as const },
];

const context = createContextSnapshot({
  id: "context-relevance",
  workspaceId: "workspace-relevance",
  createdAt: stamp,
  jobDescription: "Platform engineer for a fictional retailer.",
  requirements,
  scoredRequirementIds: ["req-orchestration", "req-mentoring"],
  candidateInstructions: "",
  language: "en",
  outputConstraints: { format: "markdown", maxWords: 800, requiredSections: [] },
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
      id: "source-1",
      path: "/fictional/cv.md",
      mediaType: "text/markdown",
      checksum: "c".repeat(64),
    },
  ],
  modelConfiguration: {
    author: { company: "anthropic", modelId: "a", role: "author", promptTemplateVersion: "v1" },
    critic: { company: "openai", modelId: "c", role: "critic", promptTemplateVersion: "v1" },
    requireProviderDiversity: true,
  },
});

const draft = {
  schemaVersion: 1,
  id: "artifact-relevance",
  version: 1,
  parentVersionId: null,
  createdAt: stamp,
  language: "en",
  sections: [
    {
      id: "s-experience",
      title: "Experience",
      kind: "experience",
      order: 0,
      blocks: [
        { id: "b-clusters", type: "bullet", text: "Ran forty service clusters.", claimIds: [] },
        { id: "b-coaching", type: "bullet", text: "Coached three new hires.", claimIds: [] },
      ],
    },
  ],
  claims: [],
} as unknown as DraftArtifact;

function execution(output: unknown, provider: string) {
  return {
    output,
    provider,
    modelId: `${provider}-model`,
    providerRequestId: null,
    outputChecksum: "b".repeat(64),
    inputTokens: 1,
    outputTokens: 1,
    totalTokens: 2,
    estimatedUsd: null,
    completedAt: stamp,
  };
}

async function relevanceWith(verdicts: Record<string, "satisfied" | "not-satisfied">) {
  const critic = vi.fn(
    async (request: { coverageJudgementRequests?: { requirementId: string }[] }) =>
      execution(
        {
          findings: [],
          coverageJudgements: (request.coverageJudgementRequests ?? []).map(
            ({ requirementId }) => ({
              requirementId,
              verdict: verdicts[requirementId] ?? "not-satisfied",
              citedBlockIds:
                verdicts[requirementId] === "satisfied" ? ["b-clusters", "b-coaching"] : [],
              rationale: "Scripted verdict.",
            }),
          ),
          coverageJudgementInstructionsVersion: "coverage-judgement-v2",
        },
        "openai",
      ),
  );
  const engine = createOrchestrationEngine({
    author: { execute: async () => execution(draft, "anthropic") as never },
    critic: { execute: critic as never },
    store: new InMemoryRunStore(),
    now: () => stamp,
    coverageJudgement: createRunCoverageJudgementPlanner({
      root: "/fictional/workspace",
      open: async () => ({ ok: false, reason: "model-absent" }),
    }),
  });
  const snapshot = await engine.start({
    runId: "run-relevance",
    workspace: createWorkspace("workspace-relevance"),
    context,
    budget: { maxRounds: 1 },
  });
  const relevance = snapshot.latestEvaluation?.scores.find(
    ({ dimension }) => dimension === "relevance",
  );
  return { critic, relevance, evaluation: snapshot.latestEvaluation };
}

describe("relevance over the reviewed brief (#1835)", () => {
  it("asks the critic about every uncovered requirement without an embedding model", async () => {
    const { critic } = await relevanceWith({});
    expect(critic.mock.calls[0]?.[0]).toMatchObject({
      coverageJudgementRequests: requirements.map(({ id }) => ({
        requirementId: id,
        candidateBlockIds: [],
      })),
    });
  });

  it("passes a draft that meets every brief requirement in other words", async () => {
    const { relevance, evaluation } = await relevanceWith({
      "req-orchestration": "satisfied",
      "req-mentoring": "satisfied",
    });
    // The unmet responsibility does not lower the score: it is counted over the requirements.
    expect(relevance?.score).toBe(1);
    expect(relevance?.rationale).toBe(
      "2 of 2 requirements covered: 0 by deterministic coverage within individual blocks and 2 by critic judgement",
    );
    expect(
      evaluation?.thresholdResults.find(({ dimension }) => dimension === "relevance")?.meets,
    ).toBe(true);
  });

  it("holds a draft that misses one of them", async () => {
    const { relevance, evaluation } = await relevanceWith({ "req-orchestration": "satisfied" });
    expect(relevance?.score).toBe(0.5);
    expect(
      evaluation?.thresholdResults.find(({ dimension }) => dimension === "relevance")?.meets,
    ).toBe(false);
  });
});
