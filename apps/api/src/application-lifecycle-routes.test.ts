import type { ApplicationService, ApplicationView } from "@draft-loop/application";
import { CliUserError } from "@draft-loop/application";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const authorization = `Bearer ${ownerToken}`;
const at = "2026-10-25T00:00:00.000Z";
const root = "/tenants/owner/workspaces/workspace-1";
const base = "/v1/workspaces/workspace-1/applications";

const created = {
  schemaVersion: 1,
  id: "app-platform",
  name: "Example Ledger platform engineer",
  jobSource: { kind: "stored-text", text: "Platform Engineer at Example Ledger" },
  createdAt: at,
  updatedAt: at,
  status: "drafting",
  isDefault: false,
  briefs: [],
  runs: [{ id: "run-1", state: "awaiting-approval", startedAt: at, updatedAt: at }],
  exports: [],
  archivedAt: null,
  nameChosen: true,
  suggestedName: null,
  modelProfiles: null,
  chosenRun: null,
} as unknown as ApplicationView;

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

async function build(methods: Partial<ApplicationService>): Promise<void> {
  app = await buildApi({
    ownerToken,
    application: {
      service: scriptedService(methods),
      workspaceRoot: (workspaceId) => `/tenants/owner/workspaces/${workspaceId}`,
      enqueueRun: async () => undefined,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage: async () => [],
    },
  });
}

afterEach(async () => {
  await app.close();
});

describe("application lifecycle", () => {
  it("creates an application from pasted text and shows it as pasted, without the text", async () => {
    const createApplication = vi.fn(async () => created);
    await build({ createApplication });

    const response = await app.inject({
      method: "POST",
      url: base,
      headers: { authorization },
      payload: { name: "Example Ledger platform engineer", jobText: "Platform Engineer" },
    });

    expect(response.statusCode).toBe(201);
    expect(createApplication).toHaveBeenCalledWith({
      root,
      name: "Example Ledger platform engineer",
      jobSource: { kind: "pasted-text", text: "Platform Engineer" },
    });
    expect(response.json()).toMatchObject({
      id: "app-platform",
      jobSourceKind: "pasted-text",
      exportCount: 0,
      modelProfiles: null,
      suggestedName: null,
    });
    expect(response.body).not.toContain("Example Ledger</");
    expect(response.json()).not.toHaveProperty("jobSource");
  });

  it("refuses an empty job or a body with unknown fields", async () => {
    const createApplication = vi.fn();
    await build({ createApplication });

    const empty = await app.inject({
      method: "POST",
      url: base,
      headers: { authorization },
      payload: { name: "Platform", jobText: "   " },
    });
    const path = await app.inject({
      method: "POST",
      url: base,
      headers: { authorization },
      payload: { name: "Platform", jobText: "x", path: "/etc/passwd" },
    });

    expect(empty.statusCode).toBe(400);
    expect(path.statusCode).toBe(400);
    expect(createApplication).not.toHaveBeenCalled();
  });

  it("renames and archives in one request, and answers 404 for an unknown application", async () => {
    const renameApplication = vi.fn(async () => ({ ...created, name: "Platform" }));
    const archiveApplication = vi.fn(async () => ({
      ...created,
      name: "Platform",
      archivedAt: at,
    }));
    const getApplication = vi.fn(async ({ applicationId }: { readonly applicationId: string }) =>
      applicationId === "app-platform" ? created : undefined,
    );
    await build({ getApplication, renameApplication, archiveApplication });

    const updated = await app.inject({
      method: "PATCH",
      url: `${base}/app-platform`,
      headers: { authorization },
      payload: { name: "Platform", archived: true },
    });
    const missing = await app.inject({
      method: "PATCH",
      url: `${base}/missing`,
      headers: { authorization },
      payload: { archived: false },
    });
    const empty = await app.inject({
      method: "PATCH",
      url: `${base}/app-platform`,
      headers: { authorization },
      payload: {},
    });

    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ name: "Platform", archivedAt: at });
    expect(renameApplication).toHaveBeenCalledWith({
      root,
      applicationId: "app-platform",
      name: "Platform",
    });
    expect(archiveApplication).toHaveBeenCalledWith({
      root,
      applicationId: "app-platform",
      archived: true,
    });
    expect(missing.statusCode).toBe(404);
    expect(empty.statusCode).toBe(400);
  });

  it("sets and clears the model pair, and passes a refused pair on as 422", async () => {
    const pair = {
      author: { id: "standard-anthropic-author", version: 1 },
      critic: { id: "standard-openai-critic", version: 1 },
    };
    const setApplicationModels = vi.fn(
      async ({ modelProfiles }: { readonly modelProfiles: typeof pair | null }) => {
        if (modelProfiles?.critic.id === "same-company") {
          throw new CliUserError(
            "An application's author and critic must come from different companies.",
          );
        }
        return { ...created, modelProfiles };
      },
    );
    await build({ getApplication: async () => created, setApplicationModels });

    const set = await app.inject({
      method: "PUT",
      url: `${base}/app-platform/models`,
      headers: { authorization },
      payload: { modelProfiles: pair },
    });
    const cleared = await app.inject({
      method: "PUT",
      url: `${base}/app-platform/models`,
      headers: { authorization },
      payload: { modelProfiles: null },
    });
    const refused = await app.inject({
      method: "PUT",
      url: `${base}/app-platform/models`,
      headers: { authorization },
      payload: { modelProfiles: { ...pair, critic: { id: "same-company", version: 1 } } },
    });

    expect(set.json().modelProfiles).toEqual(pair);
    expect(cleared.json().modelProfiles).toBeNull();
    expect(refused.statusCode).toBe(422);
  });

  it("chooses an application's run with an optional reason", async () => {
    const chooseApplicationRun = vi.fn(async () => ({
      ...created,
      chosenRun: { runId: "run-1", chosenAt: at, reason: null },
    }));
    await build({ getApplication: async () => created, chooseApplicationRun });

    const response = await app.inject({
      method: "PUT",
      url: `${base}/app-platform/chosen-run`,
      headers: { authorization },
      payload: { runId: "run-1", reason: "Tighter summary." },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().chosenRunId).toBe("run-1");
    expect(chooseApplicationRun).toHaveBeenCalledWith({
      root,
      applicationId: "app-platform",
      runId: "run-1",
      reason: "Tighter summary.",
    });
  });

  it("reads back the pasted job, an approved address, or nothing for a file job", async () => {
    const views: Record<string, ApplicationView> = {
      pasted: created,
      page: {
        ...created,
        jobSource: { kind: "approved-url", url: "https://jobs.example.test/1", approved: true },
      },
      file: { ...created, jobSource: { kind: "local-file", path: "job.md" } },
    };
    await build({
      getApplication: async ({ applicationId }) => views[applicationId],
    });

    const read = async (id: string) =>
      (
        await app.inject({ method: "GET", url: `${base}/${id}/job`, headers: { authorization } })
      ).json();

    expect(await read("pasted")).toEqual({
      origin: "pasted-text",
      text: "Platform Engineer at Example Ledger",
      url: null,
    });
    expect(await read("page")).toEqual({
      origin: "url",
      text: null,
      url: "https://jobs.example.test/1",
    });
    expect(await read("file")).toEqual({ origin: "unavailable", text: null, url: null });
  });
});
