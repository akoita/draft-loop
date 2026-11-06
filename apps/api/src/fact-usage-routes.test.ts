import type { ApplicationService } from "@draft-loop/application";
import { createFactUsageService, factUsageKey } from "@draft-loop/application/fact-usage";
import type { WorkspaceSettingName, WorkspaceSettingsPort } from "@draft-loop/storage";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const authorization = `Bearer ${ownerToken}`;
const base = "/v1/workspaces/workspace-1/fact-usage";
const key = factUsageKey({ category: "achievement", field: "salary", value: "high" });

let app: FastifyInstance;

function memorySettings(): WorkspaceSettingsPort & { docs: Map<string, string> } {
  const docs = new Map<string, string>();
  const id = (workspace: string, name: WorkspaceSettingName) => `${workspace}|${name}`;
  return {
    docs,
    read: async (workspace, name) => docs.get(id(workspace, name)),
    write: async (workspace, name, content) => void docs.set(id(workspace, name), content),
    remove: async (workspace, name) => docs.delete(id(workspace, name)),
  };
}

async function build(settings?: WorkspaceSettingsPort): Promise<void> {
  app = await buildApi({
    ownerToken,
    application: {
      service: {} as ApplicationService,
      workspaceRoot: (workspaceId) => `/tenants/owner/workspaces/${workspaceId}`,
      enqueueRun: async () => undefined,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage: async () => [],
      ...(settings === undefined ? {} : { factUsage: createFactUsageService(settings) }),
    },
  });
}

afterEach(async () => {
  await app.close();
});

describe("fact usage routes", () => {
  it("reads nothing set, then sets and clears a fact's and a section's level", async () => {
    const settings = memorySettings();
    await build(settings);
    const empty = await app.inject({ method: "GET", url: base, headers: { authorization } });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ usage: { sections: {}, facts: {} } });

    const set = await app.inject({
      method: "PUT",
      url: base,
      headers: { authorization },
      payload: { kind: "fact", key, level: "never-say" },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toEqual({ usage: { sections: {}, facts: { [key]: "never-say" } } });
    expect([...settings.docs.keys()]).toEqual([
      "/tenants/owner/workspaces/workspace-1|fact-usage.json",
    ]);

    await app.inject({
      method: "PUT",
      url: base,
      headers: { authorization },
      payload: { kind: "section", category: "skill", level: "interview-only" },
    });
    const cleared = await app.inject({
      method: "PUT",
      url: base,
      headers: { authorization },
      payload: { kind: "fact", key, level: null },
    });
    expect(cleared.json()).toEqual({ usage: { sections: { skill: "interview-only" }, facts: {} } });
  });

  it("refuses fact text as a key and an unknown level", async () => {
    await build(memorySettings());
    for (const payload of [
      { kind: "fact", key: "my salary", level: "cv" },
      { kind: "section", category: "skill", level: "public" },
    ]) {
      const response = await app.inject({
        method: "PUT",
        url: base,
        headers: { authorization },
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it("is not served without the service", async () => {
    await build();
    const response = await app.inject({ method: "GET", url: base, headers: { authorization } });
    expect(response.statusCode).toBe(404);
  });
});
