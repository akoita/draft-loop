import { createContextSnapshot, createWorkspace } from "@draft-loop/domain";
import type { DraftArtifact } from "@draft-loop/schemas";
import type { ApplicationPlan, ApplicationPlanReview } from "@draft-loop/schemas/application-plan";
import { describe, expect, it } from "vitest";

import type { ApplicationPlanner } from "./application-plan.js";
import {
  type AgentExecution,
  type AuthorRequest,
  type CriticRequest,
  createOrchestrationEngine,
  InMemoryRunStore,
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

const theme = (title: string, gap = false) => ({
  title,
  rationale: "The job centres on it.",
  requirementIds: ["requirement-1"],
  evidenceChunkIds: gap ? [] : ["chunk-1"],
  gap,
});
const plan = (title: string): ApplicationPlan => ({
  themes: [theme(title), theme("Payments"), theme("Kubernetes", true)],
  leads: {
    summaryAngle: `Lead with ${title}.`,
    coreAreas: [
      { text: title, themeRank: 1 },
      { text: "Payments", themeRank: 2 },
      { text: "Platform", themeRank: 1 },
    ],
  },
  cuts: [],
});
const accept: ApplicationPlanReview = { verdict: "accept", points: [] };
const revise: ApplicationPlanReview = {
  verdict: "revise",
  points: [{ text: "Lead with tokenisation.", themeRank: 1 }],
};

function harness(options: {
  readonly review?: ApplicationPlanReview;
  readonly failReviewOnce?: boolean;
  readonly applies?: boolean;
  readonly maxCostUsd?: number;
  /** The plan call is served by a metered route that could not price it. */
  readonly unpricedPlan?: boolean;
}) {
  const calls: string[] = [];
  const authorRequests: AuthorRequest[] = [];
  const criticRequests: CriticRequest[] = [];
  let reviewFailures = options.failReviewOnce === true ? 1 : 0;
  const planner: ApplicationPlanner = {
    applies: () => options.applies ?? true,
    plan: async () => {
      calls.push("plan");
      const planned = execution(plan("Payments first"), "anthropic", "author-test");
      return options.unpricedPlan === true
        ? { ...planned, route: "vertex-ai", estimatedUsd: null }
        : planned;
    },
    review: async () => {
      calls.push("review");
      if (reviewFailures > 0) {
        reviewFailures -= 1;
        throw { code: "transient" };
      }
      return execution(options.review ?? accept, "openai", "critic-test");
    },
    revise: async () => {
      calls.push("revise");
      return execution(plan("Tokenisation first"), "anthropic", "author-test");
    },
  };
  const engine = createOrchestrationEngine({
    author: {
      execute: async (request) => {
        calls.push("draft");
        authorRequests.push(request);
        return execution(artifact(request.round), "anthropic", "author-test");
      },
    },
    critic: {
      execute: async (request) => {
        calls.push("critic");
        criticRequests.push(request);
        return execution({ findings: [] }, "openai", "critic-test");
      },
    },
    planner,
    store: new InMemoryRunStore(),
    now: () => timestamp,
  });
  const start = (maxRounds = 3) =>
    engine.start({
      runId: "run-1",
      workspace: createWorkspace("workspace-1"),
      context,
      budget: {
        maxRounds,
        ...(options.maxCostUsd === undefined ? {} : { maxCostUsd: options.maxCostUsd }),
      },
    });
  return { engine, calls, authorRequests, criticRequests, start };
}

describe("application plan step", () => {
  it("plans, reviews and drafts in that order when the critic accepts", async () => {
    const { calls, start, authorRequests, criticRequests } = harness({});
    const snapshot = await start();
    expect(calls.slice(0, 3)).toEqual(["plan", "review", "draft"]);
    expect(snapshot.applicationPlan?.review?.verdict).toBe("accept");
    expect(snapshot.applicationPlan?.revisedPlan).toBeNull();
    expect(authorRequests[0]?.applicationPlan?.themes[0]?.title).toBe("Payments first");
    expect(criticRequests[0]?.applicationPlan?.themes[0]?.title).toBe("Payments first");
  });

  it("revises the plan once when the critic asks, and drafts from the revision", async () => {
    const { calls, start, authorRequests } = harness({ review: revise });
    const snapshot = await start();
    expect(calls.slice(0, 4)).toEqual(["plan", "review", "revise", "draft"]);
    expect(calls.filter((call) => call === "review")).toHaveLength(1);
    expect(authorRequests[0]?.applicationPlan?.themes[0]?.title).toBe("Tokenisation first");
    expect(snapshot.applicationPlan?.steps.map(({ step }) => step)).toEqual([
      "plan",
      "review",
      "revision",
    ]);
  });

  it("counts the plan step's cost in the run cost", async () => {
    const accepted = await harness({}).start();
    // plan + review + draft + critic
    expect(accepted.totalCostUsd).toBeCloseTo(0.04);
    const revised = await harness({ review: revise }).start();
    // plan + review + revision + draft + critic
    expect(revised.totalCostUsd).toBeCloseTo(0.05);
  });

  it("keeps the plan in context for the revising author", async () => {
    const { engine, authorRequests, start } = harness({ review: revise });
    await start();
    await engine.requestRevision("run-1");
    await engine.resume("run-1", { context });
    expect(authorRequests.length).toBeGreaterThanOrEqual(2);
    expect(authorRequests.at(-1)?.applicationPlan?.themes[0]?.title).toBe("Tokenisation first");
  });

  it("stops before the next plan call when the cost budget is spent", async () => {
    const { calls, start } = harness({ maxCostUsd: 0.015 });
    const snapshot = await start();
    expect(calls).toEqual(["plan", "review"]);
    expect(snapshot.state).toBe("awaiting-approval");
    expect(snapshot.artifact).toBeNull();
    expect(snapshot.totalCostUsd).toBeCloseTo(0.02);
  });

  it("records the plan call's route and stops a cost-capped run when it could not be priced", async () => {
    const { calls, start } = harness({ maxCostUsd: 3, unpricedPlan: true });
    const snapshot = await start();
    expect(calls).toEqual(["plan"]);
    expect(snapshot.applicationPlan?.steps).toMatchObject([
      { step: "plan", route: "vertex-ai", estimatedUsd: null },
    ]);
    expect(snapshot.artifact).toBeNull();
  });

  it("resumes mid-plan without repeating the plan call", async () => {
    const { engine, calls, start } = harness({ failReviewOnce: true });
    const failed = await start();
    expect(failed.state).toBe("provider-error");
    expect(failed.lastError?.step).toBe("author");
    // the review failed: its provider is the critic's, not the author's
    expect(failed.lastError?.provider).toBe("openai");
    expect(failed.applicationPlan?.review).toBeNull();
    expect(calls).toEqual(["plan", "review"]);

    const resumed = await engine.resume("run-1", { context });
    expect(calls.slice(0, 4)).toEqual(["plan", "review", "review", "draft"]);
    expect(calls.filter((call) => call === "plan")).toHaveLength(1);
    expect(resumed.applicationPlan?.review?.verdict).toBe("accept");
    expect(resumed.artifact).not.toBeNull();
  });

  it("does not plan when the planner does not apply, and leaves requests unchanged", async () => {
    const { calls, start, authorRequests, criticRequests } = harness({ applies: false });
    const snapshot = await start();
    expect(calls[0]).toBe("draft");
    expect(snapshot.applicationPlan).toBeUndefined();
    expect(authorRequests[0]).not.toHaveProperty("applicationPlan");
    expect(criticRequests[0]).not.toHaveProperty("applicationPlan");
  });
});
