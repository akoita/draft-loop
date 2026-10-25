import { createCapabilityPort } from "@draft-loop/ui/bridge";
import { describe, expect, it, vi } from "vitest";

import { type ApiClient, ApiRequestError, type ApiSchemas } from "./api-client.js";
import { createHttpBridge, hostedBridgeCapabilities } from "./http-bridge.js";
import { syntheticBrief, syntheticRun } from "./test-fixtures.js";

const workspaceId = "owner";

/** Fictional applications in the API's shape; no real candidate or employer. */
const defaultApplication: ApiSchemas["Application"] = {
  id: "default",
  name: "Default application",
  nameChosen: false,
  status: "drafting",
  isDefault: true,
  archivedAt: null,
  createdAt: "2026-10-23T00:00:00.000Z",
  updatedAt: "2026-10-23T00:00:00.000Z",
  briefs: [],
  runs: [],
  chosenRunId: null,
  jobSourceKind: "pasted-text",
  suggestedName: null,
  exportCount: 0,
  modelProfiles: null,
};

const ledgerApplication: ApiSchemas["Application"] = {
  ...defaultApplication,
  id: "app-ledger",
  name: "Example Ledger platform engineer",
  nameChosen: true,
  isDefault: false,
  briefs: [
    { briefId: "brief-old", latestVersion: 1, status: "draft", createdAt: "2026-10-23T00:00:00Z" },
    { briefId: "brief-1", latestVersion: 2, status: "draft", createdAt: "2026-10-23T02:00:00Z" },
  ],
  runs: [
    {
      id: "run-2",
      state: "drafting",
      startedAt: "2026-10-23T03:00:00Z",
      updatedAt: "2026-10-23T03:00:00Z",
    },
    {
      id: "run-1",
      state: "awaiting-approval",
      startedAt: "2026-10-23T01:00:00Z",
      updatedAt: "2026-10-23T01:00:00Z",
    },
  ],
  chosenRunId: "run-1",
  exportCount: 1,
};

const opportunity: ApiSchemas["Opportunity"] = {
  workspaceId,
  checksum: "a".repeat(64),
  brief: syntheticBrief as ApiSchemas["Opportunity"]["brief"],
};

const catalog: ApiSchemas["ModelCatalog"] = {
  models: [
    {
      id: "economy-anthropic-author",
      version: 1,
      company: "anthropic",
      model: "claude-sonnet-5-5",
      tier: "economy",
      roles: ["author"],
      qualityStatus: "unvalidated",
      pricing: {
        inputUsdPerMillion: 2,
        outputUsdPerMillion: 10,
        cacheReadUsdPerMillion: 0.2,
        cacheWriteUsdPerMillion: 4,
        maxInputTokens: 1_000_000,
      },
    },
    {
      id: "standard-openai-critic",
      version: 2,
      company: "openai",
      model: "gpt-6.1-sol",
      tier: "standard",
      roles: ["critic"],
      qualityStatus: "unvalidated",
      pricing: {
        inputUsdPerMillion: 2,
        outputUsdPerMillion: 10,
        cacheReadUsdPerMillion: 0.1,
        cacheWriteUsdPerMillion: 2.5,
        maxInputTokens: 272_000,
      },
    },
  ],
  presets: [],
  defaultPresetId: "balanced",
};

type Handler = (input: Record<string, unknown>) => unknown;

/** A client that answers only the operations a test scripts and records every call. */
function scriptedClient(handlers: Readonly<Record<string, Handler>>) {
  const calls: { operation: string; input: Record<string, unknown> }[] = [];
  const client: ApiClient = {
    call: async (operation, input) => {
      calls.push({ operation, input: input as Record<string, unknown> });
      const handler = handlers[operation];
      if (handler === undefined) throw new Error(`unexpected call: ${operation}`);
      return (await handler(input as Record<string, unknown>)) as never;
    },
  };
  return { client, calls };
}

function portOver(handlers: Readonly<Record<string, Handler>>, onRefusal = vi.fn()) {
  const { client, calls } = scriptedClient(handlers);
  const port = createCapabilityPort(
    createHttpBridge({ client, onRefusal, idempotencyKey: () => "run-key-0001" }),
  );
  return { port, calls, onRefusal };
}

const listed = () => ({ applications: [defaultApplication, ledgerApplication] });

describe("the shared screens' commands over HTTP", () => {
  it("advertises only what the hosted service serves, and answers anything else unavailable", async () => {
    const { port, calls } = portOver({});

    expect(port.capabilities).toEqual([...hostedBridgeCapabilities]);
    for (const desktopOnly of ["workspace.open", "knowledge.import-directory", "credential.set"]) {
      expect(port.hasCapability(desktopOnly as never)).toBe(false);
    }
    const result = await port.execute({ type: "workspace.open", input: {} });

    expect(result).toMatchObject({ ok: false, error: { code: "capability-unavailable" } });
    expect(calls).toEqual([]);
  });

  it("lists applications in the desktop's summary, with run counts, the newest run and the chosen run's number", async () => {
    const { port } = portOver({ "GET /v1/workspaces/{workspaceId}/applications": listed });

    const result = await port.execute({ type: "application.list", input: { workspaceId } });

    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.applications[1]).toMatchObject({
      id: "app-ledger",
      runCount: 2,
      briefCount: 2,
      exportCount: 1,
      latestRunId: "run-2",
      chosenRun: { runId: "run-1", runNumber: 1 },
      jobSourceKind: "pasted-text",
    });
    expect(result.value.applications[0]).not.toHaveProperty("chosenRun");
  });

  it("creates an application from pasted text, and refuses a job page address before any request", async () => {
    const { port, calls } = portOver({
      "POST /v1/workspaces/{workspaceId}/applications": () => ledgerApplication,
    });

    const created = await port.execute({
      type: "application.create",
      input: { workspaceId, name: "Example Ledger", jobText: "Platform Engineer" },
    });
    const address = await port.execute({
      type: "application.create",
      input: {
        workspaceId,
        name: "Example",
        jobUrl: "https://jobs.example.test/1",
        jobUrlApproved: true,
      },
    });

    expect(created).toMatchObject({
      ok: true,
      value: { workspaceId, application: { id: "app-ledger" } },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toMatchObject({
      body: { name: "Example Ledger", jobText: "Platform Engineer" },
    });
    expect(address).toMatchObject({
      ok: false,
      error: {
        code: "operation-failed",
        message: "The hosted service takes a job as pasted text only.",
      },
    });
  });

  it("renames, archives, pairs and chooses a run through the application routes", async () => {
    const { port, calls } = portOver({
      "PATCH /v1/workspaces/{workspaceId}/applications/{applicationId}": () => ledgerApplication,
      "PUT /v1/workspaces/{workspaceId}/applications/{applicationId}/models": () =>
        ledgerApplication,
      "PUT /v1/workspaces/{workspaceId}/applications/{applicationId}/chosen-run": () =>
        ledgerApplication,
    });
    const applicationId = "app-ledger";

    for (const command of [
      { type: "application.rename", input: { workspaceId, applicationId, name: "Ledger" } },
      { type: "application.archive", input: { workspaceId, applicationId, archived: true } },
      {
        type: "application.set-models",
        input: { workspaceId, applicationId, modelProfiles: null },
      },
      { type: "application.choose-run", input: { workspaceId, applicationId, runId: "run-1" } },
    ] as const) {
      expect((await port.execute(command)).ok).toBe(true);
    }
    expect(calls.map(({ input }) => input.body)).toEqual([
      { name: "Ledger" },
      { archived: true },
      { modelProfiles: null },
      { runId: "run-1" },
    ]);
  });

  it("reads the default application's job when none is named", async () => {
    const { port, calls } = portOver({
      "GET /v1/workspaces/{workspaceId}/applications": listed,
      "GET /v1/workspaces/{workspaceId}/applications/{applicationId}/job": () => ({
        origin: "pasted-text",
        text: "Platform Engineer",
        url: null,
      }),
    });

    const result = await port.execute({ type: "application.job", input: { workspaceId } });

    expect(result).toEqual({
      ok: true,
      value: {
        workspaceId,
        origin: "pasted-text",
        text: "Platform Engineer",
        truncated: false,
        url: null,
      },
    });
    expect(calls[1]?.input).toMatchObject({ path: { applicationId: "default" } });
  });

  it("creates, reads, lists, edits and reviews a brief, projected as the desktop projects it", async () => {
    const { port, calls } = portOver({
      "POST /v1/workspaces/{workspaceId}/opportunities": () => opportunity,
      "GET /v1/workspaces/{workspaceId}/opportunities/{briefId}": ({ query }) => {
        const version = (query as { version?: number } | undefined)?.version ?? 2;
        return {
          ...opportunity,
          brief: {
            ...opportunity.brief,
            version,
            priorVersion: version === 1 ? null : version - 1,
          },
        };
      },
      "GET /v1/workspaces/{workspaceId}/opportunities/{briefId}/versions": () => ({
        versions: [
          { version: 1, status: "draft", createdAt: "2026-10-23T00:00:00Z", reviewedAt: null },
          { version: 2, status: "draft", createdAt: "2026-10-23T00:00:00Z", reviewedAt: null },
        ],
      }),
      "PATCH /v1/workspaces/{workspaceId}/opportunities/{briefId}": () => opportunity,
      "POST /v1/workspaces/{workspaceId}/opportunities/{briefId}/review": () => opportunity,
    });
    const source = {
      id: "job-posting",
      kind: "pasted-content",
      classification: "job-posting",
      content: "Platform Engineer at Example Ledger",
    } as const;

    const created = await port.execute({
      type: "opportunity.create",
      input: { workspaceId, sources: [source], applicationId: "app-ledger" },
    });
    const listedVersions = await port.execute({
      type: "opportunity.list",
      input: { workspaceId, briefId: "brief-1" },
    });
    const edited = await port.execute({
      type: "opportunity.edit",
      input: {
        workspaceId,
        briefId: "brief-1",
        expectedVersion: 2,
        patch: { candidateEmployer: "Example Ledger" },
      },
    });
    const reviewed = await port.execute({
      type: "opportunity.review",
      input: { workspaceId, briefId: "brief-1", expectedVersion: 2 },
    });

    if (!created.ok) throw new Error(created.error.message);
    expect(created.value).toMatchObject({
      workspaceId,
      briefId: "brief-1",
      version: 2,
      checksum: "a".repeat(64),
      role: { value: "Platform Engineer", sourceIds: ["job-posting"] },
      requirements: [{ id: "req-1", priority: "critical" }],
    });
    expect(calls[0]?.input).toMatchObject({
      body: { sources: [source], applicationId: "app-ledger" },
    });
    expect(listedVersions.ok && listedVersions.value.versions).toHaveLength(2);
    expect(calls.slice(2, 4).map(({ input }) => input.query)).toEqual([
      { version: 1 },
      { version: 2 },
    ]);
    expect(edited.ok && reviewed.ok).toBe(true);
  });

  it("refuses a job page or file source, which needs the desktop", async () => {
    const { port, calls } = portOver({});

    const result = await port.execute({
      type: "opportunity.create",
      input: {
        workspaceId,
        sources: [
          {
            id: "job-page",
            kind: "approved-url",
            classification: "job-posting",
            url: "https://jobs.example.test/1",
            approved: true,
          },
        ],
      },
    });

    expect(result).toMatchObject({ ok: false, error: { code: "operation-failed" } });
    expect(calls).toEqual([]);
  });

  it("summarizes an application's newest brief, or answers none before the first", async () => {
    const { port, calls } = portOver({
      "GET /v1/workspaces/{workspaceId}/applications/{applicationId}": ({ path }) =>
        (path as { applicationId: string }).applicationId === "app-ledger"
          ? ledgerApplication
          : defaultApplication,
      "GET /v1/workspaces/{workspaceId}/opportunities/{briefId}": () => opportunity,
    });

    const latest = await port.execute({
      type: "opportunity.latest",
      input: { workspaceId, applicationId: "app-ledger" },
    });
    const none = await port.execute({
      type: "opportunity.latest",
      input: { workspaceId, applicationId: "default" },
    });

    expect(latest).toEqual({
      ok: true,
      value: {
        workspaceId,
        briefId: "brief-1",
        version: 2,
        status: "draft",
        requirementCount: 1,
        criticalCount: 1,
      },
    });
    expect(calls[1]?.input).toMatchObject({ path: { briefId: "brief-1" } });
    expect(none).toEqual({ ok: true, value: null });
  });

  it("begins a run with an idempotency key and reads queued work as drafting", async () => {
    const { port, calls } = portOver({
      "POST /v1/workspaces/{workspaceId}/runs": () => ({
        ...syntheticRun,
        state: "collecting",
        round: 0,
      }),
    });

    const result = await port.execute({
      type: "run.start",
      input: {
        workspaceId,
        applicationId: "app-ledger",
        opportunityBrief: { briefId: "brief-1", version: 2 },
      },
    });
    const withProfile = await port.execute({
      type: "run.start",
      input: { workspaceId, candidateProfile: { profileId: "profile-1", version: 1 } },
    });

    expect(result).toEqual({
      ok: true,
      value: { workspaceId, runId: "run-1", state: "drafting", round: 0, approval: "pending" },
    });
    expect(calls[0]?.input).toEqual({
      path: { workspaceId },
      header: { "idempotency-key": "run-key-0001" },
      body: { applicationId: "app-ledger", opportunityBrief: { briefId: "brief-1", version: 2 } },
    });
    expect(withProfile).toMatchObject({ ok: false, error: { code: "operation-failed" } });
    expect(calls).toHaveLength(1);
  });

  it("reads the workspace's newest run when none is named, and no run before the first", async () => {
    const { port, calls } = portOver({
      "GET /v1/workspaces/{workspaceId}/applications": listed,
      "GET /v1/workspaces/{workspaceId}/runs/{runId}": ({ path }) => ({
        ...syntheticRun,
        runId: (path as { runId: string }).runId,
      }),
    });
    const empty = portOver({
      "GET /v1/workspaces/{workspaceId}/applications": () => ({
        applications: [defaultApplication],
      }),
    });

    const newest = await port.execute({ type: "run.status", input: { workspaceId } });
    const none = await empty.port.execute({ type: "run.status", input: { workspaceId } });

    expect(newest).toMatchObject({ ok: true, value: { runId: "run-2", state: "reviewing" } });
    expect(calls[1]?.input).toMatchObject({ path: { runId: "run-2" } });
    expect(none).toEqual({
      ok: true,
      value: { workspaceId, runId: null, state: "collecting", round: 0, approval: "pending" },
    });
  });

  it("pauses, resumes and stops a run, resuming with its own idempotency key", async () => {
    const answer = () => syntheticRun;
    const { port, calls } = portOver({
      "POST /v1/workspaces/{workspaceId}/runs/{runId}/pause": answer,
      "POST /v1/workspaces/{workspaceId}/runs/{runId}/resume": answer,
      "POST /v1/workspaces/{workspaceId}/runs/{runId}/stop": answer,
    });

    for (const type of ["run.pause", "run.resume", "run.stop"] as const) {
      expect((await port.execute({ type, input: { workspaceId, runId: "run-1" } })).ok).toBe(true);
    }
    expect(calls.map(({ operation }) => operation.split("/").at(-1))).toEqual([
      "pause",
      "resume",
      "stop",
    ]);
    expect(calls[1]?.input).toMatchObject({ header: { "idempotency-key": "run-key-0001" } });
  });

  it("lists a company's models and the profiles the hosted service runs, from its catalog", async () => {
    const { port, calls } = portOver({ "GET /v1/model-catalog": () => catalog });

    const models = await port.execute({ type: "models.list", input: { provider: "anthropic" } });
    const local = await port.execute({ type: "models.list", input: { provider: "local" } });
    const support = await port.execute({ type: "models.profile-support", input: { workspaceId } });
    const independence = await port.execute({
      type: "models.preview-independence",
      input: {
        author: { company: "anthropic", modelId: "claude-sonnet-5-5" },
        critic: { company: "openai", modelId: "gpt-6.1-sol" },
      },
    });

    expect(models).toMatchObject({
      ok: true,
      value: { provider: "anthropic", models: [{ id: "claude-sonnet-5-5" }] },
    });
    expect(local).toMatchObject({ ok: false, error: { code: "operation-failed" } });
    expect(support).toEqual({
      ok: true,
      value: {
        workspaceId,
        authModes: { anthropic: "api-key", openai: "api-key" },
        profiles: [
          { id: "economy-anthropic-author", version: 1, supported: true },
          { id: "standard-openai-critic", version: 2, supported: true },
        ],
      },
    });
    expect(independence).toMatchObject({ ok: true, value: { lineagesDistinct: true } });
    expect(calls).toHaveLength(2);
  });

  it("passes an API refusal on with its message, and its own code to the shell", async () => {
    const credits = new ApiRequestError(
      402,
      "credits_insufficient",
      "Not enough credits for this run.",
    );
    const { port, onRefusal } = portOver({
      "POST /v1/workspaces/{workspaceId}/runs": () => {
        throw credits;
      },
      "GET /v1/workspaces/{workspaceId}/applications/{applicationId}": () => {
        throw new ApiRequestError(404, "not_found", "No such application.");
      },
    });

    const refused = await port.execute({ type: "run.start", input: { workspaceId } });
    const missing = await port.execute({
      type: "application.get",
      input: { workspaceId, applicationId: "missing" },
    });

    expect(refused).toEqual({
      ok: false,
      error: {
        code: "operation-failed",
        message: "Not enough credits for this run.",
        capability: "run.start",
      },
    });
    expect(onRefusal).toHaveBeenCalledWith(credits);
    expect(missing).toMatchObject({
      ok: false,
      error: { code: "not-found", message: "No such application." },
    });
  });

  it("loads the review the server projects, for the workspace on screen or the one named", async () => {
    const projected = { workspaceId: "candidate-7", runId: "pending", state: "collecting" };
    const { client, calls } = scriptedClient({
      "GET /v1/workspaces/{workspaceId}/review-state": () => projected,
    });
    const bridge = createHttpBridge({ client, workspaceId: "candidate-7" });

    const onScreen = await bridge.invoke({
      type: "review.load",
      input: { applicationId: "app-ledger" },
    });
    await bridge.invoke({ type: "review.load", input: { workspaceId, runId: "run-1" } });

    expect(onScreen).toEqual({ ok: true, value: projected });
    expect(calls).toEqual([
      {
        operation: "GET /v1/workspaces/{workspaceId}/review-state",
        input: {
          path: { workspaceId: "candidate-7" },
          query: { applicationId: "app-ledger" },
        },
      },
      {
        operation: "GET /v1/workspaces/{workspaceId}/review-state",
        input: { path: { workspaceId }, query: { runId: "run-1" } },
      },
    ]);
  });

  it("answers a review of a run the application does not hold as not found", async () => {
    const { port } = portOver({
      "GET /v1/workspaces/{workspaceId}/review-state": () => {
        throw new ApiRequestError(
          404,
          "not_found",
          "That run does not belong to this application.",
        );
      },
    });

    const result = await port.execute({
      type: "review.load",
      input: { applicationId: "app-ledger", runId: "run-elsewhere" },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "not-found", message: "That run does not belong to this application." },
    });
  });

  it("changes the workspace's models over the API, refusing what the gateway cannot route", async () => {
    const changed = {
      id: "workspace-0b5c",
      language: "en",
      requiredSections: ["Experience"],
      maxRounds: 2,
      author: { company: "openai", model: "gpt-6.1-sol" },
      critic: { company: "anthropic", model: "claude-sonnet-5-5" },
      fixtureMode: true,
      knowledgeBaseIds: [],
    } as ApiSchemas["Workspace"];
    const { port, calls } = portOver({
      "PATCH /v1/workspaces/{workspaceId}/models": () => changed,
    });
    const selection = {
      workspaceId,
      authorCompany: "openai",
      authorModel: "gpt-6.1-sol",
      criticCompany: "anthropic",
      criticModel: "claude-sonnet-5-5",
    } as const;

    const result = await port.execute({ type: "workspace.configure-models", input: selection });
    const local = await port.execute({
      type: "workspace.configure-models",
      input: { ...selection, authorCompany: "local", localEndpoint: "http://127.0.0.1:11434" },
    });

    expect(result).toEqual({
      ok: true,
      value: {
        workspaceId,
        authorCompany: "openai",
        authorModel: "gpt-6.1-sol",
        criticCompany: "anthropic",
        criticModel: "claude-sonnet-5-5",
        localEndpoint: null,
      },
    });
    expect(calls).toEqual([
      {
        operation: "PATCH /v1/workspaces/{workspaceId}/models",
        input: {
          path: { workspaceId },
          body: {
            author: { company: "openai", model: "gpt-6.1-sol" },
            critic: { company: "anthropic", model: "claude-sonnet-5-5" },
          },
        },
      },
    ]);
    expect(local).toMatchObject({ ok: false, error: { code: "operation-failed" } });
  });

  it("opens the policy editor on the saved policy, or on the template when none is saved", async () => {
    const saved = {
      checksum: "c".repeat(64),
      version: `sha256:${"c".repeat(12)}`,
      createdAt: "2026-10-23T08:00:00.000Z",
      priorChecksum: null,
      content: "# Writing policy\n\nKeep each bullet to one sentence.",
    };
    let stored: typeof saved | undefined;
    const { port } = portOver({
      "GET /v1/workspaces/{workspaceId}/writing-policy": () => {
        if (stored === undefined) {
          throw new ApiRequestError(404, "not_found", "The workspace has no writing policy.");
        }
        return stored;
      },
      "GET /v1/writing-policy-template": () => ({ content: "# Default CV writing policy\n" }),
      "PUT /v1/workspaces/{workspaceId}/writing-policy": (input) => {
        stored = { ...saved, content: (input.body as { content: string }).content };
        return stored;
      },
    });

    const template = await port.execute({ type: "writing-policy.read", input: { workspaceId } });
    const written = await port.execute({
      type: "writing-policy.save",
      input: { workspaceId, content: saved.content },
    });
    const reread = await port.execute({ type: "writing-policy.read", input: { workspaceId } });

    expect(template).toEqual({
      ok: true,
      value: {
        workspaceId,
        content: "# Default CV writing policy\n",
        version: null,
        checksum: null,
        isDefaultTemplate: true,
      },
    });
    expect(written).toEqual({
      ok: true,
      value: { workspaceId, version: saved.version, checksum: saved.checksum },
    });
    expect(reread).toMatchObject({
      ok: true,
      value: { content: saved.content, checksum: saved.checksum, isDefaultTemplate: false },
    });
  });
});
