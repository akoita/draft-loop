import type { ApplicationService } from "@draft-loop/application";
import { CliUserError } from "@draft-loop/application";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const path = "/v1/workspaces/workspace-1/application-imports";

const bundle = {
  format: "draft-loop-application-bundle",
  formatVersion: 1,
  sourceWorkspaceId: "desktop-workspace",
  sourceApplicationId: "default",
  name: "Fictional Designer",
  jobText: "Design interfaces for a fictional product.",
  briefs: [],
  runs: [],
};

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

const send = (payload: object) =>
  app.inject({
    method: "POST",
    url: path,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: payload as Record<string, unknown>,
  });

afterEach(async () => {
  await app.close();
});

describe("application imports", () => {
  it("imports a bundle into the addressed workspace and answers a resend with 200", async () => {
    const counts = { runs: 0, briefs: 0, briefVersions: 0 };
    const importApplicationBundle = vi
      .fn()
      .mockResolvedValueOnce({
        applicationId: "imported-1",
        name: "Fictional Designer",
        status: "imported",
        counts,
      })
      .mockResolvedValueOnce({
        applicationId: "imported-1",
        name: "Fictional Designer",
        status: "already-imported",
        counts,
      });
    await build({ importApplicationBundle });

    const first = await send(bundle);
    const second = await send(bundle);

    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ applicationId: "imported-1", status: "imported" });
    expect(second.statusCode).toBe(200);
    expect(importApplicationBundle).toHaveBeenCalledWith({
      root: "/tenants/owner/workspaces/workspace-1",
      bundle,
    });
  });

  it("refuses a malformed bundle and reports the service's refusal", async () => {
    const importApplicationBundle = vi.fn(async () => {
      throw new CliUserError("This workspace already holds a run with the same id.");
    });
    await build({ importApplicationBundle });

    expect((await send({ ...bundle, format: "other" })).statusCode).toBe(400);
    expect(importApplicationBundle).not.toHaveBeenCalled();
    const refused = await send(bundle);
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toMatchObject({ error: { code: "rejected" } });
  });
});
