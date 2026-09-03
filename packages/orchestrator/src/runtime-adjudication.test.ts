import { type ContextSnapshot, createContextSnapshot, createWorkspace } from "@draft-loop/domain";
import {
  buildIndependentReadinessReport,
  type IndependentReadinessEvaluationProjection,
} from "@draft-loop/evaluations";
import type {
  AuthorAdjudicationDecisionInput,
  DraftArtifact,
  IndependentReadinessReport,
  IndependentReadinessReportFindingInput,
  IndependentReadinessReportInputAssessment,
  IndependentReview,
} from "@draft-loop/schemas";
import { independentReadinessReportSchema, readinessDimensions } from "@draft-loop/schemas";
import type { JsonValue } from "@draft-loop/storage";
import { describe, expect, it, vi } from "vitest";

import {
  type AgentExecution,
  type AuthorRequest,
  createOrchestrationEngine,
  createStorageRunStore,
  InMemoryRunStore,
  type RequestAdjudicatedRevisionInput,
  type RunSnapshot,
  type RunStore,
} from "./index.js";

const sourceCreatedAt = "2026-08-12T10:00:00.000Z";
const reportCreatedAt = "2026-08-12T10:01:00.000Z";
const engineNow = "2026-08-12T10:07:00.000Z";
const checksum = "a".repeat(64);

function context(): ContextSnapshot {
  return createContextSnapshot({
    id: "context-1",
    workspaceId: "workspace-1",
    createdAt: sourceCreatedAt,
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

function sourceArtifact(): DraftArtifact {
  return {
    schemaVersion: 1,
    id: "artifact-1",
    version: 1,
    parentVersionId: null,
    createdAt: sourceCreatedAt,
    language: "en",
    sections: [
      {
        id: "section-summary",
        title: "Summary",
        kind: "summary",
        order: 0,
        blocks: [
          {
            id: "block-summary",
            type: "paragraph",
            text: "TypeScript engineer building reliable systems and clear technical communication.",
            claimIds: ["claim-1"],
          },
        ],
      },
      {
        id: "section-experience",
        title: "Experience",
        kind: "experience",
        order: 1,
        blocks: [
          {
            id: "block-experience",
            type: "bullet",
            text: "Delivered dependable services.",
            claimIds: ["claim-2"],
          },
        ],
      },
    ],
    claims: [
      {
        id: "claim-1",
        text: "TypeScript engineer building reliable systems and clear technical communication.",
        sectionId: "section-summary",
        blockId: "block-summary",
        substantive: true,
        status: "verified",
        evidence: [
          {
            sourcePath: "/local/candidate/resume.md",
            sourceChecksum: checksum,
            locator: "line:1-2",
            excerpt: "Built reliable systems.",
          },
        ],
      },
      {
        id: "claim-2",
        text: "Delivered dependable services.",
        sectionId: "section-experience",
        blockId: "block-experience",
        substantive: true,
        status: "verified",
        evidence: [
          {
            sourcePath: "/local/candidate/experience.md",
            sourceChecksum: checksum,
            locator: "line:3-4",
            excerpt: "Delivered dependable services.",
          },
        ],
      },
    ],
    decisions: [],
  };
}

function revisedArtifact(): DraftArtifact {
  const source = sourceArtifact();
  return {
    ...source,
    id: "artifact-2",
    version: 2,
    parentVersionId: source.id,
    createdAt: "2026-08-12T10:06:00.000Z",
    sections: source.sections.map((section) =>
      section.id === "section-summary"
        ? {
            ...section,
            blocks: section.blocks.map((block) => ({
              ...block,
              text: "TypeScript engineer building dependable local-first systems and clear technical communication.",
            })),
          }
        : section,
    ),
    claims: source.claims.map((claim) =>
      claim.id === "claim-1"
        ? {
            ...claim,
            text: "TypeScript engineer building dependable local-first systems and clear technical communication.",
          }
        : claim,
    ),
  };
}

function execution<T>(output: T, completedAt = engineNow): AgentExecution<T> {
  return {
    output,
    provider: "anthropic",
    modelId: "author-test",
    providerRequestId: "request-1",
    outputChecksum: checksum,
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
    estimatedUsd: 0.01,
    completedAt,
  };
}

function finding(
  id: string,
  target: IndependentReadinessReportFindingInput["target"],
): IndependentReadinessReportFindingInput {
  return {
    id,
    code: `code-${id}`,
    category: "quality",
    severity: "error",
    rationale: `Report rationale for ${id}.`,
    target,
    recommendedAction: `Recommended action for ${id}.`,
    confidence: 0.8,
  };
}

const independentReview: IndependentReview = {
  authorLineage: "anthropic:author-v1",
  criticLineage: "openai:critic-v1",
  lineagesDistinct: true,
  required: true,
};

const inputAssessment: IndependentReadinessReportInputAssessment = {
  status: "complete",
  missingInputs: [],
};

const evaluation: IndependentReadinessEvaluationProjection = {
  scores: readinessDimensions.map((dimension) => ({
    dimension,
    score: 0.8,
    rationale: `Score rationale for ${dimension}.`,
  })),
  thresholdResults: readinessDimensions.map((dimension) => ({
    dimension,
    score: 0.8,
    threshold: 0.7,
    meets: true,
  })),
  meetsRubric: true,
};

function report(
  findings: readonly IndependentReadinessReportFindingInput[] = [
    finding("finding-section", { kind: "section", id: "section-experience" }),
    finding("finding-claim", { kind: "claim", id: "claim-1" }),
  ],
  overrides: Partial<{
    readonly contextSnapshotId: string;
    readonly artifactId: string;
    readonly artifactVersion: number;
    readonly createdAt: string;
  }> = {},
): IndependentReadinessReport {
  return independentReadinessReportSchema.parse(
    buildIndependentReadinessReport({
      metadata: {
        contextSnapshotId: overrides.contextSnapshotId ?? "context-1",
        artifact: {
          id: overrides.artifactId ?? "artifact-1",
          version: overrides.artifactVersion ?? 1,
        },
        createdAt: overrides.createdAt ?? reportCreatedAt,
      },
      summary: "A bounded readiness report for the source artifact.",
      independentReview,
      inputAssessment,
      evaluation,
      deterministicFindings: findings,
      criticFindings: [],
    }),
  );
}

function decisions(): readonly AuthorAdjudicationDecisionInput[] {
  return [
    {
      findingId: "finding-section",
      disposition: "reject",
      rationale: "Preserve the section because the author disagrees with this finding.",
    },
    {
      findingId: "finding-claim",
      disposition: "accept",
      rationale: "Revise the claim using the cited evidence.",
    },
  ];
}

function input(overrides: Partial<RequestAdjudicatedRevisionInput> = {}) {
  return {
    report: report(),
    decisions: decisions(),
    ...overrides,
  } satisfies RequestAdjudicatedRevisionInput;
}

function runRequest() {
  return {
    runId: "run-1",
    workspace: createWorkspace("workspace-1"),
    context: context(),
    budget: { maxRounds: 3 },
  };
}

function engineFixture(
  options: {
    readonly store?: RunStore;
    readonly author?: (request: AuthorRequest) => Promise<AgentExecution<DraftArtifact>>;
    readonly now?: () => string;
  } = {},
) {
  const store = options.store ?? new InMemoryRunStore();
  const author = vi.fn(
    options.author ??
      (async (request: AuthorRequest) =>
        execution(request.round === 1 ? sourceArtifact() : revisedArtifact())),
  );
  const critic = vi.fn(async () => execution({ findings: [] }));
  const engine = createOrchestrationEngine({
    author: { execute: author },
    critic: { execute: critic },
    store,
    now: options.now ?? (() => engineNow),
  });
  return { engine, author, critic, store };
}

async function reviewed(
  options: Parameters<typeof engineFixture>[0] = {},
): Promise<Awaited<ReturnType<typeof engineFixture>>> {
  const fixture = engineFixture(options);
  const result = await fixture.engine.start(runRequest());
  expect(result.state).toBe("awaiting-approval");
  return fixture;
}

function storageFixture() {
  const values = new Map<string, string>();
  const auditEvents: Array<{
    readonly eventType: string;
    readonly entityId: string;
    readonly payload: JsonValue;
    readonly workspaceId: string;
  }> = [];
  let throwOnSnapshotProjection = false;
  const storage = {
    get: async (key: string) => values.get(key),
    set: async (key: string, value: string) => {
      values.set(key, value);
    },
    appendAuditEvent: async (event: (typeof auditEvents)[number]) => {
      auditEvents.push(event);
    },
    listAuditEvents: async (workspaceId: string) =>
      auditEvents
        .filter((event) => event.workspaceId === workspaceId)
        .map((event, index) => ({ ...event, sequence: index + 1 })),
    saveRunSnapshot: async () => {
      if (throwOnSnapshotProjection) {
        throwOnSnapshotProjection = false;
        throw new Error("synthetic snapshot projection failure");
      }
    },
  };
  return {
    storage,
    values,
    failNextSnapshotProjection: () => {
      throwOnSnapshotProjection = true;
    },
  };
}

describe("adjudicated revision runtime boundary", () => {
  it("persists the report/plan carrier, derives a trace, and keeps the event content-free", async () => {
    const fixture = await reviewed();
    const requested = await fixture.engine.requestAdjudicatedRevision("run-1", input());

    expect(requested).toMatchObject({
      state: "revising",
      round: 2,
      currentStep: "revision",
      approval: "rejected",
      adjudicationRuntime: {
        report: report(),
        trace: null,
        pendingRevisionRound: 2,
      },
    });
    expect(Object.isFrozen(requested.adjudicationRuntime)).toBe(true);
    expect(Object.isFrozen(requested.adjudicationRuntime?.plan)).toBe(true);
    expect(fixture.author.mock.calls[0]?.[0]).not.toHaveProperty("pendingAdjudication");

    const completed = await fixture.engine.resume("run-1", { context: context() });
    const revisionRequest = fixture.author.mock.calls[1]?.[0] as AuthorRequest | undefined;
    expect(revisionRequest?.pendingAdjudication).toEqual({
      report: report(),
      plan: expect.objectContaining({
        contextSnapshotId: "context-1",
        sourceArtifact: { id: "artifact-1", version: 1 },
      }),
      acceptedEffectOverrides: [],
    });
    expect(completed.state).toBe("awaiting-approval");
    expect(completed.adjudicationRuntime?.trace).toMatchObject({
      revisedArtifact: { id: "artifact-2", version: 2, parentVersionId: "artifact-1" },
      valid: true,
      effects: [
        { findingId: "finding-claim", status: "verified" },
        { findingId: "finding-section", status: "disagreement-preserved" },
      ],
    });
    expect(
      completed.executionHistory.find((execution) => execution.step === "revision"),
    ).toMatchObject({ adjudicatedRevisionTrace: completed.adjudicationRuntime?.trace });

    const event = (await fixture.engine.events("run-1")).find(
      (candidate) => candidate.type === "user.adjudicated-revision-requested",
    );
    expect(event?.details).toEqual({
      revisionKind: "adjudicated",
      findingCount: 2,
      acceptedEffectOverrideCount: 0,
    });
    expect(JSON.stringify(event)).not.toContain("Preserve the section");
    expect(JSON.stringify(event)).not.toContain("finding-claim");
  });

  it("canonicalizes accepted overrides and records an overridden effect", async () => {
    const onlyExternalFinding = finding("finding-requirement", {
      kind: "requirement",
      id: "requirement-1",
    });
    const fixture = await reviewed();
    const result = await fixture.engine.requestAdjudicatedRevision(
      "run-1",
      input({
        report: report([onlyExternalFinding]),
        decisions: [
          {
            findingId: "finding-requirement",
            disposition: "accept",
            rationale: "Accept this requirement-level change.",
          },
        ],
        acceptedEffectOverrides: [
          {
            findingId: "finding-requirement",
            rationale: "The requirement is addressed by the revised source context.",
          },
        ],
      }),
    );

    expect(result.adjudicationRuntime?.acceptedEffectOverrides).toEqual([
      {
        findingId: "finding-requirement",
        rationale: "The requirement is addressed by the revised source context.",
      },
    ]);
    const completed = await fixture.engine.resume("run-1", { context: context() });
    expect(completed.adjudicationRuntime?.trace).toMatchObject({
      valid: true,
      effects: [{ findingId: "finding-requirement", status: "overridden" }],
    });
  });

  it("records a missing accepted effect as an invalid trace without inventing success", async () => {
    const onlyExternalFinding = finding("finding-requirement", {
      kind: "requirement",
      id: "requirement-1",
    });
    const fixture = await reviewed();
    await fixture.engine.requestAdjudicatedRevision(
      "run-1",
      input({
        report: report([onlyExternalFinding]),
        decisions: [
          {
            findingId: "finding-requirement",
            disposition: "accept",
            rationale: "Accept this requirement-level change.",
          },
        ],
      }),
    );

    const completed = await fixture.engine.resume("run-1", { context: context() });
    expect(completed.adjudicationRuntime?.trace).toMatchObject({
      valid: false,
      effects: [{ findingId: "finding-requirement", status: "missing" }],
    });
  });

  it("rejects strict, stale, cross-context, and cross-artifact input without persisting state", async () => {
    const fixture = await reviewed();
    const before = await fixture.store.loadRun("run-1");
    const baseDecisions = decisions();
    const firstDecision = baseDecisions[0];
    const secondDecision = baseDecisions[1];
    if (firstDecision === undefined || secondDecision === undefined) {
      throw new Error("The decision fixture is incomplete.");
    }
    const invalidInputs: unknown[] = [
      { ...input(), unexpected: true },
      {
        ...input(),
        decisions: decisions().slice(0, 1),
      },
      {
        ...input(),
        decisions: [...baseDecisions, firstDecision],
      },
      {
        ...input(),
        decisions: [firstDecision, { ...secondDecision, findingId: "finding-unknown" }],
      },
      {
        ...input(),
        report: report([], { contextSnapshotId: "context-old" }),
        decisions: [],
      },
      {
        ...input(),
        report: report([], { artifactId: "artifact-old" }),
        decisions: [],
      },
      {
        ...input(),
        report: report([], { createdAt: "2026-08-12T10:20:00.000Z" }),
        decisions: [],
      },
      {
        ...input(),
        acceptedEffectOverrides: [{ findingId: "finding-section", rationale: "Not accepted." }],
      },
      {
        ...input(),
        acceptedEffectOverrides: [{ findingId: "finding-missing", rationale: "Unknown finding." }],
      },
      {
        ...input(),
        acceptedEffectOverrides: [
          { findingId: "finding-claim", rationale: "Duplicate." },
          { findingId: "finding-claim", rationale: "Duplicate." },
        ],
      },
    ];

    for (const candidate of invalidInputs) {
      await expect(
        fixture.engine.requestAdjudicatedRevision(
          "run-1",
          candidate as RequestAdjudicatedRevisionInput,
        ),
      ).rejects.toThrow();
      expect(await fixture.store.loadRun("run-1")).toEqual(before);
    }
  });

  it("requires a completed critic and checks budget before persisting", async () => {
    const fixture = engineFixture();
    const begun = await fixture.engine.begin(runRequest());
    await fixture.store.saveRun({
      ...begun,
      state: "awaiting-approval",
      currentStep: null,
      artifact: sourceArtifact(),
    });
    await expect(fixture.engine.requestAdjudicatedRevision("run-1", input())).rejects.toThrow(
      /completed independent critic/i,
    );
    expect((await fixture.store.loadRun("run-1"))?.adjudicationRuntime).toBeNull();

    const budgetFixture = await reviewed({
      author: async (request) =>
        execution(request.round === 1 ? sourceArtifact() : revisedArtifact()),
    });
    const budgetBefore = await budgetFixture.store.loadRun("run-1");
    await budgetFixture.store.saveRun({
      ...(budgetBefore as RunSnapshot),
      budget: { maxRounds: 1 },
    });
    const exhaustedBefore = await budgetFixture.store.loadRun("run-1");
    await expect(budgetFixture.engine.requestAdjudicatedRevision("run-1", input())).rejects.toThrow(
      /maximum round limit reached/i,
    );
    expect(await budgetFixture.store.loadRun("run-1")).toEqual(exhaustedBefore);
  });

  it("survives storage restart and reuses a completed revision without a second provider call", async () => {
    const harness = storageFixture();
    const store1 = createStorageRunStore(harness.storage);
    const first = engineFixture({ store: store1 });
    await first.engine.start(runRequest());
    await first.engine.requestAdjudicatedRevision("run-1", input());

    harness.failNextSnapshotProjection();
    await expect(first.engine.resume("run-1", { context: context() })).rejects.toThrow(
      /projection failure/i,
    );
    expect(first.author).toHaveBeenCalledTimes(2);

    const store2 = createStorageRunStore(harness.storage);
    const second = engineFixture({ store: store2 });
    const resumed = await second.engine.resume("run-1", { context: context() });

    expect(second.author).not.toHaveBeenCalled();
    expect(resumed.state).toBe("awaiting-approval");
    expect(resumed.adjudicationRuntime?.trace).toMatchObject({ valid: true });
    expect((await store2.loadRun("run-1"))?.adjudicationRuntime?.trace).toEqual(
      resumed.adjudicationRuntime?.trace,
    );
  });

  it("fails closed on invalid provider lineage and bounds retries without writing a trace", async () => {
    const fixture = await reviewed({
      author: async (request) => {
        if (request.round === 1) return execution(sourceArtifact());
        return execution({
          ...revisedArtifact(),
          parentVersionId: "wrong-parent",
        });
      },
    });
    await fixture.engine.requestAdjudicatedRevision("run-1", input());

    let failed = await fixture.engine.resume("run-1", { context: context() });
    failed = await fixture.engine.resume("run-1", { context: context() });
    failed = await fixture.engine.resume("run-1", { context: context() });
    const bounded = await fixture.engine.resume("run-1", { context: context() });

    expect(fixture.author).toHaveBeenCalledTimes(4);
    expect(failed).toMatchObject({
      state: "provider-error",
      lastError: {
        code: "invalid-response",
        failureStage: "artifact-schema-validation",
        diagnostics: [{ code: "invalid_parent", path: "revisedArtifact" }],
        retryable: false,
        attempt: 3,
      },
    });
    expect(failed.adjudicationRuntime?.trace).toBeNull();
    expect(failed.executionHistory.filter((record) => record.step === "revision")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "failed", errorCode: "invalid-response" }),
      ]),
    );
    expect(bounded).toEqual(failed);
  });

  it("fails closed on an unexpected persisted runtime field before invoking the author", async () => {
    const fixture = await reviewed();
    const requested = await fixture.engine.requestAdjudicatedRevision("run-1", input());
    await fixture.store.saveRun({
      ...requested,
      adjudicationRuntime: {
        ...(requested.adjudicationRuntime as NonNullable<RunSnapshot["adjudicationRuntime"]>),
        unexpected: true,
      } as never,
    });

    const failed = await fixture.engine.resume("run-1", { context: context() });

    expect(fixture.author).toHaveBeenCalledOnce();
    expect(failed).toMatchObject({
      state: "provider-error",
      lastError: { code: "invalid-response" },
    });
  });

  it("does not pass a completed or stale adjudication carrier to a legacy revision", async () => {
    const fixture = await reviewed();
    await fixture.engine.requestAdjudicatedRevision("run-1", input());
    await fixture.engine.resume("run-1", { context: context() });
    await fixture.engine.requestRevision("run-1");
    await fixture.engine.resume("run-1", { context: context() });

    const legacyRequest = fixture.author.mock.calls[2]?.[0] as AuthorRequest | undefined;
    expect(legacyRequest).not.toHaveProperty("pendingAdjudication");
  });
});
