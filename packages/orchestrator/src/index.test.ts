import { type ContextSnapshot, createContextSnapshot, createWorkspace } from "@draft-loop/domain";
import type { DraftArtifact } from "@draft-loop/schemas";
import type { JsonValue, RunSnapshotRecordInput } from "@draft-loop/storage";
import { describe, expect, it, vi } from "vitest";

import {
  type AgentExecution,
  type Critique,
  createOrchestrationEngine,
  createStorageRunStore,
  type ExecutionRecord,
  hasCompletedIndependentCritique,
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

function critiqueExecution(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    ...execution({ findings: [] }, "openai", "critic-test"),
    id: "run-1:1:critic:attempt:1",
    runId: "run-1",
    contextSnapshotId: "context-1",
    round: 1,
    step: "critic",
    status: "completed",
    ...overrides,
  };
}

function engineFixture(
  options: {
    readonly author?: (request: unknown) => Promise<AgentExecution<DraftArtifact>>;
    readonly critic?: (request: unknown) => Promise<AgentExecution<Critique>>;
    readonly store?: InMemoryRunStore;
    readonly now?: () => string;
    readonly retrieval?: {
      readonly queryEvidence: (
        query: string,
        options?: { readonly workspaceId?: string; readonly limit?: number },
      ) => Promise<readonly unknown[]>;
    };
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
    now: options.now ?? (() => timestamp),
    ...(options.retrieval ? { retrieval: options.retrieval as never } : {}),
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
  it("only recognizes a completed current-round critic with a structured output", () => {
    const base = {
      runId: "run-1",
      contextSnapshotId: "context-1",
      round: 1,
      executionHistory: [critiqueExecution()],
    } satisfies Pick<RunSnapshot, "runId" | "contextSnapshotId" | "round" | "executionHistory">;

    expect(hasCompletedIndependentCritique(base)).toBe(true);
    const { output: ignoredOutput, ...missingOutput } = critiqueExecution();
    void ignoredOutput;
    const invalidExecutions: ExecutionRecord[] = [
      critiqueExecution({ status: "failed" }),
      critiqueExecution({ round: 2 }),
      critiqueExecution({ contextSnapshotId: "context-old" }),
      critiqueExecution({ step: "author" }),
      missingOutput,
    ];
    for (const execution of invalidExecutions) {
      expect(
        hasCompletedIndependentCritique({
          ...base,
          executionHistory: [execution],
        }),
      ).toBe(false);
    }
  });

  it("persists a run identity before invoking either agent", async () => {
    const { engine, author, critic } = engineFixture();

    const begun = await engine.begin(request());

    expect(begun).toMatchObject({
      runId: "run-1",
      state: "drafting",
      currentStep: "author",
      artifact: null,
    });
    expect(author).not.toHaveBeenCalled();
    expect(critic).not.toHaveBeenCalled();
    expect((await engine.events("run-1")).map((event) => event.type)).toEqual(["run.created"]);

    const controller = new AbortController();
    const completed = await engine.resume("run-1", {
      context: context(),
      signal: controller.signal,
    });
    expect(completed.state).toBe("awaiting-approval");
    expect(author).toHaveBeenCalledOnce();
    expect(critic).toHaveBeenCalledOnce();
    expect(author.mock.calls[0]?.[0]).toMatchObject({ signal: controller.signal });
    expect(critic.mock.calls[0]?.[0]).toMatchObject({ signal: controller.signal });
  });

  it("records an aborted provider step as a content-free cancellation", async () => {
    const controller = new AbortController();
    const { engine } = engineFixture({
      author: async () => {
        throw controller.signal.reason;
      },
    });
    await engine.begin(request());
    controller.abort(new DOMException("private cancellation reason", "AbortError"));

    const cancelled = await engine.resume("run-1", {
      context: context(),
      signal: controller.signal,
    });

    expect(cancelled).toMatchObject({
      state: "provider-error",
      lastError: { code: "cancelled", retryable: false, step: "author" },
    });
    expect(JSON.stringify(cancelled)).not.toContain("private cancellation reason");
  });

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
    expect((await engine.markExported("run-1")).state).toBe("exported");
    expect((await engine.markExported("run-1")).state).toBe("exported");
    expect((await engine.events("run-1")).map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "run.created",
        "step.completed",
        "state.changed",
        "user.approved",
        "user.exported",
      ]),
    );
  });

  it("allows a reviewed snapshot to request a revision", async () => {
    const { engine } = engineFixture();

    const reviewed = await engine.start(request());
    const revision = await engine.requestRevision("run-1");

    expect(reviewed.state).toBe("awaiting-approval");
    expect(revision).toMatchObject({
      state: "revising",
      approval: "rejected",
      round: 2,
      currentStep: "revision",
    });
  });

  it("keeps the last reviewed round intact when the configured round limit is reached", async () => {
    const { engine, store } = engineFixture();

    const reviewed = await engine.start(request({ budget: { maxRounds: 1 } }));

    await expect(engine.requestRevision("run-1")).rejects.toThrow(
      /maximum round limit reached \(1\)/i,
    );
    expect(await store.loadRun("run-1")).toEqual(reviewed);
  });

  it("recovers an empty over-limit round to the preceding fully reviewed round", async () => {
    const { engine, store } = engineFixture();
    await engine.start(request({ budget: { maxRounds: 2 } }));
    await engine.requestRevision("run-1");
    const reviewedRoundTwo = await engine.resume("run-1", { context: context() });
    await store.saveRun({
      ...reviewedRoundTwo,
      state: "awaiting-approval",
      round: 3,
      currentStep: null,
      lastError: null,
    });

    const recovered = await engine.recoverRoundBudget("run-1");

    expect(recovered).toMatchObject({ state: "awaiting-approval", round: 2, approval: "pending" });
    expect(hasCompletedIndependentCritique(recovered)).toBe(true);
    expect((await engine.events("run-1")).map((event) => event.type)).toContain(
      "user.round-budget-recovered",
    );
  });

  it("refuses round-limit recovery after any work occurred in the extra round", async () => {
    const store = new InMemoryRunStore();
    await store.saveRun({
      ...pausedSnapshot(),
      state: "awaiting-approval",
      round: 4,
      budget: { maxRounds: 3 },
      currentStep: null,
      artifact: artifact(),
      executionHistory: [
        critiqueExecution({ round: 3, id: "run-1:3:critic:attempt:1" }),
        critiqueExecution({ round: 4, id: "run-1:4:critic:attempt:1", status: "failed" }),
      ],
    });
    const { engine } = engineFixture({ store });

    await expect(engine.recoverRoundBudget("run-1")).rejects.toThrow(/not eligible/i);
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
          const error = new Error("temporary provider failure") as Error & {
            code: string;
            diagnostics: readonly { code: string; path: string }[];
          };
          error.code = "timeout";
          error.diagnostics = [
            { code: "invalid_type", path: "sections.0.blocks" },
            { code: "unsafe", path: "candidate secret text!" },
          ];
          throw error;
        }
        return execution(artifact(), "anthropic", "author-test");
      },
    });

    const failed = await engine.start(request());
    expect(failed.state).toBe("provider-error");
    expect(failed.executionHistory).toHaveLength(1);
    expect(failed.executionHistory[0]).toMatchObject({
      status: "failed",
      provider: "anthropic",
      modelId: "author-test",
      attempt: 1,
      maxAttempts: 3,
      retryable: true,
    });
    expect(failed.lastError).toMatchObject({
      code: "timeout",
      provider: "anthropic",
      modelId: "author-test",
      step: "author",
      attempt: 1,
      maxAttempts: 3,
      retryable: true,
      diagnostics: [{ code: "invalid_type", path: "sections.0.blocks" }],
    });

    const resumed = await engine.resume("run-1", { context: context() });
    expect(resumed.state).toBe("awaiting-approval");
    expect(author).toHaveBeenCalledTimes(2);
    expect(resumed.executionHistory.map((item) => item.id)).toEqual(
      expect.arrayContaining(["run-1:1:author:attempt:1", "run-1:1:author:attempt:2"]),
    );
    expect((await engine.events("run-1")).map((event) => event.type)).toContain("provider.failed");
  });

  it("retries a failed critic without rerunning the author", async () => {
    const savedArtifact = artifact();
    let criticAttempts = 0;
    const { engine, author, critic } = engineFixture({
      author: async () => execution(savedArtifact, "anthropic", "author-test"),
      critic: async () => {
        criticAttempts += 1;
        if (criticAttempts === 1) {
          throw Object.assign(new Error("temporary critic failure"), { code: "timeout" });
        }
        return execution({ findings: [] }, "openai", "critic-test");
      },
    });

    const failed = await engine.start(request());
    const recovered = await engine.resume("run-1", { context: context() });

    expect(failed).toMatchObject({ state: "provider-error", round: 1, currentStep: "critic" });
    expect(recovered).toMatchObject({
      state: "awaiting-approval",
      round: 1,
      contextSnapshotId: "context-1",
      artifact: savedArtifact,
    });
    expect(recovered.executionHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ step: "author", status: "completed" }),
        expect.objectContaining({ step: "critic", status: "failed", attempt: 1 }),
        expect.objectContaining({ step: "critic", status: "completed", attempt: 2 }),
      ]),
    );
    expect(author).toHaveBeenCalledOnce();
    expect(critic).toHaveBeenCalledTimes(2);
  });

  it("allows a bounded retry when a provider response fails local validation", async () => {
    let attempts = 0;
    const { engine, author } = engineFixture({
      author: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw Object.assign(new Error("private invalid response"), {
            code: "invalid-response",
            retryable: true,
            diagnostics: [
              { code: "custom", path: "sections.0.blocks.0.claims.0.evidenceChunkIds.0" },
            ],
          });
        }
        return execution(artifact(), "anthropic", "author-test");
      },
    });

    const failed = await engine.start(request());
    expect(failed.lastError).toMatchObject({
      code: "invalid-response",
      attempt: 1,
      maxAttempts: 3,
      retryable: true,
      diagnostics: [{ code: "custom", path: "sections.0.blocks.0.claims.0.evidenceChunkIds.0" }],
    });
    expect(JSON.stringify(failed)).not.toContain("private invalid response");

    const resumed = await engine.resume("run-1", { context: context() });
    expect(resumed.state).toBe("awaiting-approval");
    expect(author).toHaveBeenCalledTimes(2);
  });

  it("persists an absolute retry time and blocks resume until the provider delay passes", async () => {
    let now = timestamp;
    const failure = Object.assign(new Error("private provider body"), {
      code: "rate-limit",
      retryAfterMs: 4_000,
      retryable: true,
    });
    let calls = 0;
    const { engine, author } = engineFixture({
      now: () => now,
      author: async () => {
        calls += 1;
        if (calls === 1) throw failure;
        return execution(artifact(), "anthropic", "author-test");
      },
    });

    const failed = await engine.start(request());
    expect(failed.lastError).toMatchObject({
      code: "rate-limit",
      retryable: true,
      retryNotBefore: "2026-08-12T10:00:04.000Z",
    });

    const early = await engine.resume("run-1", { context: context() });
    expect(early).toEqual(failed);
    expect(author).toHaveBeenCalledOnce();

    now = "2026-08-12T10:00:04.000Z";
    const recovered = await engine.resume("run-1", { context: context() });
    expect(recovered.state).toBe("awaiting-approval");
    expect(author).toHaveBeenCalledTimes(2);
  });

  it("applies a durable fallback cooldown when a rate limit omits retry timing", async () => {
    const failure = Object.assign(new Error("private provider body"), {
      code: "rate-limit",
      retryable: true,
    });
    const { engine } = engineFixture({
      author: async () => {
        throw failure;
      },
    });

    const failed = await engine.start(request());

    expect(failed.lastError).toMatchObject({
      code: "rate-limit",
      retryNotBefore: "2026-08-12T10:00:05.000Z",
    });
  });

  it("bounds orchestration retries at three attempts across persisted resumes", async () => {
    const failure = Object.assign(new Error("secret provider response"), {
      code: "transient",
      retryable: true,
      requestId: "safe-request-id",
    });
    const { engine, author } = engineFixture({ author: async () => Promise.reject(failure) });

    let snapshot = await engine.start(request());
    snapshot = await engine.resume("run-1", { context: context() });
    snapshot = await engine.resume("run-1", { context: context() });
    const afterLimit = await engine.resume("run-1", { context: context() });

    expect(author).toHaveBeenCalledTimes(3);
    expect(snapshot.lastError).toMatchObject({
      attempt: 3,
      maxAttempts: 3,
      retryable: false,
      providerRequestId: "safe-request-id",
    });
    expect(afterLimit).toEqual(snapshot);
    expect(JSON.stringify(snapshot)).not.toContain("secret provider response");
  });

  it("allows bounded authentication recovery after credentials are corrected", async () => {
    let attempts = 0;
    const { engine, author } = engineFixture({
      author: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw Object.assign(new Error("credential response body"), {
            code: "authentication",
            retryable: false,
          });
        }
        return execution(artifact(), "anthropic", "author-test");
      },
    });

    const failed = await engine.start(request());
    expect(failed.lastError).toMatchObject({
      code: "authentication",
      retryable: true,
      attempt: 1,
      maxAttempts: 3,
    });

    const recovered = await engine.resume("run-1", { context: context() });
    expect(recovered.state).toBe("awaiting-approval");
    expect(author).toHaveBeenCalledTimes(2);
  });

  it("allowlists failure codes and drops secret-shaped or unbounded provider request ids", async () => {
    const secretRequestId = `sk-proj-${"secret".repeat(30)}`;
    const { engine } = engineFixture({
      author: async () =>
        Promise.reject(
          Object.assign(new Error("raw secret provider body"), {
            code: "sdk-secret-code",
            retryable: true,
            requestId: secretRequestId,
          }),
        ),
    });

    const failed = await engine.start(request());
    const serialized = JSON.stringify({ failed, events: await engine.events("run-1") });

    expect(failed.lastError).toMatchObject({
      code: "provider-error",
      providerRequestId: null,
      retryable: false,
    });
    expect(failed.executionHistory[0]).toMatchObject({
      errorCode: "provider-error",
      providerRequestId: null,
    });
    expect(serialized).not.toContain("sdk-secret-code");
    expect(serialized).not.toContain(secretRequestId);
    expect(serialized).not.toContain("raw secret provider body");
  });

  it("rejects returning an artifact-bearing provider failure to review without a critique", async () => {
    const { engine, critic, store } = engineFixture({
      critic: async () =>
        Promise.reject(
          Object.assign(new Error("private body"), { code: "permission", retryable: true }),
        ),
    });
    const failed = await engine.start(request());

    expect(failed.state).toBe("provider-error");
    expect(failed.artifact).not.toBeNull();
    expect(failed.lastError).toMatchObject({ code: "permission", retryable: false });
    await expect(engine.recoverToReview("run-1")).rejects.toThrow(
      /completed independent critic review/i,
    );
    expect(critic).toHaveBeenCalledOnce();
    expect(await store.loadRun("run-1")).toEqual(failed);
  });

  it("recovers a legacy awaiting-approval critic failure without invoking the author", async () => {
    const savedArtifact = artifact();
    let criticAttempts = 0;
    const { engine, author, critic, store } = engineFixture({
      author: async () => execution(savedArtifact, "anthropic", "author-test"),
      critic: async () => {
        criticAttempts += 1;
        if (criticAttempts === 1) {
          throw Object.assign(new Error("temporary critic failure"), { code: "timeout" });
        }
        return execution({ findings: [] }, "openai", "critic-test");
      },
    });

    const failed = await engine.start(request());
    const legacy = {
      ...failed,
      state: "awaiting-approval" as const,
      currentStep: null,
      approval: "pending" as const,
    };
    await store.saveRun(legacy);

    const recovered = await engine.resume("run-1", {
      context: context(),
      budget: { maxRounds: 99, maxCostUsd: 99 },
    });

    expect(recovered).toMatchObject({
      state: "awaiting-approval",
      round: failed.round,
      contextSnapshotId: failed.contextSnapshotId,
      artifact: savedArtifact,
      budget: failed.budget,
    });
    expect(recovered.executionHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ step: "author", status: "completed" }),
        expect.objectContaining({ step: "critic", status: "failed", attempt: 1 }),
        expect.objectContaining({ step: "critic", status: "completed", attempt: 2 }),
      ]),
    );
    expect(author).toHaveBeenCalledOnce();
    expect(critic).toHaveBeenCalledTimes(2);
  });

  it("leaves non-retryable and exhausted legacy critic failures unchanged", async () => {
    const createLegacy = async (lastError: RunSnapshot["lastError"]) => {
      const store = new InMemoryRunStore();
      const failedCritic: ExecutionRecord = {
        ...critiqueExecution({
          id: "run-1:1:critic:attempt:3",
          status: "failed",
          attempt: 3,
          maxAttempts: 3,
          retryable: false,
        }),
      };
      const snapshot: RunSnapshot = {
        ...pausedSnapshot(),
        state: "awaiting-approval",
        currentStep: null,
        artifact: artifact(),
        executionHistory: [failedCritic],
        lastError,
      };
      await store.saveRun(snapshot);
      const { engine, critic } = engineFixture({ store });
      const unchanged = await engine.resume("run-1", { context: context() });
      return { critic, snapshot, unchanged };
    };

    const nonRetryableError: RunSnapshot["lastError"] = {
      code: "permission",
      message: "The provider request failed. Retry is not available.",
      provider: "openai",
      modelId: "critic-test",
      step: "critic",
      attempt: 1,
      maxAttempts: 3,
      retryable: false,
      providerRequestId: null,
    };
    const exhaustedError: RunSnapshot["lastError"] = {
      ...nonRetryableError,
      attempt: 3,
      retryable: true,
    };

    const nonRetryable = await createLegacy(nonRetryableError);
    const exhausted = await createLegacy(exhaustedError);

    expect(nonRetryable.unchanged).toEqual(nonRetryable.snapshot);
    expect(exhausted.unchanged).toEqual(exhausted.snapshot);
    expect(nonRetryable.critic).not.toHaveBeenCalled();
    expect(exhausted.critic).not.toHaveBeenCalled();
  });

  it("rejects revision requests from a legacy awaiting-approval snapshot", async () => {
    const store = new InMemoryRunStore();
    await store.saveRun({
      ...pausedSnapshot(),
      state: "awaiting-approval",
      currentStep: null,
      artifact: artifact(),
      lastError: {
        code: "timeout",
        message: "The provider request failed. You can retry safely.",
        provider: "openai",
        modelId: "critic-test",
        step: "critic",
        attempt: 1,
        maxAttempts: 3,
        retryable: true,
        providerRequestId: null,
      },
    });
    const { engine } = engineFixture({ store });

    await expect(engine.requestRevision("run-1")).rejects.toThrow(
      /completed independent critic review/i,
    );
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
    expect(await engine.stop("run-1")).toEqual(stopped);
    expect(
      (await engine.events("run-1")).filter((event) => event.type === "user.stopped"),
    ).toHaveLength(1);
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
    const savedSnapshots: RunSnapshotRecordInput[] = [];
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
      saveRunSnapshot: async (input) => {
        savedSnapshots.push(input);
      },
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
    expect(savedSnapshots).toHaveLength(1);
    expect(savedSnapshots[0]?.payload).toEqual(snapshot);
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

  it("restores provider recovery metadata from a fresh storage adapter", async () => {
    const values = new Map<string, string>();
    const snapshots: RunSnapshotRecordInput[] = [];
    const storage = {
      get: async (key: string) => values.get(key),
      set: async (key: string, value: string) => {
        values.set(key, value);
      },
      appendAuditEvent: async () => undefined,
      listAuditEvents: async () => [],
      saveRunSnapshot: async (input: RunSnapshotRecordInput) => {
        snapshots.push(input);
      },
    };
    const failed: RunSnapshot = {
      ...pausedSnapshot(),
      state: "provider-error",
      lastError: {
        code: "timeout",
        message: "The provider request failed. You can retry safely.",
        provider: "anthropic",
        modelId: "author-test",
        step: "author",
        attempt: 1,
        maxAttempts: 3,
        retryable: true,
        providerRequestId: "request-1",
      },
    };

    await createStorageRunStore(storage).saveRun(failed);
    const restored = await createStorageRunStore(storage).loadRun("run-1");

    expect(restored).toEqual(failed);
    expect(snapshots[0]?.lastError).toMatchObject({ code: "timeout", retryable: true });
  });

  it("queries retrieval port and passes retrieved evidence to author and critic", async () => {
    const scoredChunk = {
      id: "chunk-1",
      workspaceId: "workspace-1",
      sourceId: "source-1",
      ordinal: 0,
      lineStart: 1,
      lineEnd: 10,
      checksum: "a".repeat(64),
      text: "TypeScript systems engineer",
      rank: -1.5,
    };
    const retrieval = {
      queryEvidence: vi.fn(async () => [scoredChunk]),
    };
    const { engine, author, critic } = engineFixture({ retrieval });

    await engine.start(request());

    expect(retrieval.queryEvidence).toHaveBeenCalled();
    expect(author).toHaveBeenCalledWith(
      expect.objectContaining({
        retrievedEvidence: [scoredChunk],
      }),
    );
    expect(critic).toHaveBeenCalledWith(
      expect.objectContaining({
        retrievedEvidence: [scoredChunk],
      }),
    );
  });
});
