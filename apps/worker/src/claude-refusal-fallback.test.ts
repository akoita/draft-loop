import type { ModelSelection } from "@draft-loop/providers";
import { describe, expect, it, vi } from "vitest";

import {
  catalogClaudePricing,
  claudeRefusalFallbackSetting,
  readClaudeRefusalFallback,
} from "./claude-refusal-fallback.js";
import { WorkerConfigError } from "./config-error.js";
import { readModelRoutes, routeProviderOptions } from "./route-config.js";

const pricing = { inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 15 };
const knownRates = () => pricing;
const direct = readModelRoutes({ DRAFT_LOOP_MODEL_ROUTES: "direct" });
const vertexEnv = {
  DRAFT_LOOP_VERTEX_PROJECT_ID: "synthetic-project",
  DRAFT_LOOP_VERTEX_PRICE_FACTOR: "1.1",
  DRAFT_LOOP_OPENAI_KEY_SECRET: "projects/synthetic/secrets/openai-key/versions/latest",
};
const secret = "projects/synthetic/secrets/model-calls/versions/latest";

const author: ModelSelection = {
  company: "anthropic",
  modelId: "claude-sonnet-5-5",
  role: "author",
  promptTemplateVersion: "author-v1",
};

const env = (modelId: string) => ({ DRAFT_LOOP_CLAUDE_REFUSAL_FALLBACK: modelId });

describe("DRAFT_LOOP_CLAUDE_REFUSAL_FALLBACK", () => {
  it("is off when unset", () => {
    expect(readClaudeRefusalFallback({}, direct, knownRates)).toBeUndefined();
    expect(readClaudeRefusalFallback(env(" "), direct, knownRates)).toBeUndefined();
  });

  it("reads an allowed fallback with known rates on a direct Claude route", () => {
    expect(readClaudeRefusalFallback(env("claude-sonnet-5"), direct, knownRates)).toEqual({
      modelId: "claude-sonnet-5",
      pricing,
    });
    const vertexWithClaudeApi = readModelRoutes({
      ...vertexEnv,
      DRAFT_LOOP_ANTHROPIC_FALLBACK: "true",
      DRAFT_LOOP_ANTHROPIC_KEY_SECRET: "projects/synthetic/secrets/claude-key/versions/latest",
    });
    expect(
      readClaudeRefusalFallback(env("claude-sonnet-5"), vertexWithClaudeApi, knownRates),
    ).toMatchObject({ modelId: "claude-sonnet-5" });
  });

  it.each([
    ["an unknown model", "gpt-6-luna", "not a Claude Haiku or Sonnet model"],
    ["an Opus model", "claude-opus-5-5", "not a Claude Haiku or Sonnet model"],
    ["no author's fallback", "claude-haiku-5-5", "claude-sonnet-5-5 falls back to claude-sonnet-5"],
  ])("refuses %s", (_case, modelId, message) => {
    expect(() => readClaudeRefusalFallback(env(modelId), direct, knownRates)).toThrow(
      WorkerConfigError,
    );
    expect(() => readClaudeRefusalFallback(env(modelId), direct, knownRates)).toThrow(message);
  });

  it("refuses a model without known rates", () => {
    expect(() =>
      readClaudeRefusalFallback(env("claude-sonnet-5"), direct, () => undefined),
    ).toThrow("no known rates");
  });

  it("reads the rates from the model catalog", () => {
    expect(catalogClaudePricing("claude-haiku-5-5")).toBeDefined();
    expect(catalogClaudePricing("claude-unknown-1")).toBeUndefined();
  });

  it("refuses the setting where no direct Claude route would use it", () => {
    for (const routes of [undefined, readModelRoutes(vertexEnv)]) {
      expect(() => readClaudeRefusalFallback(env("claude-sonnet-5"), routes, knownRates)).toThrow(
        "needs the direct Claude route",
      );
    }
  });
});

describe("the refusal fallback's switch", () => {
  const config = { modelId: "claude-sonnet-5", pricing };

  function stored(text: string) {
    return { accessSecretVersion: vi.fn(async () => [{ payload: { data: text } }] as const) };
  }

  it.each([
    ["{}", true],
    ['{"refusalFallback":"off"}', false],
    ['{"modelCalls":"paused"}', false],
  ])("with %s, allows the retry: %s", async (text, allowed) => {
    const setting = claudeRefusalFallbackSetting(
      config,
      { DRAFT_LOOP_MODEL_CALLS_SECRET: secret },
      { client: stored(text) },
    );
    expect(await setting?.allowed?.()).toBe(allowed);
  });

  it("stops the fallback on a self-hosted pause", async () => {
    const setting = claudeRefusalFallbackSetting(config, { DRAFT_LOOP_MODEL_CALLS: "paused" });
    expect(await setting?.allowed?.()).toBe(false);
  });

  it("keeps the fallback on and reports when the secret cannot be read", async () => {
    const onReadError = vi.fn();
    const setting = claudeRefusalFallbackSetting(
      config,
      { DRAFT_LOOP_MODEL_CALLS_SECRET: secret },
      {
        client: {
          accessSecretVersion: async () => {
            throw new Error("denied");
          },
        },
        onReadError,
      },
    );
    expect(await setting?.allowed?.()).toBe(true);
    expect(onReadError).toHaveBeenCalled();
  });

  it("is a startup error on a bad switch setting, and nothing without the fallback", () => {
    expect(() => claudeRefusalFallbackSetting(config, { DRAFT_LOOP_MODEL_CALLS: "maybe" })).toThrow(
      WorkerConfigError,
    );
    expect(claudeRefusalFallbackSetting(undefined, {})).toBeUndefined();
  });

  it("reaches the direct routes' API-key adapter only for an author that falls back to it", () => {
    const setting = claudeRefusalFallbackSetting(config, {});
    const factories = routeProviderOptions(
      direct,
      setting === undefined ? {} : { refusalFallback: setting },
    ).providerClientFactories;
    expect(factories?.anthropicRefusalFallback?.(author)).toMatchObject(config);
    expect(
      factories?.anthropicRefusalFallback?.({ ...author, modelId: "claude-haiku-5-5" }),
    ).toBeUndefined();
    expect(routeProviderOptions(direct).providerClientFactories).not.toHaveProperty(
      "anthropicRefusalFallback",
    );
  });
});
