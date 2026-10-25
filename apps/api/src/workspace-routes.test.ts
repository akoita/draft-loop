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
  listKnowledgeBases: async () => [{ id: "base-1" }, { id: "base-2" }],
} as unknown as HostedKnowledgeIntake;

async function build(methods: Partial<ApplicationService>): Promise<void> {
  app = await buildApi({
    ownerToken,
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
    });
    expect(response.json()).toEqual({
      id: "workspace-0b5c",
      language: "fr",
      requiredSections: ["Experience"],
      maxRounds: 2,
      author: { company: "anthropic", model: "claude-sonnet-5-5" },
      critic: { company: "openai", model: "gpt-6-luna" },
      fixtureMode: false,
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
      criticModel: "gpt-6.1-sol",
    });
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

  it.each([
    ["a local model", { author: { company: "local", model: "qwen3" } }],
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

  it("routes only Anthropic and OpenAI models, and never a local endpoint", async () => {
    const reconfigureModels = vi.fn();
    await build({ readWorkspace: async () => descriptor, reconfigureModels });

    const local = await change({ ...pair, author: { company: "local", model: "llama-4" } });
    const endpoint = await change({ ...pair, localEndpoint: "http://127.0.0.1:11434" });

    expect(local.statusCode).toBe(400);
    expect(endpoint.statusCode).toBe(400);
    expect(reconfigureModels).not.toHaveBeenCalled();
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
