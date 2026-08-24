import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ApplicationService,
  CliUserError,
  createCandidateKnowledgeStoreService,
  createLocalApplicationDriver,
  defaultLocalModelEndpoint,
  type IndependentReviewRecord,
  type WorkspaceDescriptor,
} from "@draft-loop/application";
import { describe, expect, it, vi } from "vitest";

import type { DesktopReviewState } from "../model.js";
import {
  createMemoryCredentialStore,
  createNativeHost,
  createSafeStorageCredentialStore,
  type NativeHostDialogs,
  resolveCredential,
  type SafeStorageAdapter,
} from "./host.js";

function descriptor(root: string): WorkspaceDescriptor {
  return {
    id: "workspace-native",
    root,
    jobDescriptionPath: "job.md",
    sourceDirectory: "evidence",
    language: "en",
    outputFormat: "markdown",
    requiredSections: ["Summary", "Experience"],
    maxRounds: 2,
    maxCostUsd: 0.25,
    author: { company: "anthropic", model: "claude-sonnet-4-5" },
    critic: { company: "openai", model: "gpt-5" },
    fixtureMode: true,
  };
}

function pdfWithLiteral(literal: string): string {
  return `%PDF-1.4\n1 0 obj\n<< /Length 64 >>\nstream\nBT\n(${literal}) Tj\nET\nendstream\nendobj\n%%EOF`;
}

/** What the fixture workspace's author/critic pairing records for a run. */
const recordedIndependence: IndependentReviewRecord = {
  authorLineage: "anthropic:claude-sonnet-4-5",
  criticLineage: "openai:gpt-5",
  lineagesDistinct: true,
  required: true,
};

function artifact(id = "artifact-native", version = 1) {
  return {
    schemaVersion: 1,
    id,
    version,
    parentVersionId: version === 1 ? null : "artifact-native",
    createdAt: "2026-08-12T10:00:00.000Z",
    language: "en",
    sections: [
      {
        id: "summary",
        title: "Summary",
        kind: "summary",
        order: 0,
        blocks: [
          { id: "summary-block", type: "paragraph", text: "Local draft", claimIds: ["claim-1"] },
        ],
      },
    ],
    claims: [
      {
        id: "claim-1",
        text: "Local draft",
        sectionId: "summary",
        blockId: "summary-block",
        substantive: true,
        status: "verified",
        evidence: [{ sourcePath: "evidence/resume.md", sourceChecksum: "abc", excerpt: "local" }],
      },
    ],
    decisions: [],
  };
}

function service(
  root: string,
  snapshotOverrides: Readonly<Record<string, unknown>> = {},
  /** `null` stands for a run that recorded no independence claim at all. */
  independentReview: IndependentReviewRecord | null = recordedIndependence,
) {
  const workspace = descriptor(root);
  const snapshot = {
    schemaVersion: 1,
    runId: "run-native",
    workspaceId: workspace.id,
    contextSnapshotId: "context-native",
    state: "awaiting-approval",
    round: 1,
    currentStep: null,
    budget: { maxRounds: 2, maxCostUsd: 0.25 },
    artifact: artifact(),
    findings: [
      {
        code: "unsupported-claim",
        severity: "error",
        category: "factuality",
        message: "Review the local claim.",
        claimId: "claim-1",
      },
    ],
    latestEvaluation: null,
    scoreHistory: [],
    executionHistory: [],
    totalCostUsd: 0,
    approval: "pending",
    startedAt: "2026-08-12T10:00:00.000Z",
    updatedAt: "2026-08-12T10:00:00.000Z",
    lastError: null,
    ...snapshotOverrides,
  } as never;
  return {
    service: {
      initialize: vi.fn(async () => workspace),
      readWorkspace: vi.fn(async () => workspace),
      reconfigureModels: vi.fn<ApplicationService["reconfigureModels"]>(async () => workspace),
      configureWritingPolicy: vi.fn<ApplicationService["configureWritingPolicy"]>(
        async () => workspace,
      ),
      configureKnowledgeSelection: vi.fn<ApplicationService["configureKnowledgeSelection"]>(
        async () => workspace,
      ),
      begin: vi.fn(async () => snapshot),
      start: vi.fn(async () => snapshot),
      resume: vi.fn<ApplicationService["resume"]>(async () => snapshot),
      lifecycle: vi.fn(async () => snapshot),
      status: vi.fn(async () => snapshot),
      export: vi.fn(
        async (command) => command.outputPath ?? join(root, "exports", "run-native.md"),
      ),
      latestExportPath: vi.fn(async () => null),
      queryEvidence: vi.fn(async () => []),
      inspectEvidenceRetrieval: vi.fn<ApplicationService["inspectEvidenceRetrieval"]>(async () => ({
        status: "not-indexed",
        indexedChunkCount: 0,
        selectedChunkCount: 0,
        selectedSourceCount: 0,
        hits: [],
      })),
      recordReviewDecision: vi.fn(async () => undefined),
      readIndependentReview: vi.fn<ApplicationService["readIndependentReview"]>(
        async () => independentReview ?? undefined,
      ),
    } satisfies ApplicationService,
    snapshot,
  };
}

describe("native host", () => {
  it("returns actionable content-free guidance when a bad PDF blocks a run", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-host-invalid-pdf-"));
    const root = join(parent, "invalid-pdf-workspace");
    const dialogs: NativeHostDialogs = {
      chooseDirectory: async () => parent,
      chooseFiles: async () => [],
    };
    try {
      const host = createNativeHost({ dialogs });
      const created = await host.invoke({
        type: "workspace.create",
        input: { name: "invalid-pdf-workspace", mode: "real" },
      });
      const workspaceId = (
        created as { readonly value: { readonly workspace: { readonly id: string } } }
      ).value.workspace.id;
      await writeFile(join(root, "job.md"), "TypeScript systems engineer\n", "utf8");
      await writeFile(
        join(root, "evidence", "resume.pdf"),
        pdfWithLiteral("Caf\\303\\251"),
        "utf8",
      );

      const started = await host.invoke({ type: "run.start", input: { workspaceId } });

      expect(started).toMatchObject({
        ok: false,
        error: {
          code: "operation-failed",
          capability: "run.start",
          message:
            'The source file "resume.pdf" could not be used. Try another supported text-bearing file or export.',
        },
      });
      expect(JSON.stringify(started)).not.toContain("Caf");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("keeps other application user errors behind the generic bridge boundary", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-host-user-error-"));
    const fixture = service(root);
    const privateMessage = `Workspace data was missing at ${join(root, "private-source.md")}.`;
    fixture.service.start.mockRejectedValueOnce(new CliUserError(privateMessage));
    const host = createNativeHost({
      applicationService: fixture.service,
      dialogs: { chooseDirectory: async () => root, chooseFiles: async () => [] },
    });
    try {
      await host.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });

      const started = await host.invoke({
        type: "run.start",
        input: { workspaceId: "workspace-native" },
      });

      expect(started).toEqual({
        ok: false,
        error: {
          code: "operation-failed",
          capability: "run.start",
          message: "The desktop operation could not be completed.",
        },
      });
      expect(JSON.stringify(started)).not.toContain(privateMessage);
      expect(JSON.stringify(started)).not.toContain(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("projects retrieval selection counts and fallback readiness", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-host-retrieval-readiness-"));
    const fixture = service(root);
    fixture.service.inspectEvidenceRetrieval.mockResolvedValue({
      status: "fallback",
      indexedChunkCount: 4,
      selectedChunkCount: 2,
      selectedSourceCount: 1,
      hits: [],
    });
    const host = createNativeHost({
      applicationService: fixture.service,
      dialogs: { chooseDirectory: async () => root, chooseFiles: async () => [] },
    });
    try {
      await mkdir(join(root, "evidence"), { recursive: true });
      await writeFile(join(root, "job.md"), "Senior data engineering role", "utf8");
      await writeFile(join(root, "evidence", "resume.md"), "Candidate experience", "utf8");
      await host.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });

      const loaded = await host.invoke({ type: "review.load", input: {} });

      expect(loaded).toMatchObject({
        ok: true,
        value: {
          setup: {
            retrievalStatus: "fallback",
            indexedEvidenceChunkCount: 4,
            selectedEvidenceChunkCount: 2,
            selectedEvidenceSourceCount: 1,
          },
        },
      });
      expect(fixture.service.inspectEvidenceRetrieval).toHaveBeenCalledWith({
        root,
        query: "Senior data engineering role",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns a persisted run before continuing provider execution in the background", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-host-background-"));
    let resumeSignal: AbortSignal | undefined;
    const fixture = service(root, {
      state: "drafting",
      currentStep: "author",
      artifact: null,
      findings: [],
    });
    fixture.service.resume.mockImplementationOnce(
      (command: Parameters<ApplicationService["resume"]>[0]) =>
        new Promise<never>((_, reject) => {
          resumeSignal = command.signal;
          command.signal?.addEventListener("abort", () => reject(command.signal?.reason), {
            once: true,
          });
        }),
    );
    const host = createNativeHost({
      applicationService: fixture.service,
      dialogs: { chooseDirectory: async () => root, chooseFiles: async () => [] },
    });
    try {
      await host.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });
      const dispatch = await host.invoke({
        type: "review.dispatch",
        input: {
          workspaceId: "workspace-native",
          runId: "pending",
          action: { type: "start" },
        },
      });

      expect(dispatch).toMatchObject({
        ok: true,
        value: {
          runId: "run-native",
          state: "drafting",
          execution: {
            status: "running",
            step: "author",
            provider: "anthropic",
            model: "claude-sonnet-4-5",
            attempt: 1,
          },
        },
      });
      expect(fixture.service.begin).toHaveBeenCalledOnce();
      expect(fixture.service.start).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(fixture.service.resume).toHaveBeenCalledOnce());
      const stopped = await host.invoke({
        type: "review.dispatch",
        input: {
          workspaceId: "workspace-native",
          runId: "run-native",
          action: { type: "stop" },
        },
      });
      expect(resumeSignal?.aborted).toBe(true);
      expect(fixture.service.lifecycle).toHaveBeenCalledWith(
        { root, runId: "run-native", action: "stop" },
        expect.anything(),
      );
      expect(stopped).toMatchObject({ ok: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("projects an active durable run without a worker as interrupted and resumes it once", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-host-interrupted-"));
    const fixture = service(root, { state: "revising", currentStep: "revision" });
    fixture.service.resume.mockImplementationOnce(() => new Promise(() => undefined));
    const host = createNativeHost({
      applicationService: fixture.service,
      dialogs: { chooseDirectory: async () => root, chooseFiles: async () => [] },
    });
    try {
      await host.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });
      const interrupted = await host.invoke({ type: "review.load", input: {} });
      expect(interrupted).toMatchObject({
        ok: true,
        value: { execution: { status: "interrupted", step: "revision" } },
      });

      const resumed = await host.invoke({
        type: "review.dispatch",
        input: {
          workspaceId: "workspace-native",
          runId: "run-native",
          action: { type: "resume" },
        },
      });
      expect(resumed).toMatchObject({
        ok: true,
        value: { execution: { status: "running", step: "revision" } },
      });
      await vi.waitFor(() => expect(fixture.service.resume).toHaveBeenCalledOnce());
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("projects safe provider recovery and enforces retry and stop actions", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-host-provider-error-"));
    const lastError = {
      code: "invalid-response",
      message: "The provider request failed. You can retry safely.",
      provider: "openai",
      modelId: "gpt-5",
      step: "critic",
      attempt: 2,
      maxAttempts: 3,
      retryable: true,
      retryNotBefore: undefined,
      providerRequestId: "request-safe",
      diagnostics: [{ code: "invalid_type", path: "sections.0.blocks" }],
    };
    const fixture = service(root, { state: "provider-error", currentStep: "critic", lastError });
    const host = createNativeHost({
      applicationService: fixture.service,
      dialogs: { chooseDirectory: async () => root, chooseFiles: async () => [] },
    });
    try {
      await host.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });
      const review = await host.invoke({ type: "review.load", input: {} });
      expect(review).toMatchObject({
        ok: true,
        value: {
          state: "provider-error",
          reviewComplete: false,
          execution: { status: "idle", step: null, attempt: null },
          providerFailure: {
            code: "invalid-response",
            provider: "openai",
            model: "gpt-5",
            step: "critic",
            attempt: 2,
            maxAttempts: 3,
            retryAvailable: true,
            retryNotBefore: null,
            availableActions: ["retry", "stop"],
            diagnostics: [{ code: "invalid_type", path: "sections.0.blocks" }],
          },
        },
      });
      expect(JSON.stringify(review)).not.toContain("request-safe");

      const disallowed = await host.invoke({
        type: "review.dispatch",
        input: {
          workspaceId: "workspace-native",
          runId: "run-native",
          action: { type: "approve" },
        },
      });
      const disallowedStart = await host.invoke({
        type: "review.dispatch",
        input: {
          workspaceId: "workspace-native",
          runId: "pending",
          action: { type: "start" },
        },
      });
      expect(disallowed).toMatchObject({ ok: false, error: { code: "operation-failed" } });
      expect(disallowedStart).toMatchObject({ ok: false, error: { code: "operation-failed" } });
      expect(fixture.service.start).not.toHaveBeenCalled();
      expect(fixture.service.lifecycle).not.toHaveBeenCalled();

      await host.invoke({
        type: "review.dispatch",
        input: { workspaceId: "workspace-native", runId: "run-native", action: { type: "resume" } },
      });
      await host.invoke({
        type: "review.dispatch",
        input: { workspaceId: "workspace-native", runId: "run-native", action: { type: "stop" } },
      });
      expect(fixture.service.resume).toHaveBeenCalledOnce();
      expect(fixture.service.lifecycle).toHaveBeenCalledWith(
        expect.objectContaining({ action: "stop" }),
        expect.anything(),
      );

      const exhausted = service(root, {
        state: "provider-error",
        currentStep: "critic",
        lastError: { ...lastError, attempt: 3, retryable: false },
      });
      const exhaustedHost = createNativeHost({
        applicationService: exhausted.service,
        dialogs: { chooseDirectory: async () => root, chooseFiles: async () => [] },
      });
      await exhaustedHost.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });
      const retry = await exhaustedHost.invoke({
        type: "review.dispatch",
        input: { workspaceId: "workspace-native", runId: "run-native", action: { type: "resume" } },
      });
      expect(retry).toMatchObject({ ok: false, error: { code: "operation-failed" } });
      expect(exhausted.service.resume).not.toHaveBeenCalled();

      const coolingDown = service(root, {
        state: "provider-error",
        currentStep: "critic",
        lastError: { ...lastError, retryNotBefore: "2999-01-01T00:00:00.000Z" },
      });
      const coolingDownHost = createNativeHost({
        applicationService: coolingDown.service,
        dialogs: { chooseDirectory: async () => root, chooseFiles: async () => [] },
      });
      await coolingDownHost.invoke({
        type: "workspace.open",
        input: { selection: "native-dialog" },
      });
      const earlyRetry = await coolingDownHost.invoke({
        type: "review.dispatch",
        input: { workspaceId: "workspace-native", runId: "run-native", action: { type: "resume" } },
      });
      expect(earlyRetry).toMatchObject({
        ok: false,
        error: {
          code: "operation-failed",
          message: "Retry is paused until the provider retry window opens.",
        },
      });
      expect(coolingDown.service.resume).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("projects a legacy incomplete-critic approval state as critic recovery", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-host-legacy-critic-recovery-"));
    const fixture = service(root, {
      state: "awaiting-approval",
      currentStep: null,
      lastError: {
        code: "invalid-response",
        message: "The provider request failed. You can retry safely.",
        provider: "openai",
        modelId: "gpt-5",
        step: "critic",
        attempt: 1,
        maxAttempts: 3,
        retryable: true,
        providerRequestId: null,
      },
    });
    const host = createNativeHost({
      applicationService: fixture.service,
      dialogs: { chooseDirectory: async () => root, chooseFiles: async () => [] },
    });
    try {
      await host.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });

      const review = await host.invoke({ type: "review.load", input: {} });
      expect(review).toMatchObject({
        ok: true,
        value: {
          state: "provider-error",
          reviewComplete: false,
          providerFailure: {
            step: "critic",
            retryAvailable: true,
            availableActions: ["retry", "stop"],
          },
        },
      });

      const revision = await host.invoke({
        type: "review.dispatch",
        input: {
          workspaceId: "workspace-native",
          runId: "run-native",
          action: { type: "request-revision" },
        },
      });
      expect(revision).toMatchObject({ ok: false, error: { code: "operation-failed" } });

      await host.invoke({
        type: "review.dispatch",
        input: { workspaceId: "workspace-native", runId: "run-native", action: { type: "resume" } },
      });
      expect(fixture.service.resume).toHaveBeenCalledOnce();
      expect(fixture.service.lifecycle).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: "revision" }),
        expect.anything(),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("allows local review decisions after a provider error and persists them through reload", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-host-real-provider-error-"));
    await mkdir(join(root, "evidence"), { recursive: true });
    await writeFile(join(root, "job.md"), "TypeScript systems engineer\n", "utf8");
    await writeFile(
      join(root, "evidence", "resume.md"),
      "Synthetic candidate evidence for TypeScript systems engineering.\n",
      "utf8",
    );
    const localDriver = createLocalApplicationDriver();
    const localIo = { write: () => undefined };

    try {
      const workspace = await localDriver.initialize(
        {
          root,
          jobDescription: "job.md",
          sources: "evidence",
          maxRounds: 2,
          maxCostUsd: 0.25,
          fixtureMode: true,
        },
        localIo,
      );
      const started = await localDriver.start({ root, allowProviderData: false }, localIo);
      expect(started.findings.length).toBeGreaterThan(0);
      await localDriver.lifecycle({ root, runId: started.runId, action: "revision" }, localIo);

      const configPath = join(root, ".draft-loop", "workspace.json");
      const config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
      await writeFile(
        configPath,
        `${JSON.stringify({ ...config, fixtureMode: false }, null, 2)}\n`,
      );
      const failed = await localDriver.resume(
        { root, runId: started.runId, allowProviderData: false },
        localIo,
      );
      expect(failed).toMatchObject({
        state: "provider-error",
        artifact: { version: 1 },
        lastError: { code: "policy" },
      });

      const dialogs: NativeHostDialogs = {
        chooseDirectory: async () => root,
        chooseFiles: async () => [],
      };
      const host = createNativeHost({ dialogs });
      await host.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });
      const loaded = await host.invoke({ type: "review.load", input: {} });
      expect(loaded).toMatchObject({
        ok: true,
        value: { state: "provider-error", findings: [{ decision: "pending" }] },
      });
      const loadedValue = (loaded as { readonly ok: true; readonly value: DesktopReviewState })
        .value;
      const finding = loadedValue.findings[0];
      const block = loadedValue.artifact.sections[0]?.blocks[0];
      expect(finding).toBeDefined();
      expect(block).toBeDefined();
      if (finding === undefined || block === undefined) {
        throw new Error("The deterministic fixture did not produce a finding and artifact block.");
      }

      const approve = await host.invoke({
        type: "review.dispatch",
        input: {
          workspaceId: workspace.id,
          runId: started.runId,
          action: { type: "approve" },
        },
      });
      const start = await host.invoke({
        type: "review.dispatch",
        input: {
          workspaceId: workspace.id,
          runId: "pending",
          action: { type: "start" },
        },
      });
      expect(approve).toMatchObject({ ok: false, error: { code: "operation-failed" } });
      expect(start).toMatchObject({ ok: false, error: { code: "operation-failed" } });

      const decision = await host.invoke({
        type: "review.dispatch",
        input: {
          workspaceId: workspace.id,
          runId: started.runId,
          action: {
            type: "finding-decision",
            findingId: finding.id,
            decision: "accepted",
          },
        },
      });
      expect(decision).toMatchObject({
        ok: true,
        value: { state: "provider-error", findings: [{ decision: "accepted" }] },
      });

      const editText = "Edited locally while the provider is unavailable.";
      const edit = await host.invoke({
        type: "review.dispatch",
        input: {
          workspaceId: workspace.id,
          runId: started.runId,
          action: { type: "edit-block", blockId: block.id, text: editText },
        },
      });
      expect(edit).toMatchObject({ ok: true, value: { state: "provider-error" } });

      const reloadedHost = createNativeHost({ dialogs });
      await reloadedHost.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });
      const reloaded = await reloadedHost.invoke({
        type: "review.load",
        input: { workspaceId: workspace.id, runId: started.runId },
      });
      expect(reloaded).toMatchObject({
        ok: true,
        value: {
          state: "provider-error",
          findings: [{ decision: "accepted" }],
        },
      });
      const reloadedValue = (reloaded as { readonly ok: true; readonly value: DesktopReviewState })
        .value;
      expect(reloadedValue.artifact.sections[0]?.blocks[0]).toMatchObject({
        id: block.id,
        text: editText,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("projects failed provider executions as failed events", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-host-failed-event-"));
    const fixture = service(root, {
      state: "provider-error",
      currentStep: "author",
      artifact: null,
      findings: [],
      executionHistory: [
        {
          id: "execution-failed",
          runId: "run-native",
          contextSnapshotId: "context-native",
          round: 1,
          step: "author",
          status: "failed",
          provider: "anthropic",
          modelId: "claude-sonnet-4-5",
          providerRequestId: null,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          estimatedUsd: null,
          completedAt: "2026-08-12T10:00:01.000Z",
          errorCode: "invalid-response",
          attempt: 1,
          maxAttempts: 3,
          retryable: false,
        },
      ],
      lastError: {
        code: "invalid-response",
        message: "The provider request failed. Retry is not available.",
        provider: "anthropic",
        modelId: "claude-sonnet-4-5",
        step: "author",
        attempt: 1,
        maxAttempts: 3,
        retryable: false,
        providerRequestId: null,
      },
    });
    const host = createNativeHost({
      applicationService: fixture.service,
      dialogs: { chooseDirectory: async () => root, chooseFiles: async () => [] },
    });
    try {
      await host.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });
      const review = await host.invoke({ type: "review.load", input: {} });

      expect(review).toMatchObject({
        ok: true,
        value: {
          events: expect.arrayContaining([
            expect.objectContaining({
              id: "execution-failed",
              label: "author execution failed",
              state: "provider-error",
            }),
          ]),
        },
      });
      expect(JSON.stringify(review)).not.toContain("author execution completed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("creates a real workspace without synthetic candidate or job content", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-host-real-"));
    const root = join(parent, "real-workspace");
    const fixture = service(root);
    try {
      const host = createNativeHost({
        applicationService: fixture.service,
        dialogs: {
          chooseDirectory: async () => parent,
          chooseFiles: async () => [],
        },
      });
      const created = await host.invoke({
        type: "workspace.create",
        input: { name: "real-workspace", mode: "real" },
      });
      expect(created).toMatchObject({ ok: true });
      expect(await readFile(join(root, "job.md"), "utf8")).toBe("");
      await expect(readFile(join(root, "evidence", "resume.md"), "utf8")).rejects.toThrow();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("names the configured local endpoint in the transmission preflight", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-host-local-endpoint-"));
    const fixture = service(root);
    // llama.cpp serves :8080, Ollama serves :11434. Showing the wrong one would
    // make the preflight a guess about where candidate material goes.
    const localWorkspace = {
      ...descriptor(root),
      fixtureMode: false,
      critic: { company: "local", model: "qwen3-coder-30b" },
      localEndpoint: "http://127.0.0.1:8080/v1",
    };
    fixture.service.readWorkspace.mockResolvedValue(localWorkspace);
    try {
      const host = createNativeHost({
        applicationService: fixture.service,
        dialogs: {
          chooseDirectory: async () => root,
          chooseFiles: async () => [],
        },
      });
      await host.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });

      const review = await host.invoke({
        type: "review.load",
        input: { workspaceId: localWorkspace.id, runId: "run-native" },
      });

      expect(review).toMatchObject({
        ok: true,
        value: {
          providerTransmissionPreflight: {
            author: { company: "anthropic", endpoint: "https://api.anthropic.com/v1/messages" },
            critic: { company: "local", endpoint: "http://127.0.0.1:8080/v1" },
          },
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to the adapter default endpoint when a local workspace configures none", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-host-local-default-"));
    const fixture = service(root);
    const localWorkspace = {
      ...descriptor(root),
      fixtureMode: false,
      critic: { company: "local", model: "qwen3-coder-30b" },
    };
    fixture.service.readWorkspace.mockResolvedValue(localWorkspace);
    try {
      const host = createNativeHost({
        applicationService: fixture.service,
        dialogs: {
          chooseDirectory: async () => root,
          chooseFiles: async () => [],
        },
      });
      await host.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });

      const review = await host.invoke({
        type: "review.load",
        input: { workspaceId: localWorkspace.id, runId: "run-native" },
      });

      expect(review).toMatchObject({
        ok: true,
        value: {
          providerTransmissionPreflight: {
            critic: { company: "local", endpoint: defaultLocalModelEndpoint },
          },
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("names each transport and conservatively uses provider-default retention in mixed mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-host-user-session-preflight-"));
    const fixture = service(root);
    const liveWorkspace = { ...descriptor(root), fixtureMode: false };
    fixture.service.readWorkspace.mockResolvedValue(liveWorkspace);
    try {
      const host = createNativeHost({
        applicationService: fixture.service,
        providerAuthModeConfiguration: { anthropic: "api-key", openai: "user-session" },
        dialogs: {
          chooseDirectory: async () => root,
          chooseFiles: async () => [],
        },
      });
      await host.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });

      const review = await host.invoke({
        type: "review.load",
        input: { workspaceId: liveWorkspace.id, runId: "run-native" },
      });

      expect(review).toMatchObject({
        ok: true,
        value: {
          providerExposure: { requestedRetention: "provider-default" },
          providerTransmissionPreflight: {
            retentionPreference: "provider-default",
            author: { endpoint: "https://api.anthropic.com/v1/messages" },
            critic: { endpoint: "local Codex runtime → OpenAI subscription" },
          },
        },
      });
      const fingerprint = (review as { readonly value: DesktopReviewState }).value
        .providerTransmissionPreflight.fingerprint;
      const acknowledged = await host.invoke({
        type: "review.dispatch",
        input: {
          workspaceId: liveWorkspace.id,
          runId: "pending",
          action: { type: "acknowledge-provider-transmission", fingerprint },
        },
      });
      expect(acknowledged).toMatchObject({
        ok: true,
        value: { providerTransmissionPreflight: { acknowledged: true } },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed until the current live provider policy is acknowledged and persists safe metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-host-exposure-"));
    const fixture = service(root);
    const liveWorkspace = { ...descriptor(root), fixtureMode: false };
    fixture.service.readWorkspace.mockResolvedValue(liveWorkspace);
    try {
      const host = createNativeHost({
        applicationService: fixture.service,
        dialogs: {
          chooseDirectory: async () => root,
          chooseFiles: async () => [],
        },
      });
      await host.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });

      const review = await host.invoke({
        type: "review.load",
        input: { workspaceId: liveWorkspace.id, runId: "run-native" },
      });

      expect(review).toMatchObject({
        ok: true,
        value: {
          providerExposure: { transmissionAllowed: false },
          providerTransmissionPreflight: {
            required: true,
            acknowledged: false,
            author: { endpoint: "https://api.anthropic.com/v1/messages" },
            critic: { endpoint: "https://api.openai.com/v1/responses" },
            excludedScope: ["complete candidate corpus"],
          },
        },
      });
      const fingerprint = (review as { readonly value: DesktopReviewState }).value
        .providerTransmissionPreflight.fingerprint;

      const denied = await host.invoke({
        type: "review.dispatch",
        input: {
          workspaceId: liveWorkspace.id,
          runId: "pending",
          action: { type: "start" },
        },
      });
      expect(denied).toMatchObject({ ok: false, error: { code: "operation-failed" } });
      expect(fixture.service.start).not.toHaveBeenCalled();

      const staleAcknowledgement = await host.invoke({
        type: "review.dispatch",
        input: {
          workspaceId: liveWorkspace.id,
          runId: "pending",
          action: {
            type: "acknowledge-provider-transmission",
            fingerprint: "0".repeat(64),
          },
        },
      });
      expect(staleAcknowledgement).toMatchObject({
        ok: false,
        error: { code: "operation-failed" },
      });

      const acknowledged = await host.invoke({
        type: "review.dispatch",
        input: {
          workspaceId: liveWorkspace.id,
          runId: "pending",
          action: { type: "acknowledge-provider-transmission", fingerprint },
        },
      });
      expect(acknowledged).toMatchObject({
        ok: true,
        value: {
          providerExposure: { transmissionAllowed: true },
          providerTransmissionPreflight: { acknowledged: true },
          events: expect.arrayContaining([
            expect.objectContaining({ label: "Provider transmission policy acknowledged" }),
          ]),
        },
      });

      const persisted = JSON.parse(
        await readFile(
          join(root, ".draft-loop", "provider-transmission-acknowledgement.json"),
          "utf8",
        ),
      ) as Record<string, unknown>;
      expect(Object.keys(persisted).sort()).toEqual([
        "acknowledgedAt",
        "fingerprint",
        "policy",
        "schemaVersion",
      ]);
      expect(JSON.stringify(persisted)).not.toContain("Local draft");
      expect(JSON.stringify(persisted)).not.toContain("API_KEY");

      const started = await host.invoke({
        type: "review.dispatch",
        input: {
          workspaceId: liveWorkspace.id,
          runId: "pending",
          action: { type: "start" },
        },
      });
      expect(started).toMatchObject({ ok: true });
      expect(fixture.service.begin).toHaveBeenCalledWith(
        { root, allowProviderData: true },
        expect.anything(),
      );
      await vi.waitFor(() => expect(fixture.service.resume).toHaveBeenCalledOnce());
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("restores acknowledgement after restart and invalidates it when workspace policy changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-host-preflight-restart-"));
    const fixture = service(root);
    let liveWorkspace = { ...descriptor(root), fixtureMode: false };
    fixture.service.readWorkspace.mockImplementation(async () => liveWorkspace);
    const dialogs: NativeHostDialogs = {
      chooseDirectory: async () => root,
      chooseFiles: async () => [],
    };
    try {
      const firstHost = createNativeHost({ applicationService: fixture.service, dialogs });
      await firstHost.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });
      const initial = await firstHost.invoke({ type: "review.load", input: {} });
      const initialFingerprint = (initial as { readonly value: DesktopReviewState }).value
        .providerTransmissionPreflight.fingerprint;
      await firstHost.invoke({
        type: "review.dispatch",
        input: {
          workspaceId: liveWorkspace.id,
          runId: "run-native",
          action: {
            type: "acknowledge-provider-transmission",
            fingerprint: initialFingerprint,
          },
        },
      });

      const restarted = createNativeHost({ applicationService: fixture.service, dialogs });
      await restarted.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });
      const restored = await restarted.invoke({ type: "review.load", input: {} });
      expect(restored).toMatchObject({
        ok: true,
        value: {
          providerExposure: { transmissionAllowed: true },
          providerTransmissionPreflight: {
            fingerprint: initialFingerprint,
            acknowledged: true,
          },
        },
      });

      liveWorkspace = { ...liveWorkspace, maxRounds: 3 };
      const staleStart = await restarted.invoke({
        type: "review.dispatch",
        input: {
          workspaceId: liveWorkspace.id,
          runId: "run-native",
          action: { type: "resume" },
        },
      });
      expect(staleStart).toMatchObject({ ok: false, error: { code: "operation-failed" } });
      expect(fixture.service.resume).not.toHaveBeenCalled();

      const refreshed = await restarted.invoke({ type: "review.load", input: {} });
      expect(refreshed).toMatchObject({
        ok: true,
        value: {
          providerExposure: { transmissionAllowed: false },
          providerTransmissionPreflight: {
            acknowledged: false,
            budget: { maxRounds: 3 },
          },
        },
      });
      expect(
        (refreshed as { readonly value: DesktopReviewState }).value.providerTransmissionPreflight
          .fingerprint,
      ).not.toBe(initialFingerprint);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fetches an approved URL into local evidence with provenance only", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-host-url-"));
    const root = join(parent, "url-workspace");
    const fixture = service(root);
    try {
      const host = createNativeHost({
        applicationService: fixture.service,
        dialogs: {
          chooseDirectory: async () => parent,
          chooseFiles: async () => [],
        },
        urlHostnameResolver: async () => ["93.184.216.34"],
        urlFetcher: async () =>
          new Response("Public project evidence", {
            headers: { "content-type": "text/plain" },
          }),
      });
      const created = await host.invoke({
        type: "workspace.create",
        input: { name: "url-workspace", mode: "real" },
      });
      const workspaceId = (
        created as { readonly value: { readonly workspace: { readonly id: string } } }
      ).value.workspace.id;
      const added = await host.invoke({
        type: "source.add-url",
        input: {
          workspaceId,
          url: "https://example.com/projects/draft-loop",
          target: "evidence",
          approved: true,
        },
      });
      expect(added).toMatchObject({
        ok: true,
        value: {
          originalUrl: "https://example.com/projects/draft-loop",
          kind: "portfolio",
          extractionStatus: "generic-fallback",
          mediaType: "text/plain",
        },
      });
      const provenance = await readFile(
        join(root, ".draft-loop", "source-provenance.json"),
        "utf8",
      );
      expect(provenance).toContain("https://example.com/projects/draft-loop");
      expect(provenance).toContain('"role": "evidence"');
      expect(provenance).toContain('"extractedFactCount": "0"');
      const files = await readdir(join(root, "evidence", "imported"));
      expect(files).toHaveLength(1);
      expect(await readFile(join(root, "evidence", "imported", files[0] ?? ""), "utf8")).toBe(
        "Public project evidence\n",
      );
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("keeps workspace selection native and persists review decisions locally", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-host-"));
    const root = join(parent, "native-workspace");
    const externalEvidence = join(parent, "resume.md");
    await writeFile(externalEvidence, "local evidence", "utf8");
    const fixture = service(root);
    const dialogs = {
      chooseDirectory: vi.fn(async (mode: "open" | "create") =>
        mode === "create" ? parent : root,
      ),
      chooseFiles: vi.fn(async () => [externalEvidence]),
    };

    try {
      const host = createNativeHost({ dialogs, applicationService: fixture.service });
      const created = await host.invoke({
        type: "workspace.create",
        input: { name: "native-workspace" },
      });
      expect(created).toEqual({
        ok: true,
        value: { workspace: { id: "workspace-native", name: "native-workspace" } },
      });

      const started = await host.invoke({
        type: "run.start",
        input: { workspaceId: "workspace-native" },
      });
      expect(started).toMatchObject({
        ok: true,
        value: { runId: "run-native", state: "awaiting-approval" },
      });

      const selected = await host.invoke({
        type: "file.select",
        input: { workspaceId: "workspace-native", extensions: [".md"], multiple: false },
      });
      expect(selected).toMatchObject({
        ok: true,
        value: {
          files: [{ relativePath: "evidence/imported/resume.md", mediaType: "text/markdown" }],
        },
      });

      const review = await host.invoke({
        type: "review.load",
        input: { workspaceId: "workspace-native", runId: "run-native" },
      });
      expect(review).toMatchObject({
        ok: true,
        value: {
          findings: [{ decision: "pending" }],
          providerExposure: {
            transmissionAllowed: false,
            requestedRetention: "not-allowed",
          },
          providerTransmissionPreflight: {
            required: false,
            acknowledged: true,
            dataClass: "synthetic-demo-material",
            retentionPreference: "not-allowed",
          },
        },
      });
      const findingId = (
        review as { readonly value: { readonly findings: readonly [{ readonly id: string }] } }
      ).value.findings[0].id;
      const decisionResult = await host.invoke({
        type: "review.dispatch",
        input: {
          workspaceId: "workspace-native",
          runId: "run-native",
          action: {
            type: "finding-decision",
            findingId,
            decision: "overridden",
            rationale: "The user verified this claim outside the fixture.",
          },
        },
      });
      expect(decisionResult).toMatchObject({ ok: true });
      expect(fixture.service.recordReviewDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "finding",
          targetId: findingId,
          decision: "overridden",
        }),
      );

      const restarted = createNativeHost({ dialogs, applicationService: fixture.service });
      await restarted.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });
      const reloaded = await restarted.invoke({
        type: "review.load",
        input: { workspaceId: "workspace-native", runId: "run-native" },
      });
      expect(reloaded).toMatchObject({
        ok: true,
        value: {
          findings: [{ decision: "overridden" }],
          events: expect.arrayContaining([
            expect.objectContaining({ label: "Finding decision recorded: overridden" }),
          ]),
        },
      });
      expect(await readFile(join(root, ".draft-loop", "review-overrides.json"), "utf8")).toContain(
        "overridden",
      );

      const revisedFixture = service(root, {
        round: 2,
        artifact: artifact("artifact-revised", 2),
      });
      const revisedHost = createNativeHost({
        dialogs,
        applicationService: revisedFixture.service,
      });
      await revisedHost.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });
      const revised = await revisedHost.invoke({
        type: "review.load",
        input: { workspaceId: "workspace-native", runId: "run-native" },
      });
      expect(revised).toMatchObject({
        ok: true,
        value: { findings: [{ decision: "pending" }] },
      });
      expect((revised as { readonly value: DesktopReviewState }).value.findings[0]?.id).not.toBe(
        findingId,
      );
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("refuses native approval after a blocking finding is accepted without revision", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-host-accepted-blocker-"));
    const fixture = service(root);
    const dialogs = {
      chooseDirectory: vi.fn(async () => root),
      chooseFiles: vi.fn(async () => []),
    };

    try {
      const host = createNativeHost({ dialogs, applicationService: fixture.service });
      await host.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });
      const review = await host.invoke({
        type: "review.load",
        input: { workspaceId: "workspace-native", runId: "run-native" },
      });
      const findingId = (review as { readonly value: DesktopReviewState }).value.findings[0]?.id;
      if (findingId === undefined) throw new Error("finding fixture is missing");

      const accepted = await host.invoke({
        type: "review.dispatch",
        input: {
          workspaceId: "workspace-native",
          runId: "run-native",
          action: { type: "finding-decision", findingId, decision: "accepted" },
        },
      });
      expect(accepted).toMatchObject({
        ok: true,
        value: { findings: [{ decision: "accepted" }] },
      });

      const approval = await host.invoke({
        type: "review.dispatch",
        input: {
          workspaceId: "workspace-native",
          runId: "run-native",
          action: { type: "approve" },
        },
      });
      expect(approval).toMatchObject({
        ok: false,
        error: {
          code: "operation-failed",
          message: "Resolve, reject, or override blocking findings before approval.",
        },
      });
      expect(fixture.service.lifecycle).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("routes explicit round-limit recovery through the application lifecycle", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-host-round-limit-recovery-"));
    const previousCritique = {
      id: "run-native:2:critic:attempt:1",
      runId: "run-native",
      contextSnapshotId: "context-native",
      round: 2,
      step: "critic",
      status: "completed",
      output: { findings: [] },
      provider: "openai",
      modelId: "gpt-5",
      providerRequestId: null,
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      estimatedUsd: null,
      completedAt: "2026-08-12T10:00:00.000Z",
    } as const;
    const fixture = service(root, {
      state: "awaiting-approval",
      round: 3,
      budget: { maxRounds: 2 },
      executionHistory: [previousCritique],
    });
    try {
      const host = createNativeHost({
        applicationService: fixture.service,
        dialogs: { chooseDirectory: async () => root, chooseFiles: async () => [] },
      });
      await host.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });

      const result = await host.invoke({
        type: "review.dispatch",
        input: {
          workspaceId: "workspace-native",
          runId: "run-native",
          action: { type: "recover-round-limit" },
        },
      });

      expect(result).toMatchObject({ ok: true });
      expect(fixture.service.lifecycle).toHaveBeenCalledWith(
        { root, runId: "run-native", action: "recover-round-budget" },
        expect.anything(),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("carries the run's recorded independence, rationale included, into the review state", async () => {
    // The approval surface must read what the run recorded, not recompute it:
    // two vendors serving one lineage would otherwise be reported independent.
    const root = await mkdtemp(join(tmpdir(), "draft-loop-host-independence-"));
    const rationale = "One lineage on both sides: a deliberate self-review experiment.";
    const fixture = service(
      root,
      {},
      {
        authorLineage: "gpt-oss-20b",
        criticLineage: "gpt-oss-20b",
        lineagesDistinct: false,
        required: true,
        overrideRationale: rationale,
      },
    );
    try {
      const host = createNativeHost({
        applicationService: fixture.service,
        dialogs: { chooseDirectory: async () => root, chooseFiles: async () => [] },
      });
      await host.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });

      const loaded = await host.invoke({
        type: "review.load",
        input: { workspaceId: "workspace-native", runId: "run-native" },
      });

      expect(loaded).toMatchObject({
        ok: true,
        value: {
          providerExposure: {
            independentReview: {
              authorLineage: "gpt-oss-20b",
              criticLineage: "gpt-oss-20b",
              lineagesDistinct: false,
              required: true,
              overrideRationale: rationale,
            },
          },
        },
      });
      expect(fixture.service.readIndependentReview).toHaveBeenCalledWith({
        root,
        runId: "run-native",
      });

      const dispatched = await host.invoke({
        type: "review.dispatch",
        input: {
          workspaceId: "workspace-native",
          runId: "run-native",
          action: { type: "pause" },
        },
      });

      expect(dispatched).toMatchObject({
        ok: true,
        value: { providerExposure: { independentReview: { overrideRationale: rationale } } },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports no recorded independence rather than failing the review view", async () => {
    // A run started before independence was recorded, and a read that fails
    // outright, both mean "nothing recorded". Neither is "not independent",
    // and neither may cost the reader the rest of the review.
    const root = await mkdtemp(join(tmpdir(), "draft-loop-host-no-independence-"));
    const fixture = service(root, {}, null);
    const errors: unknown[] = [];
    try {
      const host = createNativeHost({
        applicationService: fixture.service,
        dialogs: { chooseDirectory: async () => root, chooseFiles: async () => [] },
        onError: (error) => errors.push(error),
      });
      await host.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });

      const loaded = await host.invoke({
        type: "review.load",
        input: { workspaceId: "workspace-native", runId: "run-native" },
      });

      expect(loaded).toMatchObject({
        ok: true,
        value: {
          runId: "run-native",
          providerExposure: { independentReview: null, transmissionAllowed: false },
        },
      });
      expect(errors).toEqual([]);

      fixture.service.readIndependentReview.mockRejectedValueOnce(
        new Error("The run context snapshot is missing."),
      );
      const afterFailure = await host.invoke({
        type: "review.load",
        input: { workspaceId: "workspace-native", runId: "run-native" },
      });

      expect(afterFailure).toMatchObject({
        ok: true,
        value: { runId: "run-native", providerExposure: { independentReview: null } },
      });
      expect(errors).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects bridge commands that would escape the export boundary", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-host-export-"));
    const fixture = service(root);
    try {
      const host = createNativeHost({
        applicationService: fixture.service,
        dialogs: {
          chooseDirectory: async () => root,
          chooseFiles: async () => [],
        },
      });
      await host.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });
      const result = await host.invoke({
        type: "export.write",
        input: {
          workspaceId: "workspace-native",
          runId: "run-native",
          format: "markdown",
          relativePath: "../outside.md",
        },
      });
      expect(result).toMatchObject({ ok: false, error: { code: "invalid-input" } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("forwards a validated custom export path through the application contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-host-export-path-"));
    const fixture = service(root);
    try {
      const host = createNativeHost({
        applicationService: fixture.service,
        dialogs: {
          chooseDirectory: async () => root,
          chooseFiles: async () => [],
        },
      });
      await host.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });

      const result = await host.invoke({
        type: "export.write",
        input: {
          workspaceId: "workspace-native",
          runId: "run-native",
          format: "markdown",
          relativePath: "exports/custom.md",
        },
      });

      expect(result).toMatchObject({ ok: true });
      expect(fixture.service.export).toHaveBeenCalledWith(
        expect.objectContaining({ outputPath: join(root, "exports", "custom.md") }),
        expect.anything(),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("chooses a Markdown Save As path before exporting an approved run", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-host-save-as-"));
    const customPath = join(root, "exports", "custom.md");
    const fixture = service(root, { state: "approved", approval: "approved" });
    const chooseMarkdownExportPath = vi.fn(async (defaultPath: string) => {
      expect(defaultPath).toBe(join(root, "exports", "run-native.md"));
      return customPath;
    });
    try {
      const host = createNativeHost({
        applicationService: fixture.service,
        dialogs: {
          chooseDirectory: async () => root,
          chooseFiles: async () => [],
          chooseMarkdownExportPath,
        },
      });
      await host.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });

      const result = await host.invoke({
        type: "review.dispatch",
        input: {
          workspaceId: "workspace-native",
          runId: "run-native",
          action: { type: "export" },
        },
      });

      expect(result).toMatchObject({
        ok: true,
        value: { state: "approved", approval: "approved", exportPath: customPath },
      });
      expect(chooseMarkdownExportPath).toHaveBeenCalledOnce();
      expect(fixture.service.export).toHaveBeenCalledWith(
        {
          root,
          runId: "run-native",
          format: "markdown",
          outputPath: customPath,
        },
        expect.anything(),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps approval intact and skips export when Markdown Save As is cancelled", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-host-save-as-cancel-"));
    const fixture = service(root, { state: "approved", approval: "approved" });
    try {
      const host = createNativeHost({
        applicationService: fixture.service,
        dialogs: {
          chooseDirectory: async () => root,
          chooseFiles: async () => [],
          chooseMarkdownExportPath: async () => undefined,
        },
      });
      await host.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });

      const result = await host.invoke({
        type: "review.dispatch",
        input: {
          workspaceId: "workspace-native",
          runId: "run-native",
          action: { type: "export" },
        },
      });

      expect(result).toMatchObject({
        ok: true,
        value: { state: "approved", approval: "approved", exportPath: null },
      });
      expect(fixture.service.export).not.toHaveBeenCalled();
      expect(fixture.service.lifecycle).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("runs the real local driver through approval, export, and restart", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-host-alpha-"));
    const root = join(parent, "alpha-workspace");
    const customExportPath = join(parent, "selected-export.md");
    let selectedDefaultPath: string | undefined;
    const dialogs = {
      chooseDirectory: vi.fn(async (mode: "open" | "create") =>
        mode === "create" ? parent : root,
      ),
      chooseFiles: vi.fn(async () => []),
      chooseMarkdownExportPath: vi.fn(async (defaultPath: string) => {
        selectedDefaultPath = defaultPath;
        return customExportPath;
      }),
    };

    try {
      const host = createNativeHost({ dialogs });
      const created = await host.invoke({
        type: "workspace.create",
        input: { name: "alpha-workspace" },
      });
      expect(created).toMatchObject({ ok: true, value: { workspace: { id: expect.any(String) } } });
      const workspaceId = (
        created as { readonly value: { readonly workspace: { readonly id: string } } }
      ).value.workspace.id;

      const started = await host.invoke({ type: "run.start", input: { workspaceId } });
      expect(started).toMatchObject({ ok: true, value: { state: "awaiting-approval" } });
      const review = await host.invoke({ type: "review.load", input: { workspaceId } });
      const reviewValue = (review as { readonly value: DesktopReviewState }).value;
      expect(reviewValue.findings).toHaveLength(1);
      expect(reviewValue.reviewComplete).toBe(true);
      const persistedDecision = await host.invoke({
        type: "review.dispatch",
        input: {
          workspaceId,
          runId: reviewValue.runId,
          action: {
            type: "finding-decision",
            findingId: reviewValue.findings[0]?.id ?? "missing",
            decision: "overridden",
            rationale: "The user verified this claim outside the fixture.",
          },
        },
      });
      expect(persistedDecision).toMatchObject({ ok: true });
      const approved = await host.invoke({
        type: "review.dispatch",
        input: {
          workspaceId,
          runId: reviewValue.runId,
          action: { type: "approve" },
        },
      });
      expect(approved).toMatchObject({
        ok: true,
        value: { approval: "approved", state: "approved" },
      });
      const exported = await host.invoke({
        type: "review.dispatch",
        input: {
          workspaceId,
          runId: reviewValue.runId,
          action: { type: "export" },
        },
      });
      expect(exported).toMatchObject({
        ok: true,
        value: { approval: "approved", state: "exported" },
      });
      expect(selectedDefaultPath).toBe(join(root, "exports", `${reviewValue.runId}.md`));
      expect((exported as { readonly value: DesktopReviewState }).value.exportPath).toBe(
        customExportPath,
      );
      expect(await readFile(join(root, ".draft-loop", "review-overrides.json"), "utf8")).toContain(
        "overridden",
      );

      const restarted = createNativeHost({ dialogs });
      await restarted.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });
      const recovered = await restarted.invoke({
        type: "review.load",
        input: { workspaceId, runId: reviewValue.runId },
      });
      expect((recovered as { readonly value: DesktopReviewState }).value.findings[0]?.id).toBe(
        reviewValue.findings[0]?.id,
      );
      expect(recovered).toMatchObject({
        ok: true,
        value: {
          approval: "approved",
          findings: [{ decision: "overridden" }],
        },
      });
      expect(await readFile(customExportPath, "utf8")).toContain("candidate-provided materials");
      expect((recovered as { readonly value: DesktopReviewState }).value.exportPath).toBe(
        customExportPath,
      );
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("extracts and normalizes job description file imports with matching markdown metadata", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-job-select-"));
    const jobSource = join(parent, "Senior_Role.txt");
    await writeFile(jobSource, "Senior Data Engineer with distributed systems experience.", "utf8");

    try {
      const dialogs: NativeHostDialogs = {
        chooseDirectory: async () => parent,
        chooseFiles: async () => [jobSource],
      };
      const host = createNativeHost({ dialogs });
      const created = await host.invoke({
        type: "workspace.create",
        input: { name: "job-import-test" },
      });
      expect(created).toMatchObject({ ok: true, value: { workspace: { id: expect.any(String) } } });
      const workspaceId = (
        created as { readonly value: { readonly workspace: { readonly id: string } } }
      ).value.workspace.id;

      const selected = await host.invoke({
        type: "file.select",
        input: {
          workspaceId,
          target: "job-description",
          multiple: false,
        },
      });

      expect(selected).toEqual({
        ok: true,
        value: {
          files: [
            expect.objectContaining({
              name: "job.md",
              relativePath: "job.md",
              mediaType: "text/markdown",
            }),
          ],
        },
      });

      const loaded = await host.invoke({
        type: "review.load",
        input: { workspaceId },
      });
      expect(loaded).toMatchObject({
        ok: true,
        value: {
          setup: expect.objectContaining({
            jobDescriptionReady: true,
          }),
        },
      });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("imports an explicitly selected writing policy outside candidate evidence", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-policy-select-"));
    const policySource = join(parent, "AGENTS.md");
    await writeFile(policySource, "Use ASCII punctuation and preserve exact metrics.", "utf8");

    try {
      const dialogs: NativeHostDialogs = {
        chooseDirectory: async () => parent,
        chooseFiles: async () => [policySource],
      };
      const host = createNativeHost({ dialogs });
      const created = await host.invoke({
        type: "workspace.create",
        input: { name: "policy-import-test", mode: "real" },
      });
      const workspaceId = (
        created as { readonly value: { readonly workspace: { readonly id: string } } }
      ).value.workspace.id;

      const selected = await host.invoke({
        type: "file.select",
        input: { workspaceId, target: "writing-policy", multiple: false, extensions: [".md"] },
      });

      expect(selected).toMatchObject({
        ok: true,
        value: {
          files: [
            {
              name: "writing-policy.md",
              relativePath: ".draft-loop/writing-policy.md",
              mediaType: "text/markdown",
            },
          ],
        },
      });
      const workspaceRoot = join(parent, "policy-import-test");
      await expect(
        readFile(join(workspaceRoot, ".draft-loop", "writing-policy.md"), "utf8"),
      ).resolves.toBe("Use ASCII punctuation and preserve exact metrics.\n");
      expect(await readdir(join(workspaceRoot, "evidence"))).toEqual([]);

      const loaded = await host.invoke({ type: "review.load", input: { workspaceId } });
      expect(loaded).toMatchObject({
        ok: true,
        value: {
          setup: {
            evidenceSourceCount: 0,
            writingPolicy: {
              version: expect.stringMatching(/^sha256:[a-f0-9]{12}$/u),
              checksum: expect.stringMatching(/^[a-f0-9]{64}$/u),
              preview: "Use ASCII punctuation and preserve exact metrics.",
            },
          },
          providerTransmissionPreflight: {
            transmissionScope: expect.arrayContaining([
              "candidate-approved writing policy when configured",
            ]),
          },
        },
      });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  describe("credential storage and environment fallback", () => {
    it("stores encrypted credentials, reports source precedence, and removes them", async () => {
      const parent = await mkdtemp(join(tmpdir(), "draft-loop-creds-"));
      const credFile = join(parent, "credentials.json");

      const mockSafeStorage: SafeStorageAdapter = {
        isEncryptionAvailable: () => true,
        encryptString: (plain: string) => Buffer.from(`enc:${plain}`),
        decryptString: (enc: Buffer) => enc.toString().replace(/^enc:/, ""),
      };

      try {
        const store = createSafeStorageCredentialStore({
          safeStorage: mockSafeStorage,
          filename: credFile,
        });

        // Initially unconfigured
        expect(await store.status("anthropic")).toEqual({
          configured: false,
          source: "none",
          protection: "none",
        });

        // Set in-app key
        const setOk = await store.set("anthropic", "sk-ant-test-key");
        expect(setOk).toBe(true);

        // Status shows configured in app
        expect(await store.status("anthropic")).toEqual({
          configured: true,
          source: "app",
          protection: "os-backed",
        });
        expect(await store.get?.("anthropic")).toBe("sk-ant-test-key");

        // Verify stored file is encrypted
        const rawContent = await readFile(credFile, "utf8");
        expect(rawContent).not.toContain("sk-ant-test-key");

        // Remove key
        const removeOk = await store.remove("anthropic");
        expect(removeOk).toBe(true);
        expect(await store.status("anthropic")).toEqual({
          configured: false,
          source: "none",
          protection: "none",
        });
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    });

    it("falls back to environment variables when in-app credential is not set", async () => {
      const parent = await mkdtemp(join(tmpdir(), "draft-loop-creds-env-"));
      const credFile = join(parent, "credentials.json");

      const mockSafeStorage: SafeStorageAdapter = {
        isEncryptionAvailable: () => true,
        encryptString: (plain: string) => Buffer.from(`enc:${plain}`),
        decryptString: (enc: Buffer) => enc.toString().replace(/^enc:/, ""),
      };

      const originalEnv = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = "sk-ant-from-env";

      try {
        const store = createSafeStorageCredentialStore({
          safeStorage: mockSafeStorage,
          filename: credFile,
        });

        // Status reports configured via env
        expect(await store.status("anthropic")).toEqual({
          configured: true,
          source: "env",
          protection: "environment",
        });

        // Setting in-app key overrides status to app
        await store.set("anthropic", "sk-ant-app-override");
        expect(await store.status("anthropic")).toEqual({
          configured: true,
          source: "app",
          protection: "os-backed",
        });
        expect(await store.get?.("anthropic")).toBe("sk-ant-app-override");

        // Removing in-app key reverts status to env
        await store.remove("anthropic");
        expect(await store.status("anthropic")).toEqual({
          configured: true,
          source: "env",
          protection: "environment",
        });
      } finally {
        if (originalEnv === undefined) {
          delete process.env.ANTHROPIC_API_KEY;
        } else {
          process.env.ANTHROPIC_API_KEY = originalEnv;
        }
        await rm(parent, { recursive: true, force: true });
      }
    });

    it("uses app precedence without mutating the environment and removes cleanly", async () => {
      const original = process.env.ANTHROPIC_API_KEY;
      const environmentValue = `environment-${crypto.randomUUID()}`;
      const appValue = `app-${crypto.randomUUID()}`;
      process.env.ANTHROPIC_API_KEY = environmentValue;
      const store = createMemoryCredentialStore();
      try {
        await store.set("anthropic", appValue);
        expect(await resolveCredential(store, "anthropic")).toBe(appValue);
        expect(process.env.ANTHROPIC_API_KEY).toBe(environmentValue);
        await store.remove("anthropic");
        expect(await resolveCredential(store, "anthropic")).toBe(environmentValue);
        expect(process.env.ANTHROPIC_API_KEY).toBe(environmentValue);
      } finally {
        if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
        else process.env.ANTHROPIC_API_KEY = original;
      }
    });

    it("discloses Electron basic_text as weak Linux protection", async () => {
      const parent = await mkdtemp(join(tmpdir(), "draft-loop-creds-basic-text-"));
      const store = createSafeStorageCredentialStore({
        filename: join(parent, "credentials.json"),
        safeStorage: {
          isEncryptionAvailable: () => true,
          getSelectedStorageBackend: () => "basic_text",
          encryptString: (plain) => Buffer.from(plain),
          decryptString: (encrypted) => encrypted.toString("utf8"),
        },
      });
      try {
        await store.set("anthropic", `synthetic-${crypto.randomUUID()}`);
        expect(await store.status("anthropic")).toEqual({
          configured: true,
          source: "app",
          protection: "basic-text",
        });
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    });

    it("falls back to local AES-256-GCM encryption when OS safeStorage is unavailable", async () => {
      const parent = await mkdtemp(join(tmpdir(), "draft-loop-creds-fallback-"));
      const credFile = join(parent, "credentials.json");

      const unavailableSafeStorage: SafeStorageAdapter = {
        isEncryptionAvailable: () => false,
        encryptString: () => {
          throw new Error("safeStorage unavailable");
        },
        decryptString: () => {
          throw new Error("safeStorage unavailable");
        },
      };

      try {
        const store = createSafeStorageCredentialStore({
          safeStorage: unavailableSafeStorage,
          filename: credFile,
        });

        // Initially unconfigured
        expect(await store.status("anthropic")).toEqual({
          configured: false,
          source: "none",
          protection: "none",
        });
        expect(await store.status("openai")).toEqual({
          configured: false,
          source: "none",
          protection: "none",
        });

        // Set in-app keys under fallback encryption
        expect(await store.set("anthropic", "sk-ant-fallback-key-123")).toBe(true);
        expect(await store.set("openai", "sk-proj-fallback-key-456")).toBe(true);

        // Status shows configured in app
        expect(await store.status("anthropic")).toEqual({
          configured: true,
          source: "app",
          protection: "local-aes-gcm",
        });
        expect(await store.status("openai")).toEqual({
          configured: true,
          source: "app",
          protection: "local-aes-gcm",
        });
        expect(await store.get?.("anthropic")).toBe("sk-ant-fallback-key-123");
        expect(await store.get?.("openai")).toBe("sk-proj-fallback-key-456");

        // Verify stored file is encrypted on disk and does not leak plaintext keys
        const rawContent = await readFile(credFile, "utf8");
        expect(rawContent).not.toContain("sk-ant-fallback-key-123");
        expect(rawContent).not.toContain("sk-proj-fallback-key-456");
        expect(rawContent).toContain("v1:aes-gcm:");

        // Reopening store reloads and decrypts keys accurately
        const reopenedStore = createSafeStorageCredentialStore({
          safeStorage: unavailableSafeStorage,
          filename: credFile,
        });
        expect(await reopenedStore.status("anthropic")).toEqual({
          configured: true,
          source: "app",
          protection: "local-aes-gcm",
        });
        expect(await reopenedStore.get?.("anthropic")).toBe("sk-ant-fallback-key-123");

        // Remove key
        expect(await store.remove("anthropic")).toBe(true);
        expect(await store.status("anthropic")).toEqual({
          configured: false,
          source: "none",
          protection: "none",
        });
        expect(await store.status("openai")).toEqual({
          configured: true,
          source: "app",
          protection: "local-aes-gcm",
        });
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    });

    it("handles credential bridge commands via native host", async () => {
      const creds = createMemoryCredentialStore();
      const host = createNativeHost({
        dialogs: {
          chooseDirectory: async () => undefined,
          chooseFiles: async () => [],
        },
        credentials: creds,
      });

      const setResult = await host.invoke({
        type: "credential.set",
        input: { provider: "openai", apiKey: "sk-proj-test123" },
      });
      expect(setResult).toEqual({
        ok: true,
        value: {
          provider: "openai",
          configured: true,
          source: "app",
          protection: "session-memory",
        },
      });

      const statusResult = await host.invoke({
        type: "credential.status",
        input: { provider: "openai" },
      });
      expect(statusResult).toEqual({
        ok: true,
        value: {
          provider: "openai",
          configured: true,
          source: "app",
          protection: "session-memory",
        },
      });

      const removeResult = await host.invoke({
        type: "credential.remove",
        input: { provider: "openai" },
      });
      expect(removeResult).toEqual({
        ok: true,
        value: {
          provider: "openai",
          configured: false,
          source: "none",
          protection: "none",
        },
      });
    });

    it("reports provider-managed user sessions without reading the API-key store", async () => {
      const status = vi.fn(async () => {
        throw new Error("API-key status must not be read in user-session mode.");
      });
      const host = createNativeHost({
        dialogs: {
          chooseDirectory: async () => undefined,
          chooseFiles: async () => [],
        },
        providerAuthMode: "user-session",
        credentials: {
          status,
          set: async () => false,
          remove: async () => false,
          get: async () => {
            throw new Error("API keys must not be read in user-session mode.");
          },
        },
        userSessionProbes: {
          anthropic: async () => ({ available: true, authenticated: true }),
          openai: async () => ({ available: true, authenticated: false }),
        },
      });

      await expect(
        host.invoke({ type: "credential.status", input: { provider: "anthropic" } }),
      ).resolves.toEqual({
        ok: true,
        value: {
          provider: "anthropic",
          configured: true,
          source: "user-session",
          protection: "provider-managed-session",
        },
      });
      await expect(
        host.invoke({ type: "credential.status", input: { provider: "openai" } }),
      ).resolves.toMatchObject({ ok: true, value: { configured: false } });
      expect(status).not.toHaveBeenCalled();
    });
  });
  describe("model discovery", () => {
    /** A transport that answers from memory. No test here reaches a socket. */
    function catalogueFetch(body: unknown, status = 200) {
      return vi.fn(
        async (_url: string, _init: RequestInit) =>
          ({
            ok: status >= 200 && status < 300,
            status,
            headers: new Headers(),
            text: async () => JSON.stringify(body),
          }) as unknown as Response,
      );
    }

    /** The headers one discovery call carried, so a test can see the credential
     * reaching the provider and nowhere else. */
    function sentHeaders(
      discoveryFetch: ReturnType<typeof catalogueFetch>,
      index: number,
    ): Record<string, string> {
      const call = discoveryFetch.mock.calls.at(index);
      return (call?.[1].headers ?? {}) as Record<string, string>;
    }

    function hostWith(
      discoveryFetch: ReturnType<typeof catalogueFetch>,
      extras: {
        readonly credentials?: ReturnType<typeof createMemoryCredentialStore>;
        readonly applicationService?: ApplicationService;
        readonly root?: string;
        readonly now?: () => number;
      } = {},
    ) {
      return createNativeHost({
        dialogs: {
          chooseDirectory: async () => extras.root,
          chooseFiles: async () => [],
        },
        ...(extras.credentials === undefined ? {} : { credentials: extras.credentials }),
        ...(extras.applicationService === undefined
          ? {}
          : { applicationService: extras.applicationService }),
        modelDiscovery: {
          fetch: discoveryFetch as unknown as typeof fetch,
          ...(extras.now === undefined ? {} : { now: extras.now }),
        },
      });
    }

    /** A workspace whose local company points wherever the test says. */
    function localWorkspaceService(root: string, localEndpoint: string): ApplicationService {
      const fixture = service(root);
      const workspace = { ...descriptor(root), localEndpoint };
      return {
        ...fixture.service,
        initialize: vi.fn(async () => workspace),
        readWorkspace: vi.fn(async () => workspace),
      };
    }

    it("lists the models a configured credential can reach without exposing it", async () => {
      const apiKey = "sk-ant-super-secret-value";
      const credentials = createMemoryCredentialStore();
      await credentials.set("anthropic", apiKey);
      const discoveryFetch = catalogueFetch({
        data: [{ id: "claude-sonnet-4-5" }, { id: "claude-haiku-4-5" }],
        has_more: false,
      });
      const host = hostWith(discoveryFetch, { credentials, now: () => 1_760_000_000_000 });

      const result = await host.invoke({ type: "models.list", input: { provider: "anthropic" } });

      expect(result).toEqual({
        ok: true,
        value: {
          provider: "anthropic",
          models: [{ id: "claude-sonnet-4-5" }, { id: "claude-haiku-4-5" }],
          truncated: false,
          source: "live",
          retrievedAt: "2025-10-09T08:53:20.000Z",
        },
      });
      expect(JSON.stringify(result)).not.toContain(apiKey);
      expect(sentHeaders(discoveryFetch, 0)["x-api-key"]).toBe(apiKey);
    });

    it("refuses to list a provider that has no credential, without calling out", async () => {
      vi.stubEnv("OPENAI_API_KEY", "");
      try {
        const discoveryFetch = catalogueFetch({ data: [] });
        const host = hostWith(discoveryFetch, { credentials: createMemoryCredentialStore() });

        const result = await host.invoke({ type: "models.list", input: { provider: "openai" } });

        expect(result).toMatchObject({
          ok: false,
          error: {
            code: "permission-denied",
            capability: "models.list",
            message:
              "No API key is configured for this provider. Add one before listing its models.",
          },
        });
        expect(discoveryFetch).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("asks the local server the open workspace actually points at", async () => {
      const root = await mkdtemp(join(tmpdir(), "draft-loop-host-local-models-"));
      const discoveryFetch = catalogueFetch({ data: [{ id: "llama3.2:3b" }] });
      const host = hostWith(discoveryFetch, {
        root,
        applicationService: localWorkspaceService(root, "http://127.0.0.1:8080/v1"),
      });
      try {
        await host.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });

        const result = await host.invoke({ type: "models.list", input: { provider: "local" } });

        expect(result).toMatchObject({
          ok: true,
          value: { provider: "local", models: [{ id: "llama3.2:3b" }] },
        });
        expect(discoveryFetch.mock.calls[0]?.[0]).toBe("http://127.0.0.1:8080/v1/models");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it("refuses a local endpoint that is not on this machine before contacting it", async () => {
      const root = await mkdtemp(join(tmpdir(), "draft-loop-host-remote-local-"));
      const discoveryFetch = catalogueFetch({ data: [{ id: "llama3.2:3b" }] });
      const host = hostWith(discoveryFetch, {
        root,
        applicationService: localWorkspaceService(root, "https://models.evil.test/v1"),
      });
      try {
        await host.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });

        const result = await host.invoke({ type: "models.list", input: { provider: "local" } });

        expect(result).toMatchObject({
          ok: false,
          error: {
            code: "permission-denied",
            capability: "models.list",
            message:
              "The configured local model endpoint is not on this machine, so it was not contacted.",
          },
        });
        expect(discoveryFetch).not.toHaveBeenCalled();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it("answers a repeat request from cache and re-asks once it expires", async () => {
      const credentials = createMemoryCredentialStore();
      await credentials.set("openai", "sk-openai-secret");
      const discoveryFetch = catalogueFetch({ data: [{ id: "gpt-5" }] });
      let clock = 1_760_000_000_000;
      const host = hostWith(discoveryFetch, { credentials, now: () => clock });

      const first = await host.invoke({ type: "models.list", input: { provider: "openai" } });
      const cached = await host.invoke({ type: "models.list", input: { provider: "openai" } });

      expect(first).toMatchObject({ ok: true, value: { source: "live" } });
      expect(cached).toMatchObject({
        ok: true,
        value: {
          source: "cache",
          models: [{ id: "gpt-5" }],
          retrievedAt: "2025-10-09T08:53:20.000Z",
        },
      });
      expect(discoveryFetch).toHaveBeenCalledTimes(1);

      const refreshed = await host.invoke({
        type: "models.list",
        input: { provider: "openai", refresh: true },
      });
      expect(refreshed).toMatchObject({ ok: true, value: { source: "live" } });
      expect(discoveryFetch).toHaveBeenCalledTimes(2);

      clock += 5 * 60_000 + 1;
      const afterExpiry = await host.invoke({ type: "models.list", input: { provider: "openai" } });
      expect(afterExpiry).toMatchObject({ ok: true, value: { source: "live" } });
      expect(discoveryFetch).toHaveBeenCalledTimes(3);
    });

    it("forgets a cached catalogue when the credential behind it changes", async () => {
      const credentials = createMemoryCredentialStore();
      await credentials.set("openai", "sk-openai-first");
      const discoveryFetch = catalogueFetch({ data: [{ id: "gpt-5" }] });
      const host = hostWith(discoveryFetch, { credentials });

      await host.invoke({ type: "models.list", input: { provider: "openai" } });
      await host.invoke({
        type: "credential.set",
        input: { provider: "openai", apiKey: "sk-openai-second" },
      });
      const afterChange = await host.invoke({ type: "models.list", input: { provider: "openai" } });

      expect(afterChange).toMatchObject({ ok: true, value: { source: "live" } });
      expect(discoveryFetch).toHaveBeenCalledTimes(2);
      expect(sentHeaders(discoveryFetch, 1).authorization).toBe("Bearer sk-openai-second");
    });

    it("drops model ids the workspace could never accept", async () => {
      const credentials = createMemoryCredentialStore();
      await credentials.set("anthropic", "sk-ant-secret");
      const discoveryFetch = catalogueFetch({
        data: [
          { id: "claude-sonnet-4-5" },
          { id: "../../etc/passwd" },
          { id: "x".repeat(500) },
          { id: { nested: "object" } },
        ],
      });
      const host = hostWith(discoveryFetch, { credentials });

      const result = await host.invoke({ type: "models.list", input: { provider: "anthropic" } });

      expect(result).toMatchObject({
        ok: true,
        value: { models: [{ id: "claude-sonnet-4-5" }] },
      });
    });

    it("explains a rejected credential without repeating what the provider said", async () => {
      const credentials = createMemoryCredentialStore();
      await credentials.set("anthropic", "sk-ant-stale");
      const discoveryFetch = catalogueFetch(
        { error: { message: "invalid x-api-key sk-ant-stale" } },
        401,
      );
      const host = hostWith(discoveryFetch, { credentials });

      const result = await host.invoke({ type: "models.list", input: { provider: "anthropic" } });

      expect(result).toEqual({
        ok: false,
        error: {
          code: "permission-denied",
          capability: "models.list",
          message: "The provider could not authenticate. Check the configured credential.",
        },
      });
      expect(JSON.stringify(result)).not.toContain("sk-ant-stale");
    });

    it("reports a provider that answered with something other than a model list", async () => {
      const credentials = createMemoryCredentialStore();
      await credentials.set("anthropic", "sk-ant-secret");
      const host = hostWith(catalogueFetch({ data: "everything" }), { credentials });

      const result = await host.invoke({ type: "models.list", input: { provider: "anthropic" } });

      expect(result).toEqual({
        ok: false,
        error: {
          code: "operation-failed",
          capability: "models.list",
          message: "The provider returned a response that could not be validated.",
        },
      });
    });
  });

  describe("model configuration", () => {
    /**
     * A host that cannot reach anything.
     *
     * Every dialog and every credential read throws, so a command that touches
     * the machine fails loudly instead of quietly passing.
     */
    function inertHost() {
      const dialogs: NativeHostDialogs = {
        chooseDirectory: async () => {
          throw new Error("no dialog should open");
        },
        chooseFiles: async () => {
          throw new Error("no dialog should open");
        },
      };
      return createNativeHost({
        dialogs,
        credentials: {
          status: async () => {
            throw new Error("no credential should be read");
          },
          set: async () => {
            throw new Error("no credential should be written");
          },
          remove: async () => {
            throw new Error("no credential should be removed");
          },
        },
      });
    }

    async function preview(
      author: { company: string; modelId: string; lineage?: string },
      critic: { company: string; modelId: string; lineage?: string },
    ) {
      const result = await inertHost().invoke({
        type: "models.preview-independence",
        input: { author, critic },
      });
      expect(result).toMatchObject({ ok: true });
      return (
        result as {
          readonly value: {
            readonly authorLineage: string;
            readonly criticLineage: string;
            readonly lineagesDistinct: boolean;
          };
        }
      ).value;
    }

    it("carries every configured model field into workspace initialization", async () => {
      const parent = await mkdtemp(join(tmpdir(), "draft-loop-host-model-config-"));
      const root = join(parent, "configured-workspace");
      const fixture = service(root);
      try {
        const host = createNativeHost({
          applicationService: fixture.service,
          dialogs: { chooseDirectory: async () => parent, chooseFiles: async () => [] },
        });

        const created = await host.invoke({
          type: "workspace.create",
          input: {
            name: "configured-workspace",
            mode: "real",
            authorCompany: "local",
            authorModel: "qwen3-coder-30b",
            criticCompany: "anthropic",
            criticModel: "claude-sonnet-4-5",
            authorLineage: "qwen3 base",
            criticLineage: "claude sonnet 4.5",
            localEndpoint: "http://127.0.0.1:11434/v1",
            independenceOverrideRationale: "Both sides were checked against a held-out set.",
            requiredSections: ["Summary", "Experience"],
            maxRounds: 6,
          },
        });

        expect(created).toMatchObject({ ok: true });
        expect(fixture.service.initialize).toHaveBeenCalledWith(
          expect.objectContaining({
            root,
            authorCompany: "local",
            authorModel: "qwen3-coder-30b",
            criticCompany: "anthropic",
            criticModel: "claude-sonnet-4-5",
            authorLineage: "qwen3 base",
            criticLineage: "claude sonnet 4.5",
            localEndpoint: "http://127.0.0.1:11434/v1",
            independenceOverrideRationale: "Both sides were checked against a held-out set.",
            requiredSections: ["Summary", "Experience"],
            maxRounds: 6,
          }),
          expect.anything(),
        );
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    });

    it("leaves a workspace default alone when the desktop names no model", async () => {
      const parent = await mkdtemp(join(tmpdir(), "draft-loop-host-model-default-"));
      const root = join(parent, "default-workspace");
      const fixture = service(root);
      try {
        const host = createNativeHost({
          applicationService: fixture.service,
          dialogs: { chooseDirectory: async () => parent, chooseFiles: async () => [] },
        });

        await host.invoke({ type: "workspace.create", input: { name: "default-workspace" } });

        for (const key of [
          "authorCompany",
          "authorModel",
          "criticCompany",
          "criticModel",
          "authorLineage",
          "criticLineage",
          "localEndpoint",
          "independenceOverrideRationale",
        ]) {
          expect(fixture.service.initialize).toHaveBeenCalledWith(
            expect.not.objectContaining({ [key]: expect.anything() }),
            expect.anything(),
          );
        }
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    });

    it("refuses a model choice the workspace could not honour before creating anything", async () => {
      const parent = await mkdtemp(join(tmpdir(), "draft-loop-host-model-refused-"));
      const fixture = service(join(parent, "refused-workspace"));
      const chooseDirectory = vi.fn(async () => parent);
      try {
        const host = createNativeHost({
          applicationService: fixture.service,
          dialogs: { chooseDirectory, chooseFiles: async () => [] },
        });

        for (const input of [
          { name: "refused-workspace", authorCompany: "bedrock" },
          { name: "refused-workspace", localEndpoint: "http://10.0.0.4:11434/v1" },
          { name: "refused-workspace", authorLineage: "x".repeat(201) },
          { name: "refused-workspace", independenceOverrideRationale: "  " },
        ]) {
          expect(await host.invoke({ type: "workspace.create", input })).toEqual({
            ok: false,
            error: {
              code: "invalid-input",
              message: "The desktop command input is invalid.",
            },
          });
        }

        expect(chooseDirectory).not.toHaveBeenCalled();
        expect(fixture.service.initialize).not.toHaveBeenCalled();
        expect(await readdir(parent)).toEqual([]);
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    });

    it("resolves a resold route and a direct one to one lineage", async () => {
      expect(
        await preview(
          { company: "anthropic", modelId: "claude-sonnet-4-5" },
          { company: "bedrock", modelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0" },
        ),
      ).toEqual({
        authorLineage: "anthropic:claude-sonnet-4-5",
        criticLineage: "anthropic:claude-sonnet-4-5",
        lineagesDistinct: false,
      });
    });

    it("reports a genuinely different pairing as distinct", async () => {
      expect(
        await preview(
          { company: "anthropic", modelId: "claude-sonnet-4-5" },
          { company: "openai", modelId: "gpt-5.6-luna" },
        ),
      ).toEqual({
        authorLineage: "anthropic:claude-sonnet-4-5",
        criticLineage: "openai:gpt-5.6-luna",
        lineagesDistinct: true,
      });

      expect(
        await preview(
          { company: "local", modelId: "qwen3-coder-30b" },
          { company: "anthropic", modelId: "claude-sonnet-4-5" },
        ),
      ).toMatchObject({ authorLineage: "local:qwen3-coder-30b", lineagesDistinct: true });
    });

    it("lets a declared lineage overrule what the pairing would derive", async () => {
      expect(
        await preview(
          { company: "anthropic", modelId: "claude-sonnet-4-5" },
          {
            company: "bedrock",
            modelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
            lineage: " Fine-Tuned  Sonnet ",
          },
        ),
      ).toEqual({
        authorLineage: "anthropic:claude-sonnet-4-5",
        criticLineage: "fine-tuned sonnet",
        lineagesDistinct: true,
      });

      expect(
        await preview(
          { company: "anthropic", modelId: "claude-sonnet-4-5", lineage: "house weights" },
          { company: "openai", modelId: "gpt-5.6-luna", lineage: "house weights" },
        ),
      ).toEqual({
        authorLineage: "house weights",
        criticLineage: "house weights",
        lineagesDistinct: false,
      });
    });
  });
});

describe("candidate knowledge native controls", () => {
  it("creates, reopens, lists, inspects, and selects stores without returning paths", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-knowledge-host-"));
    const workspaceRoot = join(parent, "workspace");
    const storeRoot = join(parent, "candidate-knowledge");
    try {
      const knowledgeService = createCandidateKnowledgeStoreService();
      const selectedKnowledgeFiles: string[] = [];
      const createHost = createNativeHost({
        knowledgeService,
        dialogs: {
          chooseDirectory: async () => parent,
          chooseFiles: async () => [],
          chooseKnowledgeSourceFile: async () => selectedKnowledgeFiles.shift(),
        },
      });
      const workspace = await createHost.invoke({
        type: "workspace.create",
        input: { name: "workspace", mode: "real" },
      });
      if (!workspace.ok) throw new Error("Expected workspace creation to succeed.");
      const workspaceId = (workspace.value as { workspace: { id: string } }).workspace.id;
      const created = await createHost.invoke({
        type: "knowledge.create",
        input: { name: "candidate-knowledge", displayName: "My evidence" },
      });
      expect(created).toMatchObject({
        ok: true,
        value: {
          knowledgeBases: [{ displayName: "My evidence", state: "active", isDefault: true }],
        },
      });
      expect(JSON.stringify(created)).not.toContain(parent);

      if (!created.ok) throw new Error("Expected candidate knowledge store creation to succeed.");
      const storeId = (created.value as { storeId: string }).storeId;
      const knowledgeBaseId = (created.value as { knowledgeBases: readonly { id: string }[] })
        .knowledgeBases[0]?.id;
      if (knowledgeBaseId === undefined) throw new Error("Expected a default knowledge base.");
      const sourcePath = join(parent, "resume.md");
      await writeFile(sourcePath, "Local candidate evidence.\n", "utf8");
      selectedKnowledgeFiles.push(sourcePath);
      const imported = await createHost.invoke({
        type: "knowledge.import-file",
        input: {
          storeId,
          knowledgeBaseId,
          selection: "native-dialog",
          displayName: "Career history",
        },
      });
      expect(imported).toMatchObject({
        ok: true,
        value: {
          storeId,
          knowledgeBaseId,
          kind: "file",
          version: 1,
          created: true,
        },
      });
      expect(JSON.stringify(imported)).not.toContain(parent);
      expect(JSON.stringify(imported)).not.toContain("resume.md");
      expect(JSON.stringify(imported)).not.toContain("Career history");

      await expect(
        createHost.invoke({ type: "knowledge.list", input: { storeId } }),
      ).resolves.toMatchObject({ ok: true, value: { storeId } });
      await expect(
        createHost.invoke({
          type: "knowledge.readiness",
          input: { storeId, knowledgeBaseId },
        }),
      ).resolves.toMatchObject({
        ok: true,
        value: { storeId, sourceCount: 1, readyCount: 1, blockedCount: 0 },
      });

      const duplicatePath = join(parent, "duplicate-resume.md");
      await writeFile(duplicatePath, "Local candidate evidence.\n", "utf8");
      await knowledgeService.importKnowledgeSourceFile({
        storeRoot,
        knowledgeBaseId,
        sourcePath: duplicatePath,
      });
      const sources = await createHost.invoke({
        type: "knowledge.sources",
        input: { storeId, knowledgeBaseId },
      });
      expect(sources).toMatchObject({
        ok: true,
        value: {
          storeId,
          knowledgeBaseId,
          sourceCount: 2,
          sources: [
            { kind: "file", versionCount: 1 },
            { kind: "file", versionCount: 1 },
          ],
          truncated: false,
        },
      });
      const duplicates = await createHost.invoke({
        type: "knowledge.duplicates",
        input: { storeId, knowledgeBaseId },
      });
      expect(duplicates).toMatchObject({
        ok: true,
        value: {
          storeId,
          knowledgeBaseId,
          groupCount: 1,
          groups: [{ memberCount: 2, members: [{}, {}], truncated: false }],
          truncated: false,
        },
      });
      const inventory = await createHost.invoke({
        type: "knowledge.inventory",
        input: { storeId },
      });
      expect(inventory).toMatchObject({
        ok: true,
        value: {
          storeId,
          schemaVersion: 1,
          verifiedManagedFileCount: 2,
          complete: true,
          scanLimitReached: false,
        },
      });
      expect(JSON.stringify({ sources, duplicates, inventory })).not.toContain(parent);
      expect(JSON.stringify({ sources, duplicates, inventory })).not.toContain("resume.md");
      await expect(
        createHost.invoke({
          type: "knowledge.import-file",
          input: { storeId, knowledgeBaseId, selection: "native-dialog" },
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "permission-denied" } });
      await expect(
        createHost.invoke({ type: "knowledge.sources", input: { storeId, knowledgeBaseId } }),
      ).resolves.toMatchObject({ ok: true, value: { sourceCount: 2 } });
      const unavailableSourcePath = join(parent, "missing-private-source.md");
      selectedKnowledgeFiles.push(unavailableSourcePath);
      const failedImport = await createHost.invoke({
        type: "knowledge.import-file",
        input: { storeId, knowledgeBaseId, selection: "native-dialog" },
      });
      expect(failedImport).toMatchObject({ ok: false, error: { code: "operation-failed" } });
      expect(JSON.stringify(failedImport)).not.toContain(parent);
      expect(JSON.stringify(failedImport)).not.toContain("missing-private-source.md");
      await expect(
        createHost.invoke({
          type: "knowledge.select",
          input: { workspaceId, entries: [{ storeId, knowledgeBaseId }] },
        }),
      ).resolves.toEqual({
        ok: true,
        value: { workspaceId, entries: [{ storeId, knowledgeBaseId }] },
      });

      const additional = await createHost.invoke({
        type: "knowledge.create-base",
        input: {
          storeId,
          displayName: "Public projects",
          description: "Selected public work",
        },
      });
      if (!additional.ok) throw new Error("Expected additional CKB creation to succeed.");
      const additionalId = (
        additional.value as {
          knowledgeBases: readonly { id: string; isDefault: boolean }[];
        }
      ).knowledgeBases.find((base) => !base.isDefault)?.id;
      if (additionalId === undefined) throw new Error("Expected an additional knowledge base.");
      await expect(
        createHost.invoke({
          type: "knowledge.rename-base",
          input: { storeId, knowledgeBaseId: additionalId, displayName: "Open-source work" },
        }),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          storeId,
          knowledgeBases: [
            { isDefault: true },
            { id: additionalId, displayName: "Open-source work" },
          ],
        },
      });
      await expect(
        createHost.invoke({
          type: "knowledge.archive-base",
          input: { storeId, knowledgeBaseId: additionalId, confirmed: false },
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "permission-denied" } });
      const archived = await createHost.invoke({
        type: "knowledge.archive-base",
        input: { storeId, knowledgeBaseId: additionalId, confirmed: true },
      });
      expect(archived).toMatchObject({
        ok: true,
        value: {
          storeId,
          knowledgeBases: [{ isDefault: true }, { id: additionalId, state: "archived" }],
        },
      });
      expect(JSON.stringify(archived)).not.toContain(parent);
      await expect(
        createHost.invoke({
          type: "knowledge.archive-base",
          input: { storeId, knowledgeBaseId, confirmed: true },
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });

      const reopenRoots = [workspaceRoot, storeRoot];
      const chooseKnowledgeSourceFile = vi.fn(async () => sourcePath);
      const restartedHost = createNativeHost({
        dialogs: {
          chooseDirectory: async () => reopenRoots.shift(),
          chooseFiles: async () => [],
          chooseKnowledgeSourceFile,
        },
      });
      await expect(
        restartedHost.invoke({ type: "workspace.open", input: { selection: "native-dialog" } }),
      ).resolves.toMatchObject({ ok: true, value: { workspace: { id: workspaceId } } });
      await expect(
        restartedHost.invoke({
          type: "knowledge.select",
          input: { workspaceId, entries: [{ storeId, knowledgeBaseId }] },
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "not-found" } });
      await expect(
        restartedHost.invoke({
          type: "knowledge.sources",
          input: { storeId, knowledgeBaseId },
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "not-found" } });
      await expect(
        restartedHost.invoke({
          type: "knowledge.import-file",
          input: { storeId, knowledgeBaseId, selection: "native-dialog" },
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "not-found" } });
      expect(chooseKnowledgeSourceFile).not.toHaveBeenCalled();
      const reopened = await restartedHost.invoke({
        type: "knowledge.open",
        input: { selection: "native-dialog" },
      });
      expect(reopened).toMatchObject({ ok: true, value: { storeId } });
      expect(JSON.stringify(reopened)).not.toContain(storeRoot);
      await expect(
        restartedHost.invoke({
          type: "knowledge.import-file",
          input: { storeId, knowledgeBaseId, selection: "native-dialog" },
        }),
      ).resolves.toMatchObject({ ok: true, value: { storeId, knowledgeBaseId, kind: "file" } });
      expect(chooseKnowledgeSourceFile).toHaveBeenCalledOnce();
      await expect(
        restartedHost.invoke({
          type: "knowledge.select",
          input: { workspaceId, entries: [{ storeId, knowledgeBaseId }] },
        }),
      ).resolves.toMatchObject({ ok: true, value: { workspaceId } });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("reports native-dialog cancellation without calling the knowledge service", async () => {
    const knowledgeService = {
      initializeStore: vi.fn(),
      openStore: vi.fn(),
    };
    const host = createNativeHost({
      dialogs: { chooseDirectory: async () => undefined, chooseFiles: async () => [] },
      knowledgeService: knowledgeService as never,
    });

    await expect(
      host.invoke({ type: "knowledge.open", input: { selection: "native-dialog" } }),
    ).resolves.toMatchObject({ ok: false, error: { code: "permission-denied" } });
    expect(knowledgeService.openStore).not.toHaveBeenCalled();
  });

  it("exports and inspects a portable CKB backup without crossing renderer paths", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-knowledge-backup-host-"));
    const destination = join(parent, "portable-backup");
    const selectedDirectories: Array<string | undefined> = [parent, parent, destination];
    const chooseDirectory = vi.fn(async () => selectedDirectories.shift());
    try {
      const host = createNativeHost({
        dialogs: { chooseDirectory, chooseFiles: async () => [] },
      });
      const created = await host.invoke({
        type: "knowledge.create",
        input: { name: "candidate-knowledge" },
      });
      if (!created.ok) throw new Error("Expected candidate knowledge store creation to succeed.");
      const storeId = (created.value as { storeId: string }).storeId;

      const exported = await host.invoke({
        type: "knowledge.backup-export",
        input: {
          storeId,
          selection: "native-dialog",
          name: "portable-backup",
          approved: true,
        },
      });
      expect(exported).toMatchObject({
        ok: true,
        value: {
          status: "exported",
          storeId,
          integrity: "integrity-verified-not-authenticity",
        },
      });
      expect(JSON.stringify(exported)).not.toContain(parent);

      const inspected = await host.invoke({
        type: "knowledge.backup-inspect",
        input: { selection: "native-dialog" },
      });
      expect(inspected).toMatchObject({
        ok: true,
        value: {
          status: "valid",
          storeId,
          integrity: "integrity-verified-not-authenticity",
        },
      });
      expect(JSON.stringify(inspected)).not.toContain(destination);
      expect(chooseDirectory).toHaveBeenCalledTimes(3);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("imports one selected candidate-knowledge directory without exposing its paths", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-knowledge-directory-host-"));
    const directoryPath = join(parent, "private-career-directory");
    const reboundDirectoryPath = join(parent, "relocated-private-career-directory");
    await mkdir(directoryPath);
    await mkdir(reboundDirectoryPath);
    await writeFile(join(directoryPath, "career.md"), "Private career evidence.\n", "utf8");
    await writeFile(join(directoryPath, "projects.txt"), "Private project evidence.\n", "utf8");
    await writeFile(join(reboundDirectoryPath, "career.md"), "Private career evidence.\n", "utf8");
    await writeFile(
      join(reboundDirectoryPath, "projects.txt"),
      "Private project evidence.\n",
      "utf8",
    );
    try {
      const selectedDirectories: Array<string | undefined> = [
        directoryPath,
        undefined,
        reboundDirectoryPath,
        reboundDirectoryPath,
        reboundDirectoryPath,
      ];
      const chooseKnowledgeSourceDirectory = vi.fn(async () => selectedDirectories.shift());
      const host = createNativeHost({
        dialogs: {
          chooseDirectory: async () => parent,
          chooseFiles: async () => [],
          chooseKnowledgeSourceDirectory,
        },
      });
      const created = await host.invoke({
        type: "knowledge.create",
        input: { name: "candidate-knowledge", displayName: "My evidence" },
      });
      if (!created.ok) throw new Error("Expected candidate knowledge store creation to succeed.");
      const storeId = (created.value as { storeId: string }).storeId;
      const knowledgeBaseId = (created.value as { knowledgeBases: readonly { id: string }[] })
        .knowledgeBases[0]?.id;
      if (knowledgeBaseId === undefined) throw new Error("Expected a default knowledge base.");

      const imported = await host.invoke({
        type: "knowledge.import-directory",
        input: { storeId, knowledgeBaseId, selection: "native-dialog" },
      });
      expect(imported).toMatchObject({
        ok: true,
        value: {
          storeId,
          knowledgeBaseId,
          status: "complete",
          scannedEntryCount: 2,
          discoveredFileCount: 2,
          skippedEntryCount: 0,
          sourceCount: 2,
          sources: [
            { version: 1, created: true },
            { version: 1, created: true },
          ],
          sourcesTruncated: false,
        },
      });
      expect(JSON.stringify(imported)).not.toContain(parent);
      expect(JSON.stringify(imported)).not.toContain("career.md");
      expect(JSON.stringify(imported)).not.toContain("projects.txt");
      expect(JSON.stringify(imported)).not.toContain("Private career evidence");
      if (!imported.ok) throw new Error("Expected directory intake to succeed.");
      const directoryId = (imported.value as { directoryId: string }).directoryId;

      await expect(
        host.invoke({
          type: "knowledge.import-directory",
          input: { storeId, knowledgeBaseId, selection: "native-dialog" },
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "permission-denied" } });
      expect(chooseKnowledgeSourceDirectory).toHaveBeenCalledTimes(2);

      const rebindInput = {
        storeId,
        knowledgeBaseId,
        directoryId,
        selection: "native-dialog" as const,
      };
      const preview = await host.invoke({
        type: "knowledge.directory-rebind-preview",
        input: rebindInput,
      });
      expect(preview).toMatchObject({
        ok: true,
        value: {
          storeId,
          knowledgeBaseId,
          directoryId,
          status: "ready",
          memberCount: 2,
          discoveredFileCount: 2,
        },
      });
      expect(JSON.stringify(preview)).not.toContain(parent);
      expect(JSON.stringify(preview)).not.toContain("career.md");

      await expect(
        host.invoke({
          type: "knowledge.directory-rebind-apply",
          input: { ...rebindInput, confirmed: false },
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "permission-denied" } });
      expect(chooseKnowledgeSourceDirectory).toHaveBeenCalledTimes(3);
      const rebound = await host.invoke({
        type: "knowledge.directory-rebind-apply",
        input: { ...rebindInput, confirmed: true },
      });
      expect(rebound).toMatchObject({
        ok: true,
        value: {
          storeId,
          knowledgeBaseId,
          directoryId,
          status: "rebound",
          memberCount: 2,
        },
      });
      expect(JSON.stringify(rebound)).not.toContain(parent);
      await expect(
        host.invoke({
          type: "knowledge.directory-rebind-apply",
          input: { ...rebindInput, confirmed: true },
        }),
      ).resolves.toMatchObject({
        ok: true,
        value: { directoryId, status: "current", memberCount: 2 },
      });
      expect(chooseKnowledgeSourceDirectory).toHaveBeenCalledTimes(5);
      await expect(
        host.invoke({
          type: "knowledge.directory-rebind-apply",
          input: { ...rebindInput, confirmed: true },
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "permission-denied" } });
      expect(chooseKnowledgeSourceDirectory).toHaveBeenCalledTimes(6);

      const unopenedPicker = vi.fn(async () => directoryPath);
      const restartedHost = createNativeHost({
        dialogs: {
          chooseDirectory: async () => undefined,
          chooseFiles: async () => [],
          chooseKnowledgeSourceDirectory: unopenedPicker,
        },
      });
      await expect(
        restartedHost.invoke({
          type: "knowledge.import-directory",
          input: { storeId, knowledgeBaseId, selection: "native-dialog" },
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "not-found" } });
      await expect(
        restartedHost.invoke({
          type: "knowledge.directory-rebind-preview",
          input: rebindInput,
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "not-found" } });
      expect(unopenedPicker).not.toHaveBeenCalled();

      const unavailableHost = createNativeHost({
        dialogs: {
          chooseDirectory: async () => join(parent, "candidate-knowledge"),
          chooseFiles: async () => [],
        },
      });
      await expect(
        unavailableHost.invoke({ type: "knowledge.open", input: { selection: "native-dialog" } }),
      ).resolves.toMatchObject({ ok: true, value: { storeId } });
      await expect(
        unavailableHost.invoke({
          type: "knowledge.import-directory",
          input: { storeId, knowledgeBaseId, selection: "native-dialog" },
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "capability-unavailable" } });
      await expect(
        unavailableHost.invoke({
          type: "knowledge.directory-rebind-preview",
          input: rebindInput,
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "capability-unavailable" } });
      await expect(
        unavailableHost.invoke({
          type: "knowledge.directory-rebind-apply",
          input: { ...rebindInput, confirmed: true },
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "capability-unavailable" } });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("previews and explicitly applies a path-free directory refresh", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-directory-refresh-host-"));
    const directoryPath = join(parent, "private-career-directory");
    await mkdir(directoryPath);
    const sourcePath = join(directoryPath, "career.md");
    await writeFile(sourcePath, "Private career evidence.\n", "utf8");
    try {
      const underlying = createCandidateKnowledgeStoreService();
      const applyRefresh = vi.fn(underlying.applyKnowledgeSourceDirectoryRefresh);
      const knowledgeService = {
        ...underlying,
        applyKnowledgeSourceDirectoryRefresh: applyRefresh,
      };
      const host = createNativeHost({
        knowledgeService,
        dialogs: {
          chooseDirectory: async () => parent,
          chooseFiles: async () => [],
          chooseKnowledgeSourceDirectory: async () => directoryPath,
        },
      });
      const created = await host.invoke({
        type: "knowledge.create",
        input: { name: "candidate-knowledge", displayName: "My evidence" },
      });
      if (!created.ok) throw new Error("Expected candidate knowledge store creation to succeed.");
      const storeId = (created.value as { storeId: string }).storeId;
      const knowledgeBaseId = (created.value as { knowledgeBases: readonly { id: string }[] })
        .knowledgeBases[0]?.id;
      if (knowledgeBaseId === undefined) throw new Error("Expected a default knowledge base.");
      const imported = await host.invoke({
        type: "knowledge.import-directory",
        input: { storeId, knowledgeBaseId, selection: "native-dialog" },
      });
      if (!imported.ok) throw new Error("Expected directory intake to succeed.");
      const directoryId = (imported.value as { directoryId: string }).directoryId;
      const input = { storeId, knowledgeBaseId, directoryId };

      await expect(
        host.invoke({ type: "knowledge.directory-refresh-preview", input }),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          ...input,
          members: [{ status: "current" }],
          memberCount: 1,
          membersTruncated: false,
          newSourceCount: 0,
        },
      });
      await writeFile(sourcePath, "Updated private career evidence.\n", "utf8");
      const preview = await host.invoke({ type: "knowledge.directory-refresh-preview", input });
      expect(preview).toMatchObject({
        ok: true,
        value: { ...input, members: [{ status: "changed" }], memberCount: 1 },
      });
      expect(JSON.stringify(preview)).not.toContain(parent);
      expect(JSON.stringify(preview)).not.toContain("career.md");
      expect(JSON.stringify(preview)).not.toContain("Updated private career evidence");

      await expect(
        host.invoke({
          type: "knowledge.directory-refresh-apply",
          input: { ...input, confirmed: false },
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "permission-denied" } });
      expect(applyRefresh).not.toHaveBeenCalled();

      const applied = await host.invoke({
        type: "knowledge.directory-refresh-apply",
        input: { ...input, confirmed: true },
      });
      expect(applied).toMatchObject({
        ok: true,
        value: {
          ...input,
          status: "complete",
          refreshedSourceCount: 1,
          refreshedSourceIdsTruncated: false,
        },
      });
      expect(JSON.stringify(applied)).not.toContain(parent);
      expect(JSON.stringify(applied)).not.toContain("career.md");
      expect(JSON.stringify(applied)).not.toContain("Updated private career evidence");
      expect(applyRefresh).toHaveBeenCalledOnce();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("confirms a path-free directory member addition", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-directory-add-members-host-"));
    const directoryPath = join(parent, "private-career-directory");
    await mkdir(directoryPath);
    await writeFile(join(directoryPath, "career.md"), "Private career evidence.\n", "utf8");
    const newSourcePath = join(directoryPath, "new-career.md");
    try {
      const underlying = createCandidateKnowledgeStoreService();
      const addMembers = vi.fn(underlying.addKnowledgeSourceDirectoryMembers);
      const host = createNativeHost({
        knowledgeService: {
          ...underlying,
          addKnowledgeSourceDirectoryMembers: addMembers,
        },
        dialogs: {
          chooseDirectory: async () => parent,
          chooseFiles: async () => [],
          chooseKnowledgeSourceDirectory: async () => directoryPath,
        },
      });
      const created = await host.invoke({
        type: "knowledge.create",
        input: { name: "candidate-knowledge", displayName: "My evidence" },
      });
      if (!created.ok) throw new Error("Expected candidate knowledge store creation to succeed.");
      const storeId = (created.value as { storeId: string }).storeId;
      const knowledgeBaseId = (created.value as { knowledgeBases: readonly { id: string }[] })
        .knowledgeBases[0]?.id;
      if (knowledgeBaseId === undefined) throw new Error("Expected a default knowledge base.");
      const imported = await host.invoke({
        type: "knowledge.import-directory",
        input: { storeId, knowledgeBaseId, selection: "native-dialog" },
      });
      if (!imported.ok) throw new Error("Expected directory intake to succeed.");
      const directoryId = (imported.value as { directoryId: string }).directoryId;
      await writeFile(newSourcePath, "Private new career evidence.\n", "utf8");
      const input = { storeId, knowledgeBaseId, directoryId };

      await expect(
        host.invoke({
          type: "knowledge.directory-add-members",
          input: { ...input, confirmed: false },
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "permission-denied" } });
      expect(addMembers).not.toHaveBeenCalled();

      const added = await host.invoke({
        type: "knowledge.directory-add-members",
        input: { ...input, confirmed: true },
      });
      expect(added).toMatchObject({
        ok: true,
        value: {
          ...input,
          members: [{ status: "current" }],
          memberCount: 1,
          membersTruncated: false,
          newSourceCount: 1,
          status: "complete",
          addedSourceCount: 1,
          addedSourceIdsTruncated: false,
        },
      });
      if (!added.ok) throw new Error("Expected directory member addition to succeed.");
      const addedValue = added.value as {
        addedSourceIds: readonly string[];
        addedSourceCount: number;
      };
      expect(addedValue.addedSourceIds).toHaveLength(1);
      expect(addedValue.addedSourceCount).toBe(1);
      expect(JSON.stringify(added)).not.toContain(parent);
      expect(JSON.stringify(added)).not.toContain("new-career.md");
      expect(JSON.stringify(added)).not.toContain("Private new career evidence");
      expect(addMembers).toHaveBeenCalledOnce();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("previews and confirms a path-free directory member move", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-directory-member-move-host-"));
    const directoryPath = join(parent, "private-career-directory");
    await mkdir(directoryPath);
    const originalPath = join(directoryPath, "career.md");
    const movedPath = join(directoryPath, "renamed-career.md");
    await writeFile(originalPath, "Private career evidence.\n", "utf8");
    try {
      const underlying = createCandidateKnowledgeStoreService();
      const applyMove = vi.fn(underlying.applyKnowledgeSourceDirectoryMemberMove);
      const host = createNativeHost({
        knowledgeService: { ...underlying, applyKnowledgeSourceDirectoryMemberMove: applyMove },
        dialogs: {
          chooseDirectory: async () => parent,
          chooseFiles: async () => [],
          chooseKnowledgeSourceDirectory: async () => directoryPath,
        },
      });
      const created = await host.invoke({
        type: "knowledge.create",
        input: { name: "candidate-knowledge", displayName: "My evidence" },
      });
      if (!created.ok) throw new Error("Expected candidate knowledge store creation to succeed.");
      const storeId = (created.value as { storeId: string }).storeId;
      const knowledgeBaseId = (created.value as { knowledgeBases: readonly { id: string }[] })
        .knowledgeBases[0]?.id;
      if (knowledgeBaseId === undefined) throw new Error("Expected a default knowledge base.");
      const imported = await host.invoke({
        type: "knowledge.import-directory",
        input: { storeId, knowledgeBaseId, selection: "native-dialog" },
      });
      if (!imported.ok) throw new Error("Expected directory intake to succeed.");
      const importedValue = imported.value as {
        directoryId: string;
        sources: readonly { sourceId: string }[];
      };
      const directoryId = importedValue.directoryId;
      const sourceId = importedValue.sources[0]?.sourceId;
      if (sourceId === undefined) throw new Error("Expected one imported source.");
      await rename(originalPath, movedPath);
      const input = { storeId, knowledgeBaseId, directoryId };
      const preview = await host.invoke({ type: "knowledge.directory-moved-candidates", input });
      expect(preview).toMatchObject({
        ok: true,
        value: {
          ...input,
          candidates: [{ sourceId, status: "moved-candidate" }],
          candidateCount: 1,
          candidatesTruncated: false,
        },
      });
      expect(JSON.stringify(preview)).not.toContain(parent);
      expect(JSON.stringify(preview)).not.toContain("renamed-career.md");
      await expect(
        host.invoke({
          type: "knowledge.directory-member-move",
          input: { ...input, sourceId, confirmed: false },
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "permission-denied" } });
      expect(applyMove).not.toHaveBeenCalled();
      const moved = await host.invoke({
        type: "knowledge.directory-member-move",
        input: { ...input, sourceId, confirmed: true },
      });
      expect(moved).toMatchObject({ ok: true, value: { ...input, sourceId, status: "moved" } });
      expect(JSON.stringify(moved)).not.toContain(parent);
      expect(JSON.stringify(moved)).not.toContain("renamed-career.md");
      await expect(
        host.invoke({
          type: "knowledge.directory-member-move",
          input: { ...input, sourceId, confirmed: true },
        }),
      ).resolves.toMatchObject({ ok: true, value: { status: "current" } });
      await rm(movedPath);
      await expect(
        host.invoke({ type: "knowledge.directory-reconciliation-preview", input }),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          ...input,
          members: [{ sourceId, status: "missing" }],
          missingCount: 1,
          scanStatus: "complete",
        },
      });
      await expect(
        host.invoke({
          type: "knowledge.directory-reconciliation-apply",
          input: { ...input, approvedRetirementSourceIds: [sourceId], confirmed: false },
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "permission-denied" } });
      await expect(
        host.invoke({
          type: "knowledge.directory-reconciliation-apply",
          input: { ...input, approvedRetirementSourceIds: [sourceId], confirmed: true },
        }),
      ).resolves.toMatchObject({
        ok: true,
        value: { ...input, status: "applied", retiredSourceIds: [sourceId] },
      });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("preserves path-free partial directory intake and rejects inconsistent results", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-knowledge-directory-result-host-"));
    const directoryPath = join(parent, "private-career-directory");
    await mkdir(directoryPath);
    try {
      const underlying = createCandidateKnowledgeStoreService();
      const imported = {
        status: "partial" as const,
        scannedEntryCount: 2,
        discoveredFileCount: 2,
        skippedEntryCount: 0,
        sources: [
          {
            created: true,
            source: {
              id: "source-1",
              knowledgeBaseId: "placeholder",
              kind: "file" as const,
            },
            versions: [{ id: "version-1", sourceId: "source-1", version: 1 }],
          },
        ],
      };
      let knowledgeBaseId = "";
      const importKnowledgeSourceDirectory = vi.fn(async () => ({
        ...imported,
        sources: [
          {
            ...imported.sources[0],
            source: { ...imported.sources[0]?.source, knowledgeBaseId },
          },
        ],
      }));
      const host = createNativeHost({
        knowledgeService: { ...underlying, importKnowledgeSourceDirectory } as never,
        dialogs: {
          chooseDirectory: async () => parent,
          chooseFiles: async () => [],
          chooseKnowledgeSourceDirectory: async () => directoryPath,
        },
      });
      const created = await host.invoke({
        type: "knowledge.create",
        input: { name: "candidate-knowledge", displayName: "My evidence" },
      });
      if (!created.ok) throw new Error("Expected candidate knowledge store creation to succeed.");
      const storeId = (created.value as { storeId: string }).storeId;
      knowledgeBaseId =
        (created.value as { knowledgeBases: readonly { id: string }[] }).knowledgeBases[0]?.id ??
        "";

      const result = await host.invoke({
        type: "knowledge.import-directory",
        input: { storeId, knowledgeBaseId, selection: "native-dialog" },
      });
      expect(result).toMatchObject({
        ok: true,
        value: {
          status: "partial",
          sourceCount: 1,
          sources: [{ sourceId: "source-1", versionId: "version-1" }],
        },
      });
      expect(result.ok && result.value).not.toHaveProperty("directoryId");
      expect(JSON.stringify(result)).not.toContain(parent);

      importKnowledgeSourceDirectory.mockResolvedValueOnce({
        ...imported,
        discoveredFileCount: 0,
        sources: [
          {
            ...imported.sources[0],
            source: { ...imported.sources[0]?.source, knowledgeBaseId },
          },
        ],
      });
      await expect(
        host.invoke({
          type: "knowledge.import-directory",
          input: { storeId, knowledgeBaseId, selection: "native-dialog" },
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });

      importKnowledgeSourceDirectory.mockResolvedValueOnce({
        ...imported,
        status: "complete",
        directoryId: "directory-1",
        sources: [
          {
            ...imported.sources[0],
            source: { ...imported.sources[0]?.source, knowledgeBaseId },
          },
        ],
      } as never);
      await expect(
        host.invoke({
          type: "knowledge.import-directory",
          input: { storeId, knowledgeBaseId, selection: "native-dialog" },
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("appends one selected file version without exposing paths or content", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-knowledge-append-host-"));
    const storeRoot = join(parent, "candidate-knowledge");
    const initialPath = join(parent, "initial-private-resume.md");
    const changedPath = join(parent, "changed-private-resume.md");
    await writeFile(initialPath, "Initial private evidence.\n", "utf8");
    await writeFile(changedPath, "Changed private evidence.\n", "utf8");
    const selectedKnowledgeFiles = [initialPath, changedPath, changedPath];
    try {
      const host = createNativeHost({
        dialogs: {
          chooseDirectory: async () => parent,
          chooseFiles: async () => [],
          chooseKnowledgeSourceFile: async () => selectedKnowledgeFiles.shift(),
        },
      });
      const created = await host.invoke({
        type: "knowledge.create",
        input: { name: "candidate-knowledge", displayName: "My evidence" },
      });
      if (!created.ok) throw new Error("Expected candidate knowledge store creation to succeed.");
      const storeId = (created.value as { storeId: string }).storeId;
      const knowledgeBaseId = (created.value as { knowledgeBases: readonly { id: string }[] })
        .knowledgeBases[0]?.id;
      if (knowledgeBaseId === undefined) throw new Error("Expected a default knowledge base.");
      const imported = await host.invoke({
        type: "knowledge.import-file",
        input: { storeId, knowledgeBaseId, selection: "native-dialog" },
      });
      if (!imported.ok) throw new Error("Expected candidate knowledge file intake to succeed.");
      const sourceId = (imported.value as { sourceId: string }).sourceId;

      const appended = await host.invoke({
        type: "knowledge.append-file-version",
        input: { storeId, knowledgeBaseId, sourceId, selection: "native-dialog" },
      });
      expect(appended).toMatchObject({
        ok: true,
        value: {
          storeId,
          knowledgeBaseId,
          sourceId,
          kind: "file",
          version: 2,
          created: true,
        },
      });
      expect(JSON.stringify(appended)).not.toContain(parent);
      expect(JSON.stringify(appended)).not.toContain("changed-private-resume.md");
      expect(JSON.stringify(appended)).not.toContain("Changed private evidence");

      await expect(
        host.invoke({
          type: "knowledge.append-file-version",
          input: { storeId, knowledgeBaseId, sourceId, selection: "native-dialog" },
        }),
      ).resolves.toMatchObject({
        ok: true,
        value: { sourceId, kind: "file", version: 2, created: false },
      });
      await expect(
        host.invoke({
          type: "knowledge.append-file-version",
          input: { storeId, knowledgeBaseId, sourceId, selection: "native-dialog" },
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "permission-denied" } });

      const chooseKnowledgeSourceFile = vi.fn(async () => changedPath);
      const reopenedRoots = [storeRoot];
      const restarted = createNativeHost({
        dialogs: {
          chooseDirectory: async () => reopenedRoots.shift(),
          chooseFiles: async () => [],
          chooseKnowledgeSourceFile,
        },
      });
      await expect(
        restarted.invoke({
          type: "knowledge.append-file-version",
          input: { storeId, knowledgeBaseId, sourceId, selection: "native-dialog" },
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "not-found" } });
      expect(chooseKnowledgeSourceFile).not.toHaveBeenCalled();
      await expect(
        restarted.invoke({ type: "knowledge.open", input: { selection: "native-dialog" } }),
      ).resolves.toMatchObject({ ok: true, value: { storeId } });
      await expect(
        restarted.invoke({
          type: "knowledge.append-file-version",
          input: { storeId, knowledgeBaseId, sourceId, selection: "native-dialog" },
        }),
      ).resolves.toMatchObject({
        ok: true,
        value: { sourceId, kind: "file", version: 2, created: false },
      });
      expect(chooseKnowledgeSourceFile).toHaveBeenCalledOnce();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("refreshes, rebinds, and retires a file source without exposing its path", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-knowledge-refresh-host-"));
    const storeRoot = join(parent, "candidate-knowledge");
    const sourcePath = join(parent, "private-resume.md");
    const replacementPath = join(parent, "replacement-private-resume.md");
    await writeFile(sourcePath, "Initial private evidence.\n", "utf8");
    const selectedKnowledgeFiles = [sourcePath, replacementPath, replacementPath];
    try {
      const host = createNativeHost({
        dialogs: {
          chooseDirectory: async () => parent,
          chooseFiles: async () => [],
          chooseKnowledgeSourceFile: async () => selectedKnowledgeFiles.shift(),
        },
      });
      const created = await host.invoke({
        type: "knowledge.create",
        input: { name: "candidate-knowledge", displayName: "My evidence" },
      });
      if (!created.ok) throw new Error("Expected candidate knowledge store creation to succeed.");
      const storeId = (created.value as { storeId: string }).storeId;
      const knowledgeBaseId = (created.value as { knowledgeBases: readonly { id: string }[] })
        .knowledgeBases[0]?.id;
      if (knowledgeBaseId === undefined) throw new Error("Expected a default knowledge base.");
      const imported = await host.invoke({
        type: "knowledge.import-file",
        input: { storeId, knowledgeBaseId, selection: "native-dialog" },
      });
      if (!imported.ok) throw new Error("Expected candidate knowledge file intake to succeed.");
      const sourceId = (imported.value as { sourceId: string }).sourceId;
      const input = { storeId, knowledgeBaseId, sourceId };

      await expect(
        host.invoke({ type: "knowledge.source-origin-status", input }),
      ).resolves.toMatchObject({ ok: true, value: { ...input, status: "current" } });
      await expect(host.invoke({ type: "knowledge.source-refresh-state", input })).resolves.toEqual(
        { ok: true, value: { ...input, status: "unobserved" } },
      );

      await writeFile(sourcePath, "Changed private evidence.\n", "utf8");
      const changed = await host.invoke({ type: "knowledge.source-origin-status", input });
      expect(changed).toMatchObject({ ok: true, value: { ...input, status: "changed" } });
      expect(JSON.stringify(changed)).not.toContain(parent);
      expect(JSON.stringify(changed)).not.toContain("private-resume.md");

      const refreshed = await host.invoke({ type: "knowledge.refresh-file", input });
      expect(refreshed).toMatchObject({
        ok: true,
        value: { ...input, status: "refreshed", versionId: expect.any(String) },
      });
      expect(JSON.stringify(refreshed)).not.toContain(parent);
      expect(JSON.stringify(refreshed)).not.toContain("Changed private evidence");
      await expect(
        host.invoke({ type: "knowledge.source-refresh-state", input }),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          ...input,
          status: "current",
          observedVersionId: expect.any(String),
          lastRefreshedVersionId: expect.any(String),
        },
      });

      await rm(sourcePath);
      await expect(
        host.invoke({ type: "knowledge.source-origin-status", input }),
      ).resolves.toMatchObject({ ok: true, value: { ...input, status: "missing" } });
      await expect(host.invoke({ type: "knowledge.refresh-file", input })).resolves.toMatchObject({
        ok: true,
        value: { ...input, status: "missing" },
      });

      await expect(
        host.invoke({ type: "knowledge.source-retirement-state", input }),
      ).resolves.toEqual({ ok: true, value: { ...input, status: "active" } });
      await writeFile(replacementPath, "Changed private evidence.\n", "utf8");
      const rebound = await host.invoke({
        type: "knowledge.rebind-file",
        input: { ...input, selection: "native-dialog" },
      });
      expect(rebound).toMatchObject({
        ok: true,
        value: { ...input, status: "rebound", boundAt: expect.any(String) },
      });
      expect(JSON.stringify(rebound)).not.toContain(parent);
      expect(JSON.stringify(rebound)).not.toContain("replacement-private-resume.md");
      await expect(
        host.invoke({ type: "knowledge.source-origin-status", input }),
      ).resolves.toMatchObject({ ok: true, value: { ...input, status: "current" } });

      await expect(
        host.invoke({
          type: "knowledge.retire-source",
          input: { ...input, confirmed: false },
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "permission-denied" } });
      const retired = await host.invoke({
        type: "knowledge.retire-source",
        input: { ...input, confirmed: true },
      });
      expect(retired).toMatchObject({
        ok: true,
        value: {
          ...input,
          status: "retired",
          retiredAt: expect.any(String),
          reason: "user-requested",
        },
      });
      expect(JSON.stringify(retired)).not.toContain(parent);
      expect(JSON.stringify(retired)).not.toContain("Changed private evidence");
      await expect(
        host.invoke({ type: "knowledge.source-retirement-state", input }),
      ).resolves.toEqual(retired);
      await expect(
        host.invoke({
          type: "knowledge.rebind-file",
          input: { ...input, selection: "native-dialog" },
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });

      const reopenedRoots = [storeRoot];
      const reopenedRebindPicker = vi.fn(async () => replacementPath);
      const restarted = createNativeHost({
        dialogs: {
          chooseDirectory: async () => reopenedRoots.shift(),
          chooseFiles: async () => [],
          chooseKnowledgeSourceFile: reopenedRebindPicker,
        },
      });
      await expect(
        restarted.invoke({ type: "knowledge.source-origin-status", input }),
      ).resolves.toMatchObject({ ok: false, error: { code: "not-found" } });
      await expect(
        restarted.invoke({
          type: "knowledge.rebind-file",
          input: { ...input, selection: "native-dialog" },
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "not-found" } });
      expect(reopenedRebindPicker).not.toHaveBeenCalled();
      await expect(
        restarted.invoke({ type: "knowledge.open", input: { selection: "native-dialog" } }),
      ).resolves.toMatchObject({ ok: true, value: { storeId } });
      await expect(
        restarted.invoke({ type: "knowledge.source-origin-status", input }),
      ).resolves.toMatchObject({ ok: true, value: { ...input, status: "current" } });
      await expect(
        restarted.invoke({ type: "knowledge.source-retirement-state", input }),
      ).resolves.toMatchObject({
        ok: true,
        value: { ...input, status: "retired", reason: "user-requested" },
      });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("imports approved URL sources without exposing their URL or content", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-knowledge-url-host-"));
    const storeRoot = join(parent, "candidate-knowledge");
    const wrongKindPath = join(parent, "wrong-kind-private-source.md");
    await writeFile(wrongKindPath, "Must not append to a URL source.\n", "utf8");
    const resolveHostname = vi.fn(async () => ["93.184.216.34"]);
    const fetchUrl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("Private candidate evidence", {
          headers: { "content-type": "text/plain" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("Updated candidate evidence", {
          headers: { "content-type": "text/plain" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("Updated candidate evidence", {
          headers: { "content-type": "text/plain" },
        }),
      )
      .mockRejectedValueOnce(new Error("Sensitive URL refresh failure"));
    try {
      const host = createNativeHost({
        dialogs: {
          chooseDirectory: async () => parent,
          chooseFiles: async () => [],
          chooseKnowledgeSourceFile: async () => wrongKindPath,
        },
        urlHostnameResolver: resolveHostname,
        urlFetcher: fetchUrl,
      });
      const created = await host.invoke({
        type: "knowledge.create",
        input: { name: "candidate-knowledge", displayName: "My evidence" },
      });
      if (!created.ok) throw new Error("Expected candidate knowledge store creation to succeed.");
      const storeId = (created.value as { storeId: string }).storeId;
      const knowledgeBaseId = (created.value as { knowledgeBases: readonly { id: string }[] })
        .knowledgeBases[0]?.id;
      if (knowledgeBaseId === undefined) throw new Error("Expected a default knowledge base.");
      const sensitiveUrl = "https://example.com/private-profile?token=sensitive";

      await expect(
        host.invoke({
          type: "knowledge.import-url",
          input: { storeId, knowledgeBaseId, url: sensitiveUrl, approved: false },
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "invalid-input" } });
      expect(resolveHostname).not.toHaveBeenCalled();
      expect(fetchUrl).not.toHaveBeenCalled();

      const imported = await host.invoke({
        type: "knowledge.import-url",
        input: {
          storeId,
          knowledgeBaseId,
          url: sensitiveUrl,
          approved: true,
          displayName: "Private profile",
        },
      });
      expect(imported).toMatchObject({
        ok: true,
        value: { storeId, knowledgeBaseId, kind: "url", version: 1, created: true },
      });
      expect(JSON.stringify(imported)).not.toContain(sensitiveUrl);
      expect(JSON.stringify(imported)).not.toContain("sensitive");
      expect(JSON.stringify(imported)).not.toContain("Private profile");
      expect(JSON.stringify(imported)).not.toContain("Private candidate evidence");
      expect(resolveHostname).toHaveBeenCalledOnce();
      expect(fetchUrl).toHaveBeenCalledOnce();
      if (!imported.ok) throw new Error("Expected candidate knowledge URL intake to succeed.");
      const sourceId = (imported.value as { sourceId: string }).sourceId;
      const refreshInput = { storeId, knowledgeBaseId, sourceId };
      await expect(
        host.invoke({
          type: "knowledge.refresh-url",
          input: { ...refreshInput, approved: false },
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "invalid-input" } });
      expect(fetchUrl).toHaveBeenCalledOnce();
      const refreshed = await host.invoke({
        type: "knowledge.refresh-url",
        input: { ...refreshInput, approved: true },
      });
      expect(refreshed).toMatchObject({
        ok: true,
        value: { ...refreshInput, status: "refreshed", versionId: expect.any(String) },
      });
      expect(JSON.stringify(refreshed)).not.toContain(sensitiveUrl);
      expect(JSON.stringify(refreshed)).not.toContain("Updated candidate evidence");
      await expect(
        host.invoke({
          type: "knowledge.refresh-url",
          input: { ...refreshInput, approved: true },
        }),
      ).resolves.toMatchObject({
        ok: true,
        value: { ...refreshInput, status: "current" },
      });
      const inaccessible = await host.invoke({
        type: "knowledge.refresh-url",
        input: { ...refreshInput, approved: true },
      });
      expect(inaccessible).toMatchObject({
        ok: true,
        value: { ...refreshInput, status: "inaccessible" },
      });
      expect(JSON.stringify(inaccessible)).not.toContain("Sensitive URL refresh failure");
      const wrongKindAppend = await host.invoke({
        type: "knowledge.append-file-version",
        input: { storeId, knowledgeBaseId, sourceId, selection: "native-dialog" },
      });
      expect(wrongKindAppend).toMatchObject({
        ok: false,
        error: { code: "operation-failed" },
      });
      expect(JSON.stringify(wrongKindAppend)).not.toContain(parent);
      expect(JSON.stringify(wrongKindAppend)).not.toContain("wrong-kind-private-source.md");
      await expect(
        host.invoke({ type: "knowledge.sources", input: { storeId, knowledgeBaseId } }),
      ).resolves.toMatchObject({
        ok: true,
        value: { sourceCount: 1, sources: [{ kind: "url", versionCount: 2 }] },
      });

      const reopenedRoots = [storeRoot];
      const restartedFetch = vi.fn(async () => new Response("Restarted evidence"));
      const restarted = createNativeHost({
        dialogs: {
          chooseDirectory: async () => reopenedRoots.shift(),
          chooseFiles: async () => [],
        },
        urlHostnameResolver: async () => ["93.184.216.34"],
        urlFetcher: restartedFetch,
      });
      await expect(
        restarted.invoke({
          type: "knowledge.import-url",
          input: { storeId, knowledgeBaseId, url: sensitiveUrl, approved: true },
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "not-found" } });
      expect(restartedFetch).not.toHaveBeenCalled();
      await expect(
        restarted.invoke({ type: "knowledge.open", input: { selection: "native-dialog" } }),
      ).resolves.toMatchObject({ ok: true, value: { storeId } });
      await expect(
        restarted.invoke({
          type: "knowledge.import-url",
          input: {
            storeId,
            knowledgeBaseId,
            url: "https://example.com/restarted",
            approved: true,
          },
        }),
      ).resolves.toMatchObject({ ok: true, value: { kind: "url", version: 1 } });
      expect(restartedFetch).toHaveBeenCalledOnce();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("requires explicit approval before forwarding a multi-CKB selection", async () => {
    const root = "/local/workspace";
    const storeRoots = ["/local/store-a", "/local/store-b"];
    const fixture = service(root);
    const configureKnowledgeSelection = vi.fn<ApplicationService["configureKnowledgeSelection"]>(
      async (command) => {
        if (command.entries.length > 1 && command.combinationApproved !== true) {
          throw new Error("Combination approval is required.");
        }
        return {
          ...descriptor(root),
          candidateKnowledgeSelection: command.entries.map(({ storeId, knowledgeBaseId }) => ({
            storeId,
            knowledgeBaseId,
          })),
        };
      },
    );
    const applicationService = { ...fixture.service, configureKnowledgeSelection };
    const openedRoots = [root, ...storeRoots];
    const knowledgeService = {
      openStore: vi.fn(async ({ storeRoot }: { storeRoot: string }) => ({
        store: {
          schemaVersion: 1,
          id: storeRoot.endsWith("a") ? "store-a" : "store-b",
          createdAt: "2026-08-23T10:00:00.000Z",
        },
        knowledgeBases: [],
      })),
    };
    const host = createNativeHost({
      applicationService,
      knowledgeService: knowledgeService as never,
      dialogs: {
        chooseDirectory: async () => openedRoots.shift(),
        chooseFiles: async () => [],
      },
    });
    await host.invoke({ type: "workspace.open", input: { selection: "native-dialog" } });
    await host.invoke({ type: "knowledge.open", input: { selection: "native-dialog" } });
    await host.invoke({ type: "knowledge.open", input: { selection: "native-dialog" } });
    const input = {
      workspaceId: "workspace-native",
      entries: [
        { storeId: "store-a", knowledgeBaseId: "kb-a" },
        { storeId: "store-b", knowledgeBaseId: "kb-b" },
      ],
    } as const;

    await expect(host.invoke({ type: "knowledge.select", input })).resolves.toMatchObject({
      ok: false,
      error: { code: "operation-failed" },
    });
    const approved = await host.invoke({
      type: "knowledge.select",
      input: { ...input, combinationApproved: true },
    });
    expect(approved).toEqual({
      ok: true,
      value: { workspaceId: "workspace-native", entries: input.entries },
    });
    expect(configureKnowledgeSelection).toHaveBeenLastCalledWith({
      root,
      entries: [
        { storeRoot: storeRoots[0], storeId: "store-a", knowledgeBaseId: "kb-a" },
        { storeRoot: storeRoots[1], storeId: "store-b", knowledgeBaseId: "kb-b" },
      ],
      combinationApproved: true,
    });
    expect(JSON.stringify(approved)).not.toContain("/local/");
  });
});
