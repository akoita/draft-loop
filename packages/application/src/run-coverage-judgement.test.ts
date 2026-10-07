import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ContextSnapshot, createContextSnapshot, createWorkspace } from "@draft-loop/domain";
import type { EmbeddingModelIdentity, TextEmbedder } from "@draft-loop/embeddings";
import { createOrchestrationEngine, InMemoryRunStore } from "@draft-loop/orchestrator";
import type { DraftArtifact } from "@draft-loop/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultEmbeddingModelTier, embeddingModelTiers } from "./embedding-model-install.js";
import { createRunCoverageJudgementPlanner } from "./run-coverage-judgement.js";
import { openRunEmbedder, resetRunEmbedderCacheForTests } from "./run-semantic-retrieval.js";
import { writeWorkspaceRetrievalMode } from "./workspace-retrieval-mode.js";

const identity: EmbeddingModelIdentity = {
  modelId: "fake-model",
  sourceRepository: "example/fake",
  revision: "rev-1",
  modelFileSha256: "a".repeat(64),
  dimensions: 3,
  pooling: "cls",
  runtime: "fake-runtime",
};
const floor = { maxMarginFromTop: 0.05, minimumScore: 0.5 };

const orchestrationBlock = "Ran clusters of services for the platform.";
const typescriptBlock = "Built TypeScript interfaces for the portal.";
const artifact = {
  sections: [
    {
      blocks: [
        { id: "b-ops", text: orchestrationBlock },
        { id: "b-ts", text: typescriptBlock },
      ],
    },
  ],
} as unknown as DraftArtifact;
const context = {
  requirements: [
    { id: "r-orchestration", text: "Container orchestration background" },
    { id: "r-typescript", text: "TypeScript interfaces" },
  ],
} as unknown as ContextSnapshot;

function fakeEmbedder(): TextEmbedder {
  const vectors = new Map<string, number[]>([
    [orchestrationBlock, [1, 0, 0]],
    [typescriptBlock, [0, 1, 0]],
    ["Container orchestration background", [0.95, 0.1, 0.29]],
    ["TypeScript interfaces", [0, 1, 0]],
  ]);
  return {
    identity,
    embed: async (texts) => texts.map((text) => Float32Array.from(vectors.get(text) ?? [0, 0, 1])),
    dispose: async () => undefined,
  };
}

const roots: string[] = [];
async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "draft-loop-coverage-judgement-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  resetRunEmbedderCacheForTests();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("run coverage judgement planner", () => {
  it("returns the requests for needs-judgement candidates and keeps covered assessments", async () => {
    const root = await temporaryRoot();
    const open = vi.fn(async () => ({ ok: true as const, embedder: fakeEmbedder() }));
    const planner = createRunCoverageJudgementPlanner({ root, modelRoot: root, open, floor });

    const plan = await planner.plan({ artifact, context });

    expect(plan?.requests).toEqual([
      { requirementId: "r-orchestration", candidateBlockIds: ["b-ops"] },
    ]);
    expect(plan?.assessments.map(({ requirementId, status }) => [requirementId, status])).toEqual([
      ["r-orchestration", "needs-judgement"],
      ["r-typescript", "covered"],
    ]);
  });

  it("returns an empty request list when no candidate passes the floor", async () => {
    const root = await temporaryRoot();
    const open = async () => ({ ok: true as const, embedder: fakeEmbedder() });
    const planner = createRunCoverageJudgementPlanner({
      root,
      modelRoot: root,
      open,
      floor: { maxMarginFromTop: 0.05, minimumScore: 0.99 },
    });

    const plan = await planner.plan({ artifact, context });

    expect(plan?.requests).toEqual([]);
  });

  it("returns undefined when the model is not installed", async () => {
    const root = await temporaryRoot();
    const modelRoot = join(root, "no-models");
    const planner = createRunCoverageJudgementPlanner({ root, modelRoot, floor });

    await expect(planner.plan({ artifact, context })).resolves.toBeUndefined();
  });

  it("opens the model tier saved in the workspace retrieval mode, even when lexical", async () => {
    const root = await temporaryRoot();
    const tier = embeddingModelTiers.find((candidate) => candidate !== defaultEmbeddingModelTier);
    if (tier === undefined) throw new Error("expected a non-default embedding tier");
    await writeWorkspaceRetrievalMode(root, { mode: "lexical", modelTier: tier });
    const open = vi.fn(async () => ({ ok: false as const, reason: "model-absent" as const }));
    const planner = createRunCoverageJudgementPlanner({ root, modelRoot: "models", open });

    await expect(planner.plan({ artifact, context })).resolves.toBeUndefined();

    expect(open).toHaveBeenCalledWith({ tier, modelRoot: "models" });
  });

  it("reads the setting once per planner", async () => {
    const root = await temporaryRoot();
    const open = vi.fn(async () => ({ ok: false as const, reason: "model-absent" as const }));
    const planner = createRunCoverageJudgementPlanner({ root, modelRoot: "models", open });

    await planner.plan({ artifact, context });
    await writeWorkspaceRetrievalMode(root, { mode: "semantic", modelTier: "97m" });
    await planner.plan({ artifact, context });

    expect(open).toHaveBeenCalledTimes(2);
    for (const call of open.mock.calls) {
      expect(call).toEqual([{ tier: defaultEmbeddingModelTier, modelRoot: "models" }]);
    }
  });

  it("is unavailable, not failing, when the retrieval setting is unreadable", async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, ".draft-loop"), { recursive: true });
    await writeFile(join(root, ".draft-loop", "retrieval-mode.json"), "{not json", "utf8");
    const open = vi.fn();
    const planner = createRunCoverageJudgementPlanner({ root, open });

    await expect(planner.plan({ artifact, context })).resolves.toBeUndefined();
    expect(open).not.toHaveBeenCalled();
  });

  it("shares one embedder per model directory and tier with semantic retrieval", async () => {
    const root = await temporaryRoot();
    const createEmbedder = vi.fn(async () => fakeEmbedder());
    const modelService = {
      status: vi.fn(async () => ({
        state: "ready" as const,
        modelDirectory: join(root, "model-dir"),
      })),
    };
    const open = (options: Parameters<typeof openRunEmbedder>[0]) =>
      openRunEmbedder({
        ...options,
        modelService: modelService as never,
        createEmbedder,
        shareEmbedder: true,
      });
    const first = createRunCoverageJudgementPlanner({ root, modelRoot: root, open, floor });
    const second = createRunCoverageJudgementPlanner({ root, modelRoot: root, open, floor });

    await first.plan({ artifact, context });
    await second.plan({ artifact, context });
    // The retrieval path asks the same cache for the same directory and tier.
    await open({ tier: defaultEmbeddingModelTier, modelRoot: root });

    expect(createEmbedder).toHaveBeenCalledTimes(1);
  });

  it("sends candidates to a fake critic, applies its verdicts and stores them with the execution", async () => {
    const root = await temporaryRoot();
    const stamp = "2026-10-01T10:00:00.000Z";
    const runContext = createContextSnapshot({
      id: "context-1",
      workspaceId: "workspace-1",
      createdAt: stamp,
      jobDescription: "Run container platforms.",
      requirements: [
        { id: "r-orchestration", text: "Container orchestration background", priority: "high" },
      ],
      candidateInstructions: "Be concise.",
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
          path: "/local/candidate/resume.md",
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
      id: "artifact-1",
      version: 1,
      parentVersionId: null,
      createdAt: stamp,
      language: "en",
      sections: [
        {
          id: "s-1",
          title: "Experience",
          kind: "experience",
          order: 0,
          blocks: [{ id: "b-ops", type: "bullet", text: orchestrationBlock, claimIds: [] }],
        },
      ],
      claims: [],
    } as unknown as DraftArtifact;
    const execution = (output: unknown, provider: string, modelId: string) => ({
      output,
      provider,
      modelId,
      providerRequestId: null,
      outputChecksum: "b".repeat(64),
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      estimatedUsd: null,
      completedAt: stamp,
    });
    const critic = vi.fn(async (_request: unknown) =>
      execution(
        {
          findings: [],
          coverageJudgements: [
            {
              requirementId: "r-orchestration",
              verdict: "satisfied",
              citedBlockIds: ["b-ops"],
              rationale: "The block describes running service clusters.",
            },
          ],
          coverageJudgementInstructionsVersion: "coverage-judgement-v1",
        },
        "openai",
        "critic-model",
      ),
    );
    const engine = createOrchestrationEngine({
      author: { execute: async () => execution(draft, "anthropic", "author-model") as never },
      critic: { execute: critic as never },
      store: new InMemoryRunStore(),
      now: () => stamp,
      coverageJudgement: createRunCoverageJudgementPlanner({
        root,
        open: async () => ({ ok: true, embedder: fakeEmbedder() }),
        floor,
      }),
    });

    const snapshot = await engine.start({
      runId: "run-1",
      workspace: createWorkspace("workspace-1"),
      context: runContext,
      budget: { maxRounds: 1 },
    });

    expect(critic.mock.calls[0]?.[0]).toMatchObject({
      coverageJudgementRequests: [
        { requirementId: "r-orchestration", candidateBlockIds: ["b-ops"] },
      ],
    });
    const record = snapshot.executionHistory.find(({ step }) => step === "critic");
    expect([record?.provider, record?.modelId]).toEqual(["openai", "critic-model"]);
    expect(record?.coverageJudgement).toMatchObject({
      instructionsVersion: "coverage-judgement-v1",
      summary: { judged: 1, satisfied: 1 },
      assessments: [{ requirementId: "r-orchestration", status: "covered", basis: "judgement" }],
    });
  });
});
