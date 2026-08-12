import { type ContextSnapshot, createContextSnapshot, createWorkspace } from "@draft-loop/domain";
import type { DraftArtifact } from "@draft-loop/schemas";
import type { JsonValue } from "@draft-loop/storage";
import { describe, expect, it, vi } from "vitest";

import {
  type AgentExecution,
  type Critique,
  createOrchestrationEngine,
  createStorageRunStore,
  type ExecutionRecord,
  InMemoryRunStore,
  type RunSnapshot,
} from "./index.js";

const timestamp = "2026-08-12T10:00:00.000Z";
const checksum = "a".repeat(64);

function context(): ContextSnapshot {
  return createContextSnapshot({
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
    outputConstraints: {
      format: "markdown",
      maxWords: 800,
      requiredSections: ["Summary", "Experience"],
    },
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
        checksum,
      },
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
}

function artifact(version = 1): DraftArtifact {
  const claimId = `claim-${version}`;
  const summaryBlockId = `summary-block-${version}`;
  const experienceBlockId = `experience-block-${version}`;
  const summarySectionId = `summary-${version}`;
  const experienceSectionId = `experience-${version}`;
  return {
    schemaVersion: 1,
    id: `artifact-${version}`,
    version,
    parentVersionId: version === 1 ? null : `artifact-${version - 1}`,
    createdAt: timestamp,
    language: "en",
    sections: [
      {
        id: summarySectionId,
        title: "Summary",
        kind: "summary",
        order: 0,
        blocks: [
          {
            id: summaryBlockId,
            type: "paragraph",
            text: "TypeScript experience and clear technical communication.",
            claimIds: [claimId],
          },
        ],
      },
      {
        id: experienceSectionId,
        title: "Experience",
        kind: "experience",
        order: 1,
        blocks: [
          {
            id: experienceBlockId,
            type: "bullet",
            text: "Built local-first TypeScript software with clear technical communication.",
            claimIds: [],
          },
        ],
      },
    ],
    claims: [
      {
        id: claimId,
        text: "TypeScript experience and clear technical communication.",
        sectionId: summarySectionId,
        blockId: summaryBlockId,
        substantive: true,
        status: "verified",
        evidence: [
          {
            sourcePath: "/local/candidate/resume.md",
            sourceChecksum: checksum,
            excerpt: "TypeScript experience and clear technical communication.",
          },
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
    completedAt: timestamp,
  };
}

function engineFixture(
  options: {
    readonly author?: (request: unknown) => Promise<AgentExecution<DraftArtifact>>;
    readonly critic?: (request: unknown) => Promise<AgentExecution<Critique>>;
    readonly store?: InMemoryRunStore;
  } = {},
) {
  const store = options.store ?? new InMemoryRunStore();
  const author = vi.fn(
    options.author ?? (async () => execution(artifact(), "anthropic", "author-test")),
  );
  const critic = vi.fn(
    options.critic ?? (async () => execution({ findings: [] }, "openai", "critic-test")),
  );
  const engine = createOrchestrationEngine({
    author: { execute: author },
    critic: { execute: critic },
    store,
    now: () => timestamp,
  });
  return { engine, author, critic, store };
}

function request(
  overrides: Partial<Parameters<ReturnType<typeof engineFixture>["engine"]["start"]>[0]> = {},
) {
  return {
    runId: "run-1",
    workspace: createWorkspace("workspace-1"),
    context: context(),
    budget: { maxRounds: 3 },
    ...overrides,
  };
}

function pausedSnapshot(): RunSnapshot {
  return {
    schemaVersion: 1,
    runId: "run-1",
    workspaceId: "workspace-1",
    contextSnapshotId: "context-1",
    state: "drafting",
    round: 1,
    currentStep: "author",
    budget: { maxRounds: 3 },
    artifact: null,
    findings: [],
    latestEvaluation: null,
    scoreHistory: [],
    executionHistory: [],
    totalCostUsd: 0,
    approval: "pending",
    startedAt: timestamp,
    updatedAt: timestamp,
    lastError: null,
  };
}

describe("durable orchestration", () => {
  it("runs author and critic steps, then requires explicit approval", async () => {
    const { engine, author, critic } = engineFixture();

    const result = await engine.start(request());

    expect(result.state).toBe("awaiting-approval");
    expect(result.latestEvaluation?.ready).toBe(true);
    expect(result.executionHistory).toHaveLength(2);
    expect(author).toHaveBeenCalledOnce();
    expect(critic).toHaveBeenCalledOnce();
    expect(
      result.executionHistory.every((execution) => execution.contextSnapshotId === "context-1"),
    ).toBe(true);
    expect((await engine.approve("run-1")).state).toBe("approved");
    expect((await engine.events("run-1")).map((event) => event.type)).toEqual(
      expect.arrayContaining(["run.created", "step.completed", "state.changed", "user.approved"]),
    );
  });

  it("rejects invalid or cross-workspace context before invoking an agent", async () => {
    const { engine, author, critic } = engineFixture();
    const mismatched = createContextSnapshot({
      ...context(),
      id: "context-other",
      workspaceId: "workspace-other",
    });

    await expect(engine.start(request({ context: mismatched }))).rejects.toThrow(
      /must belong to the requested workspace/i,
    );
    expect(author).not.toHaveBeenCalled();
    expect(critic).not.toHaveBeenCalled();

    const invalid = { ...context(), requirements: [] } as unknown as ContextSnapshot;
    await expect(engine.start(request({ context: invalid }))).rejects.toThrow(
      /requirements: at least one normalized job requirement/i,
    );
    expect(author).not.toHaveBeenCalled();
    expect(critic).not.toHaveBeenCalled();
  });

  it("persists failed attempts and retries with a new execution id", async () => {
    let attempts = 0;
    const { engine, author } = engineFixture({
      author: async () => {
        attempts += 1;
        if (attempts === 1) {
          const error = new Error("temporary provider failure") as Error & { code: string };
          error.code = "timeout";
          throw error;
        }
        return execution(artifact(), "anthropic", "author-test");
      },
    });

    const failed = await engine.start(request());
    expect(failed.state).toBe("provider-error");
    expect(failed.executionHistory).toHaveLength(1);
    expect(failed.executionHistory[0]?.status).toBe("failed");

    const resumed = await engine.resume("run-1", { context: context() });
    expect(resumed.state).toBe("awaiting-approval");
    expect(author).toHaveBeenCalledTimes(2);
    expect(resumed.executionHistory.map((item) => item.id)).toEqual(
      expect.arrayContaining(["run-1:1:author:attempt:1", "run-1:1:author:attempt:2"]),
    );
    expect((await engine.events("run-1")).map((event) => event.type)).toContain("provider.failed");
  });

  it("pauses and stops without running a provider, then resumes a paused run", async () => {
    const store = new InMemoryRunStore();
    await store.saveRun(pausedSnapshot());
    const { engine, author } = engineFixture({ store });

    const paused = await engine.pause("run-1");
    expect(paused.state).toBe("paused");
    expect(author).not.toHaveBeenCalled();

    const resumed = await engine.resume("run-1", { context: context() });
    expect(resumed.state).toBe("awaiting-approval");
    expect(author).toHaveBeenCalledOnce();

    const stopped = await engine.stop("run-1");
    expect(stopped.state).toBe("stopped");
    expect(stopped.currentStep).toBeNull();
  });

  it("stops at a cost budget and leaves the best available result awaiting approval", async () => {
    const { engine, author, critic } = engineFixture();

    const result = await engine.start(request({ budget: { maxRounds: 3, maxCostUsd: 0 } }));

    expect(result.state).toBe("awaiting-approval");
    expect(result.latestEvaluation).toBeNull();
    expect(author).not.toHaveBeenCalled();
    expect(critic).not.toHaveBeenCalled();
    expect((await engine.events("run-1")).map((event) => event.type)).toContain("budget.exhausted");
  });

  it("reuses a completed persisted execution instead of calling the provider twice", async () => {
    const store = new InMemoryRunStore();
    const savedArtifact = artifact();
    const completed: ExecutionRecord<DraftArtifact> = {
      ...execution(savedArtifact, "anthropic", "author-test"),
      id: "run-1:1:author:attempt:1",
      runId: "run-1",
      contextSnapshotId: "context-1",
      round: 1,
      step: "author",
      status: "completed",
    };
    await store.saveExecution(completed);
    await store.saveRun({ ...pausedSnapshot(), executionHistory: [] });
    const { engine, author, critic } = engineFixture({ store });

    const result = await engine.resume("run-1", { context: context() });

    expect(result.state).toBe("awaiting-approval");
    expect(result.executionHistory.map((item) => item.id)).toContain(completed.id);
    expect(author).not.toHaveBeenCalled();
    expect(critic).toHaveBeenCalledOnce();
    expect((await engine.events("run-1")).map((event) => event.type)).toContain("execution.reused");
  });

  it("persists snapshots, executions, and ordered events through the storage adapter", async () => {
    const values = new Map<string, string>();
    const auditEvents: Array<{
      readonly eventType: string;
      readonly entityId: string;
      readonly payload: JsonValue;
      readonly workspaceId: string;
    }> = [];
    const store = createStorageRunStore({
      get: async (key) => values.get(key),
      set: async (key, value) => {
        values.set(key, value);
      },
      appendAuditEvent: async (event) => {
        auditEvents.push(event);
      },
      listAuditEvents: async (workspaceId) =>
        auditEvents
          .filter((event) => event.workspaceId === workspaceId)
          .map((event, index) => ({ ...event, sequence: index + 1 })),
    });
    const snapshot = pausedSnapshot();
    await store.saveRun(snapshot);
    const savedEvent = await store.appendEvent({
      id: "run-1:event:1",
      runId: "run-1",
      workspaceId: "workspace-1",
      type: "run.created",
      state: "drafting",
      round: 1,
      step: "author",
      createdAt: timestamp,
    });

    expect(await store.loadRun("run-1")).toEqual(snapshot);
    expect(await store.listEvents("run-1")).toEqual([savedEvent]);
    await expect(
      store.saveExecution({
        id: "run-1:1:author:attempt:1",
        runId: "run-1",
        contextSnapshotId: "context-1",
        round: 1,
        step: "author",
        status: "failed",
        provider: "unknown",
        modelId: "unknown",
        providerRequestId: null,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedUsd: null,
        completedAt: timestamp,
        errorCode: "timeout",
      }),
    ).resolves.toBeUndefined();
    await expect(
      store.saveExecution({
        id: "run-1:1:author:attempt:1",
        runId: "run-1",
        contextSnapshotId: "context-1",
        round: 1,
        step: "author",
        status: "failed",
        provider: "different-provider",
        modelId: "different-model",
        providerRequestId: null,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedUsd: null,
        completedAt: timestamp,
        errorCode: "different-error",
      }),
    ).rejects.toThrow(/immutable/);
  });
});
