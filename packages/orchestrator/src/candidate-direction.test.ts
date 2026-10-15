import { createContextSnapshot, createWorkspace } from "@draft-loop/domain";
import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import {
  type AgentExecution,
  type AuthorRequest,
  type CriticRequest,
  type Critique,
  createOrchestrationEngine,
  InMemoryRunStore,
  maximumCandidateDirectionCharacters,
  normalizeCandidateDirectionText,
} from "./index.js";

const timestamp = "2026-10-15T10:00:00.000Z";
const checksum = "a".repeat(64);
const excerpt = "Clear technical communication.";

const context = createContextSnapshot({
  id: "context-1",
  workspaceId: "workspace-1",
  createdAt: timestamp,
  jobDescription: "Build reliable local-first software.",
  requirements: [{ id: "requirement-1", text: "TypeScript experience", priority: "critical" }],
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

function artifact(version: number): DraftArtifact {
  return {
    schemaVersion: 1,
    id: `artifact-${version}`,
    version,
    parentVersionId: version === 1 ? null : `artifact-${version - 1}`,
    createdAt: timestamp,
    language: "en",
    sections: [
      {
        id: `summary-${version}`,
        title: "Summary",
        kind: "summary",
        order: 0,
        blocks: [
          {
            id: `summary-block-${version}`,
            type: "paragraph",
            text: excerpt,
            claimIds: [`claim-${version}`],
          },
        ],
      },
    ],
    claims: [
      {
        id: `claim-${version}`,
        text: excerpt,
        sectionId: `summary-${version}`,
        blockId: `summary-block-${version}`,
        substantive: true,
        status: "verified",
        evidence: [{ sourcePath: "/local/candidate/resume.md", sourceChecksum: checksum, excerpt }],
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
    completedAt: timestamp,
  };
}

function harness() {
  const authorRequests: AuthorRequest[] = [];
  const criticRequests: CriticRequest[] = [];
  const critique: Critique = { findings: [] };
  const engine = createOrchestrationEngine({
    author: {
      execute: async (request) => {
        authorRequests.push(request);
        return execution(artifact(request.round), "anthropic", "author-test");
      },
    },
    critic: {
      execute: async (request) => {
        criticRequests.push(request);
        return execution(critique, "openai", "critic-test");
      },
    },
    store: new InMemoryRunStore(),
    now: () => timestamp,
  });
  return { engine, authorRequests, criticRequests };
}

const start = (engine: ReturnType<typeof harness>["engine"], maxRounds = 3) =>
  engine.start({
    runId: "run-1",
    workspace: createWorkspace("workspace-1"),
    context,
    budget: { maxRounds },
  });

describe("candidate direction between rounds", () => {
  it("reaches the revising author and the next critic, and is recorded for the round", async () => {
    const { engine, authorRequests, criticRequests } = harness();
    await start(engine);
    const requested = await engine.requestRevision("run-1", {
      candidateDirection: "  Lead with tokenisation.  ",
    });
    expect(requested.candidateDirection).toEqual({
      round: 2,
      text: "Lead with tokenisation.",
      createdAt: timestamp,
    });
    const revised = await engine.resume("run-1", { context });

    expect(authorRequests[0]).not.toHaveProperty("candidateDirection");
    expect(criticRequests[0]).not.toHaveProperty("candidateDirection");
    expect(authorRequests[1]?.candidateDirection?.text).toBe("Lead with tokenisation.");
    expect(criticRequests[1]?.candidateDirection?.text).toBe("Lead with tokenisation.");
    expect(revised.candidateDirection?.round).toBe(revised.round);
    const events = await engine.events("run-1");
    expect(events.find((event) => event.type === "user.revision-requested")?.details).toEqual({
      candidateDirectionCharacters: "Lead with tokenisation.".length,
    });
  });

  it("does not carry a direction into a later round that has none", async () => {
    const { engine, authorRequests, criticRequests } = harness();
    await start(engine);
    await engine.requestRevision("run-1", { candidateDirection: "Drop certification dates." });
    await engine.resume("run-1", { context });
    const third = await engine.requestRevision("run-1");
    expect(third).not.toHaveProperty("candidateDirection");
    await engine.resume("run-1", { context });

    expect(authorRequests).toHaveLength(3);
    expect(authorRequests[2]).not.toHaveProperty("candidateDirection");
    expect(criticRequests[2]).not.toHaveProperty("candidateDirection");
  });

  it("behaves as before without directions, including blank ones", async () => {
    const { engine, authorRequests } = harness();
    await start(engine);
    const requested = await engine.requestRevision("run-1", { candidateDirection: "   " });
    expect(requested).not.toHaveProperty("candidateDirection");
    await engine.resume("run-1", { context });
    expect(authorRequests[1]).not.toHaveProperty("candidateDirection");
    expect(
      (await engine.events("run-1")).find((event) => event.type === "user.revision-requested")
        ?.details,
    ).toBeUndefined();
  });

  it("refuses an oversized direction before the run changes", async () => {
    const { engine } = harness();
    const reviewed = await start(engine);
    await expect(
      engine.requestRevision("run-1", {
        candidateDirection: "x".repeat(maximumCandidateDirectionCharacters + 1),
      }),
    ).rejects.toThrow("limited to 1000 characters");
    expect((await engine.requestRevision("run-1")).round).toBe(reviewed.round + 1);
  });
});

describe("normalizeCandidateDirectionText", () => {
  it("trims, drops blanks, and bounds the text", () => {
    expect(normalizeCandidateDirectionText(undefined)).toBeUndefined();
    expect(normalizeCandidateDirectionText("  \n ")).toBeUndefined();
    expect(normalizeCandidateDirectionText(" a ")).toBe("a");
    expect(normalizeCandidateDirectionText("x".repeat(1_000))).toHaveLength(1_000);
    expect(() => normalizeCandidateDirectionText("x".repeat(1_001))).toThrow();
  });
});
