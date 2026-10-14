import { createContextSnapshot, createWorkspace } from "@draft-loop/domain";
import {
  applicationReadinessStoppingDecisionSchema,
  type DraftArtifact,
} from "@draft-loop/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type AgentExecution,
  buildApplicationReadinessStoppingDecision,
  type Critique,
  createOrchestrationEngine,
  InMemoryRunStore,
} from "./index.js";

// The WSL2 wall clock can step back about 1.2 s between drafting and approval.
const draftedAt = "2026-08-12T10:00:01.200Z";
const steppedBackAt = "2026-08-12T10:00:00.000Z";
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

function engine(store: InMemoryRunStore) {
  // No `now` option: each engine reads the (faked) wall clock, as a later
  // approval command does in a fresh process.
  return createOrchestrationEngine({
    author: {
      execute: async () =>
        execution(artifact(new Date().toISOString()), "anthropic", "author-test"),
    },
    critic: {
      execute: async () => execution<Critique>({ findings: [] }, "openai", "critic-test"),
    },
    store,
    contextResolver: async () => context,
  });
}

describe("readiness across a backward wall-clock step", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("never stamps the readiness decision before the artifact it evaluates", () => {
    const decision = buildApplicationReadinessStoppingDecision({
      artifact: artifact(draftedAt),
      context,
      critiqueFindings: [],
      round: 1,
      budget: { maxRounds: 3 },
      priorScoreHistory: [],
      createdAt: steppedBackAt,
    });

    expect(decision.createdAt).toBe(draftedAt);
    expect(decision.report.createdAt).toBe(draftedAt);
    expect(() => applicationReadinessStoppingDecisionSchema.parse(decision)).not.toThrow();
  });

  it("approves in a later engine whose clock reads earlier than the draft", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(draftedAt));
    const store = new InMemoryRunStore();
    const drafted = await engine(store).start({
      runId: "run-1",
      workspace: createWorkspace("workspace-1"),
      context,
      budget: { maxRounds: 3 },
    });
    expect(drafted.state).toBe("awaiting-approval");
    expect(drafted.artifact?.createdAt).toBe(draftedAt);

    vi.setSystemTime(new Date(steppedBackAt));
    const approved = await engine(store).approve("run-1");

    expect(approved).toMatchObject({ state: "approved", approval: "approved" });
    expect(approved.updatedAt).toBe(draftedAt);
    expect(approved.readinessDecision?.createdAt).toBe(draftedAt);
    expect(approved.readinessDecision?.report.createdAt).toBe(draftedAt);
  });
});
