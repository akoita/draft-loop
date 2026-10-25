import type { ApplicationService, WorkspaceDescriptor } from "@draft-loop/application";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "./app.js";
import type { ProfileDerivations } from "./profile-routes.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const authorization = `Bearer ${ownerToken}`;
const path = "/v1/workspaces/r1/profiles/career/derivation";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function api(derivations?: ProfileDerivations) {
  const service = {
    readWorkspace: async () => ({ id: "history-1", fixtureMode: true }) as WorkspaceDescriptor,
  } as unknown as ApplicationService;
  app = await buildApi({
    ownerToken,
    application: {
      service,
      workspaceRoot: (workspaceId) => workspaceId,
      enqueueRun: async () => undefined,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage: async () => [],
      ...(derivations === undefined ? {} : { profileDerivations: derivations }),
    },
  });
  const server = app;
  return async (method: "GET" | "POST" | "DELETE", payload?: object) => {
    const response = await server.inject({
      method,
      url: path,
      headers: { authorization },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
    return { status: response.statusCode, body: response.json() };
  };
}

function fakeDerivations() {
  return {
    queue: vi.fn<ProfileDerivations["queue"]>(async () => true),
    state: vi.fn<ProfileDerivations["state"]>(async () => ({
      status: "pending",
      completedCalls: 1,
      plannedCalls: 3,
    })),
    cancel: vi.fn<ProfileDerivations["cancel"]>(async () => true),
  };
}

describe("career profile derivation routes", () => {
  it("queues a derivation with the person's choices and answers that it is pending", async () => {
    const derivations = fakeDerivations();
    const call = await api(derivations);

    const started = await call("POST", { providerDataApproved: true, fullExtraction: true });

    expect(started).toEqual({ status: 202, body: { status: "pending" } });
    expect(derivations.queue).toHaveBeenCalledWith({
      workspaceId: "r1",
      profileId: "career",
      providerDataApproved: true,
      fullExtraction: true,
    });
  });

  it("refuses a second derivation of the same profile while one runs", async () => {
    const derivations = fakeDerivations();
    derivations.queue.mockResolvedValueOnce(false);
    const call = await api(derivations);

    const refused = await call("POST", { providerDataApproved: false });

    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("derivation_running");
  });

  it("reads the derivation's progress and outcome, and 404 before any", async () => {
    const derivations = fakeDerivations();
    const call = await api(derivations);

    expect((await call("GET")).body).toEqual({
      status: "pending",
      completedCalls: 1,
      plannedCalls: 3,
    });
    derivations.state.mockResolvedValueOnce({
      status: "failed",
      reason: "failed",
      message: "The selected candidate knowledge changed during profile derivation.",
    });
    expect((await call("GET")).body.reason).toBe("failed");
    derivations.state.mockResolvedValueOnce(undefined);
    expect((await call("GET")).status).toBe(404);
    expect(derivations.state).toHaveBeenCalledWith({ workspaceId: "r1", profileId: "career" });
  });

  it("cancels a waiting or running derivation", async () => {
    const derivations = fakeDerivations();
    const call = await api(derivations);

    expect((await call("DELETE")).body).toEqual({ cancelled: true });
    derivations.cancel.mockResolvedValueOnce(false);
    expect((await call("DELETE")).body).toEqual({ cancelled: false });
  });

  it("answers 503 on a deployment without a derivation queue", async () => {
    const call = await api();

    const refused = await call("POST", { providerDataApproved: true });

    expect(refused.status).toBe(503);
    expect(refused.body.error.code).toBe("derivation_unavailable");
    expect((await call("DELETE")).body).toEqual({ cancelled: false });
  });

  it("takes only the approval and the full-extraction choice", async () => {
    const derivations = fakeDerivations();
    const call = await api(derivations);

    expect((await call("POST", {})).status).toBe(400);
    expect((await call("POST", { providerDataApproved: true, evidence: "text" })).status).toBe(400);
    expect(derivations.queue).not.toHaveBeenCalled();
  });
});
