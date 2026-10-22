import {
  type ApplicationService,
  CliUserError,
  type InitializeWorkspaceCommand,
  type WorkspaceDescriptor,
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
  throw new CliUserError("No DraftLoop workspace found. Run draft-loop init first.");
};

let app: FastifyInstance;

async function build(methods: Partial<ApplicationService>): Promise<void> {
  app = await buildApi({
    ownerToken,
    application: {
      service: methods as ApplicationService,
      workspaceRoot: (workspaceId) => `/tenants/owner/workspaces/${workspaceId}`,
      enqueueRun: async () => undefined,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage: async () => [],
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
    });
    expect(response.body).not.toContain("/tenants/");
  });

  it("creates a workspace with the driver's defaults from an empty body", async () => {
    const initialize = vi.fn(async (_command: InitializeWorkspaceCommand) => descriptor);
    await build({ readWorkspace: missing, initialize });

    const response = await create({});

    expect(response.statusCode).toBe(201);
    expect(initialize.mock.calls[0]?.[0]).toEqual({
      root,
      jobDescription: "job.md",
      sources: "sources",
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
