import {
  type ApplicationService,
  CliUserError,
  type ConfigureKnowledgeSelectionCommand,
  type HostedKnowledgeIntake,
  type InitializeWorkspaceCommand,
  type WorkspaceDescriptor,
  WorkspaceNotFoundError,
} from "@draft-loop/application";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const authorization = `Bearer ${ownerToken}`;
const root = "/tenants/owner/workspaces/workspace-1";

const descriptor = {
  id: "workspace-0b5c",
  root,
  jobDescriptionPath: "job.md",
  sourceDirectory: "sources",
  language: "fr",
  outputFormat: "markdown",
  requiredSections: ["Experience"],
  maxRounds: 2,
  maxCostUsd: 1.5,
  maxDurationMs: 600_000,
  author: { company: "anthropic", model: "claude-sonnet-5-5" },
  critic: { company: "openai", model: "gpt-6-luna" },
  fixtureMode: false,
} as WorkspaceDescriptor;

const missing = async (): Promise<WorkspaceDescriptor> => {
  throw new WorkspaceNotFoundError("/tenants/local/workspaces/owner");
};

let app: FastifyInstance;

const knowledgeIntake = {
  listKnowledgeBases: async () => [{ id: "base-1" }, { id: "base-2" }, { id: "base-empty" }],
  listSources: async (knowledgeBaseId: string) =>
    knowledgeBaseId === "base-empty" ? [] : [{ id: `${knowledgeBaseId}-source` }],
} as unknown as HostedKnowledgeIntake;

async function build(
  methods: Partial<ApplicationService>,
  localModels?: readonly string[],
): Promise<void> {
  app = await buildApi({
    ownerToken,
    ...(localModels === undefined ? {} : { localModels }),
    application: {
      service: methods as ApplicationService,
      workspaceRoot: (workspaceId) => `/tenants/owner/workspaces/${workspaceId}`,
      enqueueRun: async () => undefined,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage: async () => [],
      knowledgeIntake,
      knowledgeStore: { id: "knowledge", reference: "/tenants/owner/knowledge-stores/knowledge" },
    },
  });
}

const create = (payload: unknown, workspaceId = "workspace-1") =>
  app.inject({
    method: "PUT",
    url: `/v1/workspaces/${workspaceId}`,
    headers: { authorization },
    payload: payload as Record<string, unknown>,
  });

afterEach(async () => {
  await app.close();
});

describe("workspace setup", () => {
  it("creates a workspace with hosted models and fixed source settings", async () => {
    const initialize = vi.fn(async (_command: InitializeWorkspaceCommand) => descriptor);
    await build({ readWorkspace: missing, initialize });

    const response = await create({
      language: "fr",
      author: { company: "anthropic", model: "claude-sonnet-5-5" },
      critic: { company: "openai", model: "gpt-6-luna" },
      maxRounds: 2,
      maxCostUsd: 1.5,
      requiredSections: ["Experience"],
      fixtureMode: false,
    });

    expect(response.statusCode).toBe(201);
    expect(initialize.mock.calls[0]?.[0]).toEqual({
      root,
      jobDescription: "job.md",
      sources: "sources",
      language: "fr",
      authorCompany: "anthropic",
      authorModel: "claude-sonnet-5-5",
      criticCompany: "openai",
      criticModel: "gpt-6-luna",
      maxRounds: 2,
      maxCostUsd: 1.5,
      requiredSections: ["Experience"],
      fixtureMode: false,
      autopilot: true,
    });
    // The path's id, never the driver's own: clients address the workspace by it.
    expect(response.json()).toEqual({
      id: "workspace-1",
      language: "fr",
      requiredSections: ["Experience"],
      maxRounds: 2,
      maxCostUsd: 1.5,
      maxDurationMs: 600_000,
      author: { company: "anthropic", model: "claude-sonnet-5-5" },
      critic: { company: "openai", model: "gpt-6-luna" },
      fixtureMode: false,
      autopilot: false,
      knowledgeBaseIds: [],
    });
    expect(response.body).not.toContain("/tenants/");
  });

  it("creates a workspace with two rounds, Claude Sonnet as the author and the driver's other defaults from an empty body", async () => {
    const initialize = vi.fn(async (_command: InitializeWorkspaceCommand) => descriptor);
    await build({ readWorkspace: missing, initialize });

    const response = await create({});

    expect(response.statusCode).toBe(201);
    expect(initialize.mock.calls[0]?.[0]).toEqual({
      root,
      jobDescription: "job.md",
      sources: "sources",
      maxRounds: 2,
      authorCompany: "anthropic",
      authorModel: "claude-sonnet-5-5",
      criticCompany: "openai",
      criticModel: "gpt-6.1-terra",
      autopilot: true,
    });
  });

  it("creates a workspace with autopilot off when the body asks for it", async () => {
    const initialize = vi.fn(async (_command: InitializeWorkspaceCommand) => descriptor);
    await build({ readWorkspace: missing, initialize });

    await create({ autopilot: false });

    expect(initialize.mock.calls[0]?.[0]).toMatchObject({ autopilot: false });
  });

  it("turns a workspace's autopilot on or off (#1969)", async () => {
    const configureAutopilot = vi.fn(async ({ enabled }: { enabled: boolean }) => ({
      ...descriptor,
      ...(enabled ? { autopilot: true as const } : {}),
    }));
    await build({ readWorkspace: async () => descriptor, configureAutopilot });

    const response = await app.inject({
      method: "PUT",
      url: "/v1/workspaces/workspace-1/autopilot",
      headers: { authorization },
      payload: { enabled: true },
    });
    const refused = await app.inject({
      method: "PUT",
      url: "/v1/workspaces/workspace-1/autopilot",
      headers: { authorization },
      payload: { enabled: "yes" },
    });

    expect(response.statusCode).toBe(200);
    expect(configureAutopilot).toHaveBeenCalledWith({ root, enabled: true }, expect.anything());
    expect(response.json()).toMatchObject({ id: "workspace-1", autopilot: true });
    expect(refused.statusCode).toBe(400);
  });

  it("replaces a workspace's run budget within the ceiling (#1993)", async () => {
    const configureRunBudget = vi.fn(async (command: { maxCostUsd?: number }) => ({
      ...descriptor,
      maxRounds: 2,
      ...(command.maxCostUsd === undefined ? {} : { maxCostUsd: command.maxCostUsd }),
    }));
    await build({ readWorkspace: async () => descriptor, configureRunBudget });

    const lowered = await app.inject({
      method: "PUT",
      url: "/v1/workspaces/workspace-1/budget",
      headers: { authorization },
      payload: { maxCostUsd: 2 },
    });
    const aboveCeiling = await app.inject({
      method: "PUT",
      url: "/v1/workspaces/workspace-1/budget",
      headers: { authorization },
      payload: { maxCostUsd: 4 },
    });
    const malformed = await app.inject({
      method: "PUT",
      url: "/v1/workspaces/workspace-1/budget",
      headers: { authorization },
      payload: { maxRounds: 0 },
    });

    expect(lowered.statusCode).toBe(200);
    // A limit left out takes the ceiling's value, so the stored budget always fits a run.
    expect(configureRunBudget).toHaveBeenCalledWith(
      { root, maxRounds: 2, maxCostUsd: 2, maxDurationMs: 1_800_000 },
      expect.anything(),
    );
    expect(lowered.json()).toMatchObject({ id: "workspace-1", maxRounds: 2, maxCostUsd: 2 });
    expect(aboveCeiling.statusCode).toBe(422);
    expect(aboveCeiling.json()).toMatchObject({ error: { code: "budget_above_ceiling" } });
    expect(malformed.statusCode).toBe(400);
    expect(configureRunBudget).toHaveBeenCalledTimes(1);
  });

  it("answers 404 when setting the budget of a workspace that does not exist", async () => {
    const configureRunBudget = vi.fn();
    await build({ readWorkspace: missing, configureRunBudget });

    const response = await app.inject({
      method: "PUT",
      url: "/v1/workspaces/workspace-1/budget",
      headers: { authorization },
      payload: { maxCostUsd: 2 },
    });

    expect(response.statusCode).toBe(404);
    expect(configureRunBudget).not.toHaveBeenCalled();
  });

  it("answers 404 when turning autopilot on for a workspace that does not exist", async () => {
    const configureAutopilot = vi.fn();
    await build({ readWorkspace: missing, configureAutopilot });

    const response = await app.inject({
      method: "PUT",
      url: "/v1/workspaces/workspace-1/autopilot",
      headers: { authorization },
      payload: { enabled: false },
    });

    expect(response.statusCode).toBe(404);
    expect(configureAutopilot).not.toHaveBeenCalled();
  });

  it("fills only the side a request leaves out with the hosted default", async () => {
    const initialize = vi.fn(async (_command: InitializeWorkspaceCommand) => descriptor);
    await build({ readWorkspace: missing, initialize });

    await create({ critic: { company: "openai", model: "gpt-6-luna" } });

    expect(initialize.mock.calls[0]?.[0]).toMatchObject({
      authorCompany: "anthropic",
      authorModel: "claude-sonnet-5-5",
      criticCompany: "openai",
      criticModel: "gpt-6-luna",
    });
  });

  it("never overwrites an existing workspace", async () => {
    const initialize = vi.fn(async () => descriptor);
    await build({ readWorkspace: async () => descriptor, initialize });

    const response = await create({ language: "en" });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("workspace_exists");
    expect(initialize).not.toHaveBeenCalled();
  });

  it("refuses a local model the deployment does not declare, before saving anything", async () => {
    const initialize = vi.fn(async () => descriptor);
    await build({ readWorkspace: missing, initialize });

    const response = await create({ author: { company: "local", model: "qwen3" } });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("model_not_offered");
    expect(initialize).not.toHaveBeenCalled();
  });

  it.each([
    ["a provider the gateway does not route", { critic: { company: "mistral", model: "large" } }],
    ["a local endpoint", { localEndpoint: "http://127.0.0.1:8080" }],
    ["a job file path", { jobDescription: "/etc/passwd" }],
    ["a source folder", { sources: "../other" }],
  ])("refuses %s", async (_name, payload) => {
    const initialize = vi.fn(async () => descriptor);
    await build({ readWorkspace: missing, initialize });

    const response = await create(payload);

    expect(response.statusCode).toBe(400);
    expect(initialize).not.toHaveBeenCalled();
  });

  it("refuses a budget above the deployment's ceiling before saving anything", async () => {
    const initialize = vi.fn(async () => descriptor);
    await build({ readWorkspace: missing, initialize });

    const response = await create({ maxCostUsd: 10 });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: {
        code: "budget_above_ceiling",
        message: "The workspace's maxCostUsd is above this deployment's limit of US$3 per run.",
      },
    });
    expect(initialize).not.toHaveBeenCalled();
  });

  it("refuses a workspace id that could address something else", async () => {
    await build({ readWorkspace: missing });

    const response = await create({}, "..%2Fother");

    expect(response.statusCode).toBe(400);
  });
});

describe("knowledge selection", () => {
  const select = (payload: unknown) =>
    app.inject({
      method: "PUT",
      url: "/v1/workspaces/workspace-1/knowledge-selection",
      headers: { authorization },
      payload: payload as Record<string, unknown>,
    });

  it("selects knowledge bases in the tenant's store, which the client never names", async () => {
    const configureKnowledgeSelection = vi.fn(
      async (_command: ConfigureKnowledgeSelectionCommand) =>
        ({
          ...descriptor,
          candidateKnowledgeSelection: [
            { storeId: "knowledge", knowledgeBaseId: "base-1" },
            { storeId: "knowledge", knowledgeBaseId: "base-2" },
          ],
        }) as WorkspaceDescriptor,
    );
    await build({ configureKnowledgeSelection });

    const response = await select({
      knowledgeBaseIds: ["base-1", "base-2"],
      combinationApproved: true,
    });

    expect(response.statusCode).toBe(200);
    expect(configureKnowledgeSelection.mock.calls[0]?.[0]).toEqual({
      root,
      entries: [
        {
          storeRoot: "/tenants/owner/knowledge-stores/knowledge",
          storeId: "knowledge",
          knowledgeBaseId: "base-1",
        },
        {
          storeRoot: "/tenants/owner/knowledge-stores/knowledge",
          storeId: "knowledge",
          knowledgeBaseId: "base-2",
        },
      ],
      combinationApproved: true,
    });
    expect(response.json().knowledgeBaseIds).toEqual(["base-1", "base-2"]);
    expect(response.body).not.toContain("/tenants/");
  });

  it("answers 404 for a knowledge base the tenant does not have", async () => {
    const configureKnowledgeSelection = vi.fn();
    await build({ configureKnowledgeSelection });

    const response = await select({
      knowledgeBaseIds: ["base-1", "missing"],
      combinationApproved: true,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("knowledge_base_not_found");
    expect(configureKnowledgeSelection).not.toHaveBeenCalled();
  });

  it.each([
    ["several bases without approval", { knowledgeBaseIds: ["base-1", "base-2"] }],
    ["no base", { knowledgeBaseIds: [] }],
    ["the same base twice", { knowledgeBaseIds: ["base-1", "base-1"], combinationApproved: true }],
    ["a store of the client's choosing", { knowledgeBaseIds: ["base-1"], storeRoot: "/other" }],
  ])("refuses %s", async (_name, payload) => {
    const configureKnowledgeSelection = vi.fn();
    await build({ configureKnowledgeSelection });

    const response = await select(payload);

    expect(response.statusCode).toBe(400);
    expect(configureKnowledgeSelection).not.toHaveBeenCalled();
  });

  it("answers 422 for a knowledge base without a source", async () => {
    const configureKnowledgeSelection = vi.fn();
    await build({ configureKnowledgeSelection });

    const response = await select({ knowledgeBaseIds: ["base-empty"] });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("knowledge_base_empty");
    expect(configureKnowledgeSelection).not.toHaveBeenCalled();
  });

  it("answers the service's refusal, such as a base that is not ready, as 422", async () => {
    await build({
      configureKnowledgeSelection: async () => {
        throw new CliUserError("The candidate knowledge selection could not be configured.");
      },
    });

    const response = await select({ knowledgeBaseIds: ["base-1"] });

    expect(response.statusCode).toBe(422);
  });
});

describe("workspace models", () => {
  const change = (payload: unknown, workspaceId = "workspace-1") =>
    app.inject({
      method: "PATCH",
      url: `/v1/workspaces/${workspaceId}/models`,
      headers: { authorization },
      payload: payload as Record<string, unknown>,
    });
  const pair = {
    author: { company: "openai", model: "gpt-6.1-sol" },
    critic: { company: "anthropic", model: "claude-sonnet-5-5" },
  };

  it("changes the pair for the next runs, with the reason for one lineage when given", async () => {
    const reconfigureModels = vi.fn(async () => ({
      ...descriptor,
      author: pair.author,
      critic: pair.critic,
    }));
    await build({ readWorkspace: async () => descriptor, reconfigureModels });

    const response = await change({ ...pair, independenceOverrideRationale: "Checked by hand." });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ author: pair.author, critic: pair.critic });
    expect(reconfigureModels).toHaveBeenCalledWith(
      {
        root,
        authorCompany: "openai",
        authorModel: "gpt-6.1-sol",
        criticCompany: "anthropic",
        criticModel: "claude-sonnet-5-5",
        independenceOverrideRationale: "Checked by hand.",
      },
      expect.anything(),
    );
  });

  it("refuses a local model the deployment does not declare, and any endpoint", async () => {
    const reconfigureModels = vi.fn();
    await build({ readWorkspace: async () => descriptor, reconfigureModels }, ["qwen3:32b"]);

    const local = await change({ ...pair, author: { company: "local", model: "llama-4" } });
    const endpoint = await change({ ...pair, localEndpoint: "http://127.0.0.1:11434" });
    const unknown = await change({ ...pair, author: { company: "zai", model: "glm-5.3" } });

    expect(local.statusCode).toBe(422);
    expect(local.json()).toMatchObject({ error: { code: "model_not_offered" } });
    expect(endpoint.statusCode).toBe(400);
    expect(unknown.statusCode).toBe(400);
    expect(reconfigureModels).not.toHaveBeenCalled();
  });

  it("accepts a declared local model on either side, with no endpoint", async () => {
    const localPair = {
      author: { company: "local", model: "qwen3:32b" },
      critic: { company: "openai", model: "gpt-6.1-terra" },
    };
    const reconfigureModels = vi.fn(async () => ({ ...descriptor, ...localPair }));
    await build({ readWorkspace: async () => descriptor, reconfigureModels }, ["qwen3:32b"]);

    const response = await change(localPair);

    expect(response.statusCode).toBe(200);
    expect(reconfigureModels).toHaveBeenCalledWith(
      {
        root,
        authorCompany: "local",
        authorModel: "qwen3:32b",
        criticCompany: "openai",
        criticModel: "gpt-6.1-terra",
      },
      expect.anything(),
    );
  });

  it("answers 404 for an unknown workspace and the service's refusal as 422", async () => {
    await build({ readWorkspace: missing });
    expect((await change(pair)).statusCode).toBe(404);
    await app.close();

    await build({
      readWorkspace: async () => descriptor,
      reconfigureModels: async () => {
        throw new CliUserError("author and critic must use different model lineages");
      },
    });
    expect((await change(pair)).statusCode).toBe(422);
  });
});
