import { describe, expect, it, vi } from "vitest";

import { WorkerConfigError } from "./config-error.js";
import { readModelGatewayConfig, workerProviderOptions } from "./model-routes.js";

const env = {
  DRAFT_LOOP_VERTEX_PROJECT_ID: "synthetic-project",
  DRAFT_LOOP_VERTEX_LOCATION: "europe-west1",
  DRAFT_LOOP_VERTEX_PRICE_FACTOR: "1.1",
  DRAFT_LOOP_OPENAI_KEY_SECRET: "projects/synthetic/secrets/openai-key/versions/latest",
};

const author = {
  company: "anthropic",
  modelId: "claude-sonnet-5-5",
  role: "author",
  promptTemplateVersion: "author-v1",
} as const;

/** Scripted Google auth, so no test looks for the runtime's service identity. */
const vertex = {
  auth: {
    authClient: {
      projectId: "synthetic-project",
      getRequestHeaders: async () => new Headers({ authorization: "Bearer synthetic-token" }),
    },
  },
} as never;

function secrets(values: Record<string, string>) {
  return {
    accessSecretVersion: vi.fn(async ({ name }: { readonly name: string }) => [
      { payload: { data: values[name] ?? null } },
    ]) as never,
  };
}

describe("readModelGatewayConfig", () => {
  it("leaves the gateway off without a Vertex project, as on the local stack", () => {
    expect(readModelGatewayConfig({})).toBeUndefined();
  });

  it("reads the Vertex location, its price factor and the key secrets", () => {
    expect(readModelGatewayConfig(env)).toEqual({
      vertexProjectId: "synthetic-project",
      vertexLocation: "europe-west1",
      vertexPriceFactor: 1.1,
      openAiKeySecret: env.DRAFT_LOOP_OPENAI_KEY_SECRET,
    });
    expect(
      readModelGatewayConfig({
        ...env,
        DRAFT_LOOP_VERTEX_LOCATION: undefined,
        DRAFT_LOOP_ANTHROPIC_FALLBACK: "true",
        DRAFT_LOOP_ANTHROPIC_KEY_SECRET: "projects/synthetic/secrets/claude-key/versions/3",
      }),
    ).toMatchObject({ vertexLocation: "eu", anthropicKeySecret: expect.any(String) });
  });

  it.each([
    ["a location outside the EU", { DRAFT_LOOP_VERTEX_LOCATION: "us-east5" }],
    ["no price factor", { DRAFT_LOOP_VERTEX_PRICE_FACTOR: undefined }],
    ["a price factor below 1", { DRAFT_LOOP_VERTEX_PRICE_FACTOR: "0.9" }],
    ["no OpenAI key secret", { DRAFT_LOOP_OPENAI_KEY_SECRET: "" }],
    ["an unclear fallback setting", { DRAFT_LOOP_ANTHROPIC_FALLBACK: "yes" }],
    ["the fallback on without its key", { DRAFT_LOOP_ANTHROPIC_FALLBACK: "true" }],
    [
      "a Claude key with the fallback off",
      { DRAFT_LOOP_ANTHROPIC_KEY_SECRET: "projects/p/secrets/k/versions/1" },
    ],
  ])("refuses %s", (_label, override) => {
    expect(() => readModelGatewayConfig({ ...env, ...override })).toThrow(WorkerConfigError);
  });
});

describe("workerProviderOptions", () => {
  it("knows no key without the gateway, so a provider call fails closed", async () => {
    const options = workerProviderOptions(undefined);

    expect(options.providerClientFactories).toBeUndefined();
    await expect(options.resolveCredential?.("anthropic")).resolves.toBeUndefined();
    await expect(options.resolveCredential?.("openai")).resolves.toBeUndefined();
  });

  it("routes the author to Vertex AI and reads the critic's key from Secret Manager", async () => {
    const config = readModelGatewayConfig(env);
    const reader = secrets({ [env.DRAFT_LOOP_OPENAI_KEY_SECRET]: "synthetic-openai-key" });

    const options = workerProviderOptions(config, { secrets: reader, vertex });
    const route = options.providerClientFactories?.anthropicRoute?.({ configuredModel: author });

    expect(route).toMatchObject({ route: "vertex-ai" });
    await expect(options.resolveCredential?.("openai")).resolves.toBe("synthetic-openai-key");
    await expect(options.resolveCredential?.("anthropic")).resolves.toBeUndefined();
    expect(options.providerClientFactories?.openai?.("synthetic-openai-key")).toMatchObject({
      baseURL: "https://eu.api.openai.com/v1",
    });
  });
});
