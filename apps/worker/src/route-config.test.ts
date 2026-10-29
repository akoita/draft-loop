import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WorkerConfigError } from "./config-error.js";
import { readModelRoutes, routeFields, routeProviderOptions } from "./route-config.js";

const vertexEnv = {
  DRAFT_LOOP_VERTEX_PROJECT_ID: "synthetic-project",
  DRAFT_LOOP_VERTEX_PRICE_FACTOR: "1.1",
  DRAFT_LOOP_OPENAI_KEY_SECRET: "projects/synthetic/secrets/openai-key/versions/latest",
};

let secretsDirectory: string;

beforeEach(async () => {
  secretsDirectory = await mkdtemp(join(tmpdir(), "draft-loop-worker-keys-"));
});

afterEach(async () => {
  await rm(secretsDirectory, { recursive: true, force: true });
});

async function keyFile(provider: string, key: string): Promise<void> {
  const path = join(secretsDirectory, `${provider}_api_key`);
  await writeFile(path, `${key}\n`);
  await chmod(path, 0o600);
}

describe("readModelRoutes", () => {
  it("keeps fixtures without routes, and Vertex when a project is set", () => {
    expect(readModelRoutes({})).toBeUndefined();
    expect(readModelRoutes(vertexEnv)).toMatchObject({
      kind: "vertex",
      gateway: { vertexProjectId: "synthetic-project", openAiEndpoint: "eu" },
    });
    expect(readModelRoutes({ ...vertexEnv, DRAFT_LOOP_MODEL_ROUTES: "vertex" })).toMatchObject({
      kind: "vertex",
    });
  });

  it("reads the direct routes with Docker's secrets mount and OpenAI's global endpoint", () => {
    expect(readModelRoutes({ DRAFT_LOOP_MODEL_ROUTES: "direct" })).toEqual({
      kind: "direct",
      direct: { secretsDirectory: "/run/secrets", openAiEndpoint: "global" },
    });
    expect(
      readModelRoutes({
        DRAFT_LOOP_MODEL_ROUTES: "direct",
        DRAFT_LOOP_SECRETS_DIR: "/srv/keys",
        DRAFT_LOOP_OPENAI_ENDPOINT: "eu",
      }),
    ).toEqual({ kind: "direct", direct: { secretsDirectory: "/srv/keys", openAiEndpoint: "eu" } });
  });

  it.each([
    ["an unknown route", { DRAFT_LOOP_MODEL_ROUTES: "local" }],
    ["vertex without a project", { DRAFT_LOOP_MODEL_ROUTES: "vertex" }],
    ["direct beside a Vertex project", { ...vertexEnv, DRAFT_LOOP_MODEL_ROUTES: "direct" }],
    [
      "direct beside a Secret Manager key",
      { DRAFT_LOOP_MODEL_ROUTES: "direct", DRAFT_LOOP_ANTHROPIC_KEY_SECRET: "projects/p/k" },
    ],
    [
      "a relative key directory",
      { DRAFT_LOOP_MODEL_ROUTES: "direct", DRAFT_LOOP_SECRETS_DIR: "keys" },
    ],
    [
      "an unknown OpenAI endpoint",
      { DRAFT_LOOP_MODEL_ROUTES: "direct", DRAFT_LOOP_OPENAI_ENDPOINT: "us" },
    ],
  ])("refuses %s", (_label, env) => {
    expect(() => readModelRoutes(env)).toThrow(WorkerConfigError);
  });

  it("names the routes on the start line without any key", () => {
    const direct = readModelRoutes({ DRAFT_LOOP_MODEL_ROUTES: "direct" });
    const vertex = readModelRoutes(vertexEnv);

    expect(direct && routeFields(direct)).toEqual({
      routes: "direct",
      anthropic: "anthropic-api",
      openAiEndpoint: "global",
    });
    expect(vertex && routeFields(vertex)).toEqual({
      routes: "vertex",
      openAiEndpoint: "eu",
      anthropicFallback: false,
    });
  });
});

describe("routeProviderOptions", () => {
  it("reads the direct routes' keys from files and uses the API-key Claude route", async () => {
    await keyFile("anthropic", "sk-ant-synthetic");
    await keyFile("openai", "sk-openai-synthetic");
    const routes = readModelRoutes({
      DRAFT_LOOP_MODEL_ROUTES: "direct",
      DRAFT_LOOP_SECRETS_DIR: secretsDirectory,
    });

    const options = routeProviderOptions(routes);

    await expect(options.resolveCredential?.("anthropic")).resolves.toBe("sk-ant-synthetic");
    await expect(options.resolveCredential?.("openai")).resolves.toBe("sk-openai-synthetic");
    await expect(options.resolveCredential?.("mistral")).resolves.toBeUndefined();
    expect(options.providerClientFactories?.anthropicRoute).toBeUndefined();
    expect(options.providerClientFactories?.anthropic).toBeTypeOf("function");
    expect(options.providerClientFactories?.openai?.("sk-openai-synthetic")).toMatchObject({
      baseURL: "https://api.openai.com/v1",
    });
  });

  it("knows no key without routes, so a provider call fails closed", async () => {
    const options = routeProviderOptions(undefined);

    expect(options.providerClientFactories).toBeUndefined();
    await expect(options.resolveCredential?.("anthropic")).resolves.toBeUndefined();
  });
});
