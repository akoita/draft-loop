import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ApplicationService,
  createLocalApplicationDriver,
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

function service(root: string, snapshotOverrides: Readonly<Record<string, unknown>> = {}) {
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
    artifact: {
      schemaVersion: 1,
      id: "artifact-native",
      version: 1,
      parentVersionId: null,
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
    },
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
    } satisfies ApplicationService,
    snapshot,
  };
}

describe("native host", () => {
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

  it("projects safe provider recovery and enforces retry, return, and stop actions", async () => {
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
            availableActions: ["retry", "return-to-review", "stop"],
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
        input: {
          workspaceId: "workspace-native",
          runId: "run-native",
          action: { type: "recover-to-review" },
        },
      });
      await host.invoke({
        type: "review.dispatch",
        input: { workspaceId: "workspace-native", runId: "run-native", action: { type: "stop" } },
      });
      expect(fixture.service.resume).toHaveBeenCalledOnce();
      expect(fixture.service.lifecycle).toHaveBeenCalledWith(
        expect.objectContaining({ action: "recover-review" }),
        expect.anything(),
      );
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
    } finally {
      await rm(parent, { recursive: true, force: true });
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
  });
});
