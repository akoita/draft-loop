import {
  type ApplicationService,
  type ApplicationView,
  CliUserError,
  createOpportunityDraft,
  RunModelProfileError,
  type WorkspaceDescriptor,
  WorkspaceNotFoundError,
} from "@draft-loop/application";
import type { RunSnapshot } from "@draft-loop/orchestrator";
import type { OpportunityBriefVersionRecord } from "@draft-loop/storage";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const authorization = `Bearer ${ownerToken}`;
const at = "2026-10-21T10:00:00.000Z";

const descriptor = {
  id: "workspace-1",
  root: "/tenants/owner/workspaces/workspace-1",
  jobDescriptionPath: "job.md",
  sourceDirectory: "evidence",
  language: "en",
  outputFormat: "markdown",
  requiredSections: ["Experience"],
  maxRounds: 3,
  maxCostUsd: 2,
  maxDurationMs: 600_000,
  author: { company: "anthropic", model: "claude-haiku-5-5" },
  critic: { company: "openai", model: "gpt-6-luna" },
  fixtureMode: true,
} as WorkspaceDescriptor;

const snapshot = {
  schemaVersion: 1,
  runId: "run-1",
  workspaceId: "workspace-1",
  contextSnapshotId: "context-1",
  state: "drafting",
  round: 0,
  currentStep: null,
  artifact: null,
  findings: [],
  totalCostUsd: 0,
  executionHistory: [],
  approval: "pending",
  startedAt: at,
  updatedAt: at,
  lastError: null,
} as unknown as RunSnapshot;

const application = {
  schemaVersion: 1,
  id: "default",
  name: "Platform engineer",
  jobSource: { kind: "local-file", path: "/private/job.md" },
  createdAt: at,
  updatedAt: at,
  status: "drafting",
  isDefault: true,
  briefs: [],
  runs: [{ id: "run-1", state: "drafting", startedAt: at, updatedAt: at }],
  exports: [],
  archivedAt: null,
  nameChosen: true,
  suggestedName: null,
  modelProfiles: null,
  chosenRun: null,
} as unknown as ApplicationView;

async function briefRecord(): Promise<OpportunityBriefVersionRecord> {
  const brief = await createOpportunityDraft(
    {
      id: "brief-1",
      createdAt: at,
      sources: [
        {
          id: "posting",
          kind: "pasted-content",
          classification: "job-posting",
          content: "Platform Engineer at Example Ledger\n\nRequirements:\n- Operate Postgres.",
        },
      ],
    },
    { now: () => at },
  );
  return { workspaceId: "workspace-1", checksum: "a".repeat(64), brief };
}

/** Only the methods a test scripts exist; calling any other one fails the test. */
function scriptedService(methods: Partial<ApplicationService>): ApplicationService {
  return new Proxy(methods, {
    get: (target, name) =>
      (target as Record<string | symbol, unknown>)[name] ??
      (() => {
        throw new Error(`unexpected service call: ${String(name)}`);
      }),
  }) as ApplicationService;
}

let app: FastifyInstance;

type EnqueueRun = (workspaceId: string, runId: string) => Promise<void>;

async function build(
  methods: Partial<ApplicationService>,
  enqueueRun: EnqueueRun = async () => undefined,
): Promise<void> {
  app = await buildApi({
    ownerToken,
    application: {
      service: scriptedService(methods),
      workspaceRoot: (workspaceId) => `/tenants/owner/workspaces/${workspaceId}`,
      enqueueRun,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage: async () => [],
    },
  });
}

afterEach(async () => {
  await app.close();
});

describe("workspaces", () => {
  it("reads a workspace without its driver reference or paths", async () => {
    const readWorkspace = vi.fn(async () => descriptor);
    await build({ readWorkspace });

    const response = await app.inject({
      method: "GET",
      url: "/v1/workspaces/workspace-1",
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    expect(readWorkspace).toHaveBeenCalledWith("/tenants/owner/workspaces/workspace-1");
    expect(response.json()).toEqual({
      id: "workspace-1",
      language: "en",
      requiredSections: ["Experience"],
      maxRounds: 3,
      maxCostUsd: 2,
      maxDurationMs: 600_000,
      author: { company: "anthropic", model: "claude-haiku-5-5" },
      critic: { company: "openai", model: "gpt-6-luna" },
      fixtureMode: true,
      autopilot: false,
      knowledgeBaseIds: [],
    });
    expect(response.body).not.toContain("/tenants/");
  });

  it("refuses a workspace id that could address something else", async () => {
    await build({});

    const response = await app.inject({
      method: "GET",
      url: "/v1/workspaces/..%2Fother",
      headers: { authorization },
    });

    expect(response.statusCode).toBe(400);
  });

  it("answers a workspace not created yet as not found, without its storage path", async () => {
    await build({
      readWorkspace: async () => {
        throw new WorkspaceNotFoundError("/tenants/local/workspaces/workspace-1");
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/workspaces/workspace-1",
      headers: { authorization },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toEqual({ code: "not_found", message: "No such workspace." });
  });

  it("answers the service's user errors as refusals", async () => {
    await build({
      readWorkspace: async () => {
        throw new CliUserError("The workspace configuration is not valid JSON.");
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/workspaces/workspace-1",
      headers: { authorization },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("rejected");
  });
});

describe("job briefs", () => {
  it("creates a brief from pasted sources", async () => {
    const record = await briefRecord();
    const createOpportunity = vi.fn(async () => record);
    await build({ createOpportunity });

    const response = await app.inject({
      method: "POST",
      url: "/v1/workspaces/workspace-1/opportunities",
      headers: { authorization },
      payload: {
        sources: [
          {
            id: "posting",
            kind: "pasted-content",
            classification: "job-posting",
            content: "Platform Engineer at Example Ledger",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(createOpportunity).toHaveBeenCalledWith({
      root: "/tenants/owner/workspaces/workspace-1",
      sources: [
        {
          id: "posting",
          kind: "pasted-content",
          classification: "job-posting",
          content: "Platform Engineer at Example Ledger",
        },
      ],
    });
    expect(response.json().brief.id).toBe("brief-1");
  });

  it.each([
    [
      "a server file path",
      { id: "s", kind: "local-file", classification: "job-posting", path: "/etc/passwd" },
    ],
    [
      "an unapproved URL to fetch",
      {
        id: "s",
        kind: "approved-url",
        classification: "job-posting",
        url: "https://example.test",
        approved: false,
      },
    ],
    [
      "a plain http URL to fetch",
      {
        id: "s",
        kind: "approved-url",
        classification: "job-posting",
        url: "http://example.test",
        approved: true,
      },
    ],
    [
      "an unknown field",
      { id: "s", kind: "pasted-content", classification: "job-posting", content: "x", path: "/x" },
    ],
  ])("refuses %s as a source", async (_label, source) => {
    const createOpportunity = vi.fn();
    await build({ createOpportunity });

    const response = await app.inject({
      method: "POST",
      url: "/v1/workspaces/workspace-1/opportunities",
      headers: { authorization },
      payload: { sources: [source] },
    });

    expect(response.statusCode).toBe(400);
    expect(createOpportunity).not.toHaveBeenCalled();
  });

  it("reads a brief at a version and answers 404 for an unknown one", async () => {
    const record = await briefRecord();
    const getOpportunity = vi.fn(async (command: { readonly version?: number }) =>
      command.version === 1 ? record : undefined,
    );
    await build({ getOpportunity });

    const found = await app.inject({
      method: "GET",
      url: "/v1/workspaces/workspace-1/opportunities/brief-1?version=1",
      headers: { authorization },
    });
    const missing = await app.inject({
      method: "GET",
      url: "/v1/workspaces/workspace-1/opportunities/brief-1?version=2",
      headers: { authorization },
    });

    expect(found.statusCode).toBe(200);
    expect(getOpportunity).toHaveBeenCalledWith({
      root: "/tenants/owner/workspaces/workspace-1",
      briefId: "brief-1",
      version: 1,
    });
    expect(missing.statusCode).toBe(404);
  });

  it("reviews a brief at the expected version", async () => {
    const record = await briefRecord();
    const reviewOpportunity = vi.fn(async () => record);
    await build({ reviewOpportunity });

    const response = await app.inject({
      method: "POST",
      url: "/v1/workspaces/workspace-1/opportunities/brief-1/review",
      headers: { authorization },
      payload: { expectedVersion: 1 },
    });

    expect(response.statusCode).toBe(200);
    expect(reviewOpportunity).toHaveBeenCalledWith({
      root: "/tenants/owner/workspaces/workspace-1",
      briefId: "brief-1",
      expectedVersion: 1,
    });
  });
});

describe("applications", () => {
  it("lists applications without their job source paths", async () => {
    await build({ listApplications: async () => [application] });

    const response = await app.inject({
      method: "GET",
      url: "/v1/workspaces/workspace-1/applications",
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().applications).toEqual([
      expect.objectContaining({ id: "default", isDefault: true, chosenRunId: null }),
    ]);
    expect(response.body).not.toContain("/private/job.md");
  });

  it("answers 404 for an unknown application", async () => {
    await build({ getApplication: async () => undefined });

    const response = await app.inject({
      method: "GET",
      url: "/v1/workspaces/workspace-1/applications/missing",
      headers: { authorization },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("runs", () => {
  const beginRequest = (key: string, payload: object = {}) => ({
    method: "POST" as const,
    url: "/v1/workspaces/workspace-1/runs",
    headers: { authorization, "idempotency-key": key },
    payload,
  });

  it("begins a run once per idempotency key and queues it on every attempt", async () => {
    const begin = vi.fn(async () => snapshot);
    const enqueueRun = vi.fn<EnqueueRun>(async () => undefined);
    await build({ readWorkspace: async () => descriptor, begin }, enqueueRun);

    const first = await app.inject(beginRequest("key-00000001", { applicationId: "default" }));
    const retry = await app.inject(beginRequest("key-00000001", { applicationId: "default" }));

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json());
    expect(begin).toHaveBeenCalledTimes(1);
    expect(begin).toHaveBeenCalledWith({
      root: "/tenants/owner/workspaces/workspace-1",
      applicationId: "default",
    });
    expect(first.json()).toMatchObject({ runId: "run-1", state: "drafting", hasDraft: false });
    expect(enqueueRun.mock.calls).toEqual([
      ["workspace-1", "run-1"],
      ["workspace-1", "run-1"],
    ]);
  });

  it("begins a run with exact model profiles and refuses a pair the service refuses", async () => {
    const modelProfiles = {
      author: { id: "standard-anthropic-author", version: 1 },
      critic: { id: "standard-openai-critic", version: 2 },
    };
    const begin = vi.fn(async (command: { readonly modelProfiles?: typeof modelProfiles }) => {
      if (command.modelProfiles?.critic.version !== 2) throw new RunModelProfileError();
      return snapshot;
    });
    await build({ readWorkspace: async () => descriptor, begin }, async () => undefined);

    const begun = await app.inject(beginRequest("key-00000005", { modelProfiles }));
    const refused = await app.inject(
      beginRequest("key-00000006", {
        modelProfiles: { ...modelProfiles, critic: { id: "standard-openai-critic", version: 9 } },
      }),
    );

    expect(begun.statusCode).toBe(201);
    expect(begin).toHaveBeenNthCalledWith(1, {
      root: "/tenants/owner/workspaces/workspace-1",
      modelProfiles,
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toMatchObject({ error: { code: "rejected" } });
  });

  it("passes a chosen reasoning level to the run and refuses an unknown level", async () => {
    const modelProfiles = {
      author: { id: "standard-anthropic-author", version: 1, effort: "xhigh" },
      critic: { id: "standard-openai-critic", version: 2, effort: "medium" },
    };
    const begin = vi.fn(async () => snapshot);
    await build({ readWorkspace: async () => descriptor, begin }, async () => undefined);

    const begun = await app.inject(beginRequest("key-00000007", { modelProfiles }));
    const unknown = await app.inject(
      beginRequest("key-00000008", {
        modelProfiles: { ...modelProfiles, author: { ...modelProfiles.author, effort: "none" } },
      }),
    );

    expect(begun.statusCode).toBe(201);
    expect(begin).toHaveBeenCalledWith({
      root: "/tenants/owner/workspaces/workspace-1",
      modelProfiles,
    });
    expect(unknown.statusCode).toBe(400);
    expect(begin).toHaveBeenCalledTimes(1);
  });

  it("answers 503 when the queue fails, and a retry queues the saved run", async () => {
    const begin = vi.fn(async () => snapshot);
    const enqueueRun = vi
      .fn<EnqueueRun>()
      .mockRejectedValueOnce(new Error("connection refused to queue-host"))
      .mockResolvedValue(undefined);
    await build({ readWorkspace: async () => descriptor, begin }, enqueueRun);

    const failed = await app.inject(beginRequest("key-00000003"));
    const retry = await app.inject(beginRequest("key-00000003"));

    expect(failed.statusCode).toBe(503);
    expect(failed.json().error.code).toBe("queue_unavailable");
    expect(failed.body).not.toContain("queue-host");
    expect(retry.statusCode).toBe(201);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(enqueueRun).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["more rounds", { maxRounds: 6 }, "maxRounds"],
    ["a higher cost limit", { maxCostUsd: 3.5 }, "maxCostUsd"],
    ["a longer duration limit", { maxDurationMs: 3_600_000 }, "maxDurationMs"],
  ])("refuses to begin a run with %s than the deployment allows", async (_label, budget, limit) => {
    const begin = vi.fn(async () => snapshot);
    const enqueueRun = vi.fn<EnqueueRun>(async () => undefined);
    await build({ readWorkspace: async () => ({ ...descriptor, ...budget }), begin }, enqueueRun);

    const response = await app.inject(beginRequest("key-00000004"));

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("budget_above_ceiling");
    expect(response.json().error.message).toContain(limit);
    expect(begin).not.toHaveBeenCalled();
    expect(enqueueRun).not.toHaveBeenCalled();
  });

  it("starts a run again once the stored budget is lowered under a dropped ceiling (#1993)", async () => {
    // Created under a higher ceiling: the stored cost limit now sits above the deployment's US$3.
    let stored = { ...descriptor, maxCostUsd: 3.5 };
    const begin = vi.fn(async () => snapshot);
    const configureRunBudget = vi.fn(async (command: { maxCostUsd?: number }) => {
      stored = { ...stored, maxCostUsd: command.maxCostUsd ?? 3 };
      return stored;
    });
    await build({ readWorkspace: async () => stored, begin, configureRunBudget });

    const refused = await app.inject(beginRequest("key-00000005"));
    const lowered = await app.inject({
      method: "PUT",
      url: "/v1/workspaces/workspace-1/budget",
      headers: { authorization },
      payload: { maxRounds: 3, maxCostUsd: 2, maxDurationMs: 600_000 },
    });
    const started = await app.inject(beginRequest("key-00000006"));

    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.code).toBe("budget_above_ceiling");
    expect(lowered.statusCode).toBe(200);
    expect(lowered.json().maxCostUsd).toBe(2);
    expect(started.statusCode).toBe(201);
    expect(begin).toHaveBeenCalledTimes(1);
  });

  it("refuses a reused key with another request, and a missing key", async () => {
    await build({ readWorkspace: async () => descriptor, begin: async () => snapshot });

    await app.inject(beginRequest("key-00000002"));
    const reused = await app.inject(beginRequest("key-00000002", { applicationId: "other" }));
    const missing = await app.inject({
      method: "POST",
      url: "/v1/workspaces/workspace-1/runs",
      headers: { authorization },
      payload: {},
    });

    expect(reused.statusCode).toBe(409);
    expect(reused.json().error.code).toBe("idempotency_conflict");
    expect(missing.statusCode).toBe(400);
  });

  it("reads a run's state with a content-free error", async () => {
    const failed = {
      ...snapshot,
      state: "provider-error",
      executionHistory: [
        { step: "author", status: "completed", route: "vertex-ai" },
        {
          step: "revision",
          status: "completed",
          route: "anthropic-api",
          routeFallback: { from: "vertex-ai", cause: "model-not-offered" },
        },
        { step: "critic", status: "failed", route: "openai-api" },
      ],
      lastError: {
        code: "provider-usage-limit",
        message: "provider text that may quote the prompt",
        provider: "anthropic",
        modelId: "claude-haiku-5-5",
        step: "author",
        attempt: 1,
        maxAttempts: 3,
        retryable: true,
        usageLimitResetsAt: "2026-10-21T11:00:00.000Z",
        failedCall: {
          role: "author",
          company: "anthropic",
          model: "claude-haiku-5-5",
          route: "vertex-ai",
          status: 429,
          providerErrorType: "rate_limit_error",
          rateLimit: "output-tokens",
          retryAfterSeconds: 30,
        },
      },
    } as unknown as RunSnapshot;
    const status = vi.fn(async () => failed);
    await build({ status });

    const response = await app.inject({
      method: "GET",
      url: "/v1/workspaces/workspace-1/runs/run-1",
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    expect(status).toHaveBeenCalledWith({
      root: "/tenants/owner/workspaces/workspace-1",
      runId: "run-1",
    });
    expect(response.json().lastError).toEqual({
      code: "provider-usage-limit",
      retryable: true,
      usageLimitResetsAt: "2026-10-21T11:00:00.000Z",
      failedCall: {
        role: "author",
        company: "anthropic",
        model: "claude-haiku-5-5",
        route: "vertex-ai",
        status: 429,
        providerErrorType: "rate_limit_error",
        providerErrorCode: null,
        rateLimit: "output-tokens",
        retryAfterSeconds: 30,
      },
      failureStage: null,
      diagnostics: [],
      diagnosticCounts: [],
    });
    expect(response.json().routes).toEqual([
      { step: "author", route: "vertex-ai" },
      {
        step: "revision",
        route: "anthropic-api",
        fallback: { from: "vertex-ai", cause: "model-not-offered" },
      },
    ]);
    expect(response.body).not.toContain("provider text");
  });

  it("says where a rejected author output failed, by codes and paths without values", async () => {
    const rejected = {
      ...snapshot,
      state: "provider-error",
      executionHistory: [],
      lastError: {
        code: "invalid-response",
        message: "provider text that may quote the prompt",
        provider: "anthropic",
        modelId: "claude-sonnet-5-5",
        step: "author",
        attempt: 1,
        maxAttempts: 3,
        retryable: true,
        providerRequestId: null,
        failureStage: "artifact-schema-validation",
        failureReason: "artifact-schema-validation",
        diagnostics: [{ code: "invalid_type", path: "sections.0.bullets.2.evidenceIds" }],
        diagnosticCounts: [{ code: "invalid_type", count: 3 }],
      },
    } as unknown as RunSnapshot;
    await build({ status: vi.fn(async () => rejected) });

    const response = await app.inject({
      method: "GET",
      url: "/v1/workspaces/workspace-1/runs/run-1",
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().lastError).toEqual({
      code: "invalid-response",
      retryable: true,
      usageLimitResetsAt: null,
      failureStage: "artifact-schema-validation",
      diagnostics: [{ code: "invalid_type", path: "sections.0.bullets.2.evidenceIds" }],
      diagnosticCounts: [{ code: "invalid_type", count: 3 }],
    });
    expect(response.body).not.toContain("provider text");
  });

  it("answers 404 for an unknown run", async () => {
    await build({ status: async () => undefined });

    const response = await app.inject({
      method: "GET",
      url: "/v1/workspaces/workspace-1/runs/run-9",
      headers: { authorization },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("access", () => {
  beforeEach(async () => {
    await build({});
  });

  it("refuses every application route without the owner token", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/workspaces/workspace-1" });

    expect(response.statusCode).toBe(401);
  });
});
