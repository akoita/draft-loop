import { createContextSnapshot, createWorkspace } from "@draft-loop/domain";
import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it, vi } from "vitest";

import { failedAttemptCost } from "./failed-attempt-cost.js";
import {
  type AgentExecution,
  type Critique,
  createOrchestrationEngine,
  InMemoryRunStore,
} from "./index.js";

const checksum = "a".repeat(64);
const text = "TypeScript experience and clear technical communication.";

const context = createContextSnapshot({
  id: "context-1",
  workspaceId: "workspace-1",
  createdAt: "2026-08-12T09:00:00.000Z",
  jobDescription: "Build reliable local-first software.",
  requirements: [
    { id: "requirement-1", text: "TypeScript experience", priority: "critical" },
    { id: "requirement-2", text: "Clear technical communication", priority: "high" },
  ],
  candidateInstructions: "Use concise, evidence-backed language.",
  language: "en",
  outputConstraints: { format: "markdown", maxWords: 800, requiredSections: ["Summary"] },
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
    { id: "source-1", path: "/local/candidate/resume.md", mediaType: "text/markdown", checksum },
  ],
  modelConfiguration: {
    author: {
      company: "anthropic",
      modelId: "author-test",
      role: "author",
      promptTemplateVersion: "author-v1",
    },
    critic: {
      company: "openai",
      modelId: "critic-test",
      role: "critic",
      promptTemplateVersion: "critic-v1",
    },
    requireProviderDiversity: true,
  },
});

function artifact(createdAt: string): DraftArtifact {
  return {
    schemaVersion: 1,
    id: "artifact-1",
    version: 1,
    parentVersionId: null,
    createdAt,
    language: "en",
    sections: [
      {
        id: "summary-1",
        title: "Summary",
        kind: "summary",
        order: 0,
        blocks: [{ id: "summary-block-1", type: "paragraph", text, claimIds: ["claim-1"] }],
      },
    ],
    claims: [
      {
        id: "claim-1",
        text,
        sectionId: "summary-1",
        blockId: "summary-block-1",
        substantive: true,
        status: "verified",
        evidence: [
          { sourcePath: "/local/candidate/resume.md", sourceChecksum: checksum, excerpt: text },
        ],
      },
    ],
    decisions: [],
  };
}

function execution<T>(output: T, provider: string, modelId: string): AgentExecution<T> {
  return {
    output,
    provider,
    modelId,
    providerRequestId: `${provider}-request-1`,
    outputChecksum: checksum,
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
    estimatedUsd: 0.01,
    completedAt: new Date().toISOString(),
  };
}

/** An author failure shaped like a provider's rejection of a billed response (#1967). */
function billedRejection(estimatedUsd: number | null) {
  return Object.assign(new Error("The provider did not complete the structured response."), {
    code: "invalid-response",
    retryable: true,
    billed: {
      usage: { inputTokens: 174_000, outputTokens: 32_768, totalTokens: 206_768 },
      cost: { estimatedUsd },
    },
  });
}

function harness(author: () => Promise<AgentExecution<DraftArtifact>>) {
  const store = new InMemoryRunStore();
  const authorCalls = vi.fn(author);
  const engine = createOrchestrationEngine({
    author: { execute: authorCalls },
    critic: {
      execute: async () => execution<Critique>({ findings: [] }, "openai", "critic-test"),
    },
    store,
    contextResolver: async () => context,
    now: () => "2026-08-12T10:00:00.000Z",
  });
  return { engine, store, authorCalls };
}

const start = (maxCostUsd?: number) => ({
  runId: "run-1",
  workspace: createWorkspace("workspace-1"),
  context,
  budget: { maxRounds: 3, ...(maxCostUsd === undefined ? {} : { maxCostUsd }) },
});

describe("cost of a failed attempt (#1967)", () => {
  it("records a rejected response's tokens and cost on the failed execution and the run", async () => {
    const { engine } = harness(async () => {
      throw billedRejection(1.1);
    });

    const failed = await engine.start(start());

    expect(failed.state).toBe("provider-error");
    expect(failed.totalCostUsd).toBeCloseTo(1.1, 9);
    expect(failed.executionHistory.at(-1)).toMatchObject({
      status: "failed",
      inputTokens: 174_000,
      outputTokens: 32_768,
      totalTokens: 206_768,
      estimatedUsd: 1.1,
    });
  });

  it("counts a failed attempt's cost toward the run's cost limit", async () => {
    let calls = 0;
    const { engine, authorCalls } = harness(async () => {
      calls += 1;
      if (calls === 1) throw billedRejection(2);
      return execution(artifact("2026-08-12T10:00:00.000Z"), "anthropic", "author-test");
    });

    const failed = await engine.start(start(1.5));
    const resumed = await engine.resume("run-1");

    expect(failed.totalCostUsd).toBe(2);
    expect(authorCalls).toHaveBeenCalledTimes(1);
    expect(resumed.totalCostUsd).toBe(2);
    expect((await engine.events("run-1")).map((event) => event.type)).toContain("budget.exhausted");
  });

  it("reads a malformed or missing billed usage as unbilled", () => {
    const unbilled = { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedUsd: null };
    expect(failedAttemptCost(new Error("network"))).toEqual(unbilled);
    expect(failedAttemptCost(null)).toEqual(unbilled);
    expect(
      failedAttemptCost({ billed: { usage: { inputTokens: -1, outputTokens: 2 }, cost: {} } }),
    ).toEqual(unbilled);
    expect(
      failedAttemptCost({
        billed: { usage: { inputTokens: 1, outputTokens: 2 }, cost: { estimatedUsd: Number.NaN } },
      }),
    ).toEqual({ inputTokens: 1, outputTokens: 2, totalTokens: 3, estimatedUsd: null });
  });
});
