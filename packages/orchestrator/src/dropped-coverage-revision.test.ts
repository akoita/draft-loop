import { createContextSnapshot, createWorkspace } from "@draft-loop/domain";
import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it, vi } from "vitest";

import {
  type AgentExecution,
  type CoverageJudgementPlan,
  type Critique,
  createOrchestrationEngine,
  InMemoryRunStore,
} from "./index.js";

const timestamp = "2026-08-12T10:00:00.000Z";
const checksum = "a".repeat(64);
const excerpt = "Clear technical communication.";
const coveringText = "Shipped statically typed web services for years.";

const context = createContextSnapshot({
  id: "context-1",
  workspaceId: "workspace-1",
  createdAt: timestamp,
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

/** Every version gets new block ids, as real author output does. */
function artifact(version: number, experienceText: string): DraftArtifact {
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
          {
            id: `experience-block-${version}`,
            type: "bullet",
            text: experienceText,
            claimIds: [],
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

const plan: CoverageJudgementPlan = {
  assessments: [
    {
      requirementId: "requirement-1",
      status: "needs-judgement",
      basis: "semantic-candidate",
      evidence: [{ blockId: "experience-block-1", score: 0.8 }],
      rationale:
        "Possibly covered with different wording; needs judgement against the cited blocks.",
    },
  ],
  requests: [{ requirementId: "requirement-1", candidateBlockIds: ["experience-block-1"] }],
};

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

async function revise(revisedExperienceText: string) {
  const critique: Critique = {
    findings: [],
    coverageJudgements: [
      {
        requirementId: "requirement-1",
        verdict: "satisfied",
        citedBlockIds: ["experience-block-1"],
        rationale: "The block states the required experience.",
      },
    ],
  };
  const author = vi.fn(async (request: { readonly round: number }) =>
    execution(
      artifact(request.round, request.round === 1 ? coveringText : revisedExperienceText),
      "anthropic",
      "author-test",
    ),
  );
  const engine = createOrchestrationEngine({
    author: { execute: author },
    critic: { execute: vi.fn(async () => execution(critique, "openai", "critic-test")) },
    store: new InMemoryRunStore(),
    now: () => timestamp,
    coverageJudgement: {
      plan: async ({ artifact: draft }: { readonly artifact: DraftArtifact }) =>
        draft.version === 1 ? plan : undefined,
    },
  } as never);
  const reviewed = await engine.start({
    runId: "run-1",
    workspace: createWorkspace("workspace-1"),
    context,
    budget: { maxRounds: 2 },
  });
  await engine.requestRevision("run-1");
  const revised = await engine.resume("run-1", { context });
  return { reviewed, revised };
}

const dropped = (findings: readonly { readonly code: string }[]) =>
  findings.filter((finding) => finding.code === "coverage-block-dropped");

describe("revision that drops a covering block", () => {
  it("warns about the requirement whose judged covering block was removed", async () => {
    const { reviewed, revised } = await revise("Mentored two junior colleagues.");

    expect(dropped(reviewed.findings)).toEqual([]);
    expect(revised.artifact?.version).toBe(2);
    expect(dropped(revised.findings)).toEqual([
      {
        code: "coverage-block-dropped",
        category: "coverage",
        severity: "warning",
        message:
          "A block that covered this requirement in the previous version was removed or rewritten; check that the requirement is still shown.",
        requirementId: "requirement-1",
      },
    ]);
  });

  it("does not warn when the covering block is kept under a new id", async () => {
    const { revised } = await revise(coveringText);

    expect(revised.artifact?.version).toBe(2);
    expect(dropped(revised.findings)).toEqual([]);
  });
});
