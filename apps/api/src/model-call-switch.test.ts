import type { ApplicationService } from "@draft-loop/application";
import type { AnthropicRouteBuilder } from "@draft-loop/model-gateway";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "./app.js";
import {
  modelCallsRunning,
  parseModelCallSwitch,
  pausableBriefExtraction,
  readModelCallSwitch,
  secretModelCallSwitch,
} from "./model-call-switch.js";
import { readSupportSettings } from "./support-config.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const owner = { authorization: `Bearer ${ownerToken}` };

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(paused: boolean) {
  const execute = vi.fn();
  const enqueueRun = vi.fn(async () => undefined);
  const route = (() => ({
    provider: "anthropic",
    route: "vertex",
    execute,
  })) as unknown as AnthropicRouteBuilder;
  app = await buildApi({
    ownerToken,
    logger: false,
    modelCallSwitch: async () => paused,
    support: readSupportSettings({ DRAFT_LOOP_SUPPORT_ASSISTANT: "on" }),
    application: {
      service: { readWorkspace: async () => ({ id: "owner" }) } as unknown as ApplicationService,
      workspaceRoot: (workspaceId: string) => `/tenants/owner/workspaces/${workspaceId}`,
      enqueueRun,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage: async () => [],
      careerInterview: { sessions: {} as never, allowProviderData: true, route },
    },
  } as unknown as Parameters<typeof buildApi>[0]);
  return { app, execute, enqueueRun };
}

describe("global model call switch", () => {
  it("refuses a support question and a run start with no model call or queued run", async () => {
    const { app, execute, enqueueRun } = await start(true);
    for (const url of [
      "/v1/workspaces/owner/support/conversations",
      "/v1/workspaces/owner/support/conversations/c_1/messages",
      "/v1/workspaces/owner/runs",
      "/v1/workspaces/owner/applications/app_fixture0001/cover-letter-kit",
    ]) {
      const response = await app.inject({ method: "POST", url, headers: owner, payload: {} });
      expect(response.statusCode, url).toBe(503);
      expect(response.json().error.code).toBe("model_calls_paused");
      expect(response.headers["retry-after"]).toBe("600");
    }
    expect(execute).not.toHaveBeenCalled();
    expect(enqueueRun).not.toHaveBeenCalled();
  });

  it("leaves routes that call no model alone while paused", async () => {
    const { app } = await start(true);
    const response = await app.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).not.toBe(503);
  });

  it("lets calls through when running", async () => {
    const { app } = await start(false);
    const response = await app.inject({
      method: "POST",
      url: "/v1/workspaces/owner/support/conversations",
      headers: owner,
    });
    expect(response.statusCode).not.toBe(503);
  });
});

describe("brief extraction while paused", () => {
  const request = { log: { warn: vi.fn() } } as unknown as FastifyRequest;

  it("leaves the brief for the person, without taking from the allowance", async () => {
    const take = vi.fn(async () => true);
    const allowance = { take, spent: async () => false };
    const paused = pausableBriefExtraction(allowance, async () => true);
    expect(await paused.take(request)).toBe(false);
    expect(await paused.spent(request)).toBe(true);
    expect(take).not.toHaveBeenCalled();
  });

  it("defers to the allowance, or allows, when running", async () => {
    expect(await pausableBriefExtraction(undefined, modelCallsRunning).take(request)).toBe(true);
    const spent = { take: async () => false, spent: async () => true };
    const running = pausableBriefExtraction(spent, modelCallsRunning);
    expect(await running.take(request)).toBe(false);
    expect(await running.spent(request)).toBe(true);
  });
});

describe("reading the switch", () => {
  it("parses the stored value", () => {
    expect(parseModelCallSwitch(undefined)).toBe(false);
    expect(parseModelCallSwitch("{}")).toBe(false);
    expect(parseModelCallSwitch('{"modelCalls":"on"}')).toBe(false);
    expect(parseModelCallSwitch('{"modelCalls":"paused"}')).toBe(true);
    expect(() => parseModelCallSwitch('{"modelCalls":"off"}')).toThrow();
  });

  it("keeps calls running when the secret cannot be read", async () => {
    const onReadError = vi.fn();
    const paused = secretModelCallSwitch({
      secret: "projects/p/secrets/s/versions/latest",
      client: {
        accessSecretVersion: async () => {
          throw new Error("denied");
        },
      } as never,
      onReadError,
    });
    expect(await paused()).toBe(false);
    expect(onReadError).toHaveBeenCalled();
  });

  it("reads the environment where there is no secret", async () => {
    expect(await readModelCallSwitch({})()).toBe(false);
    expect(await readModelCallSwitch({ DRAFT_LOOP_MODEL_CALLS: "paused" })()).toBe(true);
    expect(() => readModelCallSwitch({ DRAFT_LOOP_MODEL_CALLS: "maybe" })).toThrow();
  });
});
