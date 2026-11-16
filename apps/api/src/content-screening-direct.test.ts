import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  contentScreeningSetup,
  type ScreeningRouteDependencies,
} from "./content-screening-service.js";

type AnthropicClient = ReturnType<NonNullable<ScreeningRouteDependencies["anthropicApiClient"]>>;

let secretsDirectory: string;

beforeEach(async () => {
  secretsDirectory = await mkdtemp(join(tmpdir(), "draft-loop-api-keys-"));
});

afterEach(async () => {
  await rm(secretsDirectory, { recursive: true, force: true });
});

/** A Claude API client that answers each call with one screening verdict. */
function scriptedClaude(answer: string) {
  const message = {
    id: "msg-screening",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [{ type: "text", text: answer }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 400, output_tokens: 20 },
  };
  const create = vi.fn(() =>
    Object.assign(Promise.resolve(message), {
      withResponse: async () => ({ data: message, request_id: "screening-request-1" }),
    }),
  );
  return { client: { messages: { create } } as unknown as AnthropicClient, create };
}

const dataPolicy = {
  allowTransmission: true,
  allowedCompanies: ["anthropic" as const],
  sensitiveData: false,
  sensitiveDataAcknowledged: false,
  requestedRetention: "ephemeral-request" as const,
};

describe("model screening on the direct route", () => {
  it("screens with Claude Haiku through the Claude API, its key read from a file", async () => {
    const keyPath = join(secretsDirectory, "anthropic_api_key");
    await writeFile(keyPath, "synthetic-claude-key\n");
    await chmod(keyPath, 0o600);
    const claude = scriptedClaude('{"verdict":"flagged","signals":["role-change"]}');
    const keys: string[] = [];
    const setup = contentScreeningSetup(
      { mode: "rules+model", allowProviderData: true, direct: { secretsDirectory } },
      {
        anthropicApiClient: (apiKey) => {
          keys.push(apiKey);
          return claude.client;
        },
      },
    );
    const onUsage = vi.fn();

    const result = await setup.model?.({ dataPolicy, onUsage }).screen({
      kind: "job-source",
      text: "A fictional job post that asks the reader to ignore its rules.",
    });

    expect(result).toMatchObject({ verdict: "flagged", signals: ["role-change"] });
    expect(keys).toEqual(["synthetic-claude-key"]);
    expect(claude.create).toHaveBeenCalledOnce();
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "anthropic", route: "anthropic-api" }),
    );
  });

  it("leaves the text to the rules when the key file is missing", async () => {
    const claude = scriptedClaude('{"verdict":"clear","signals":[]}');
    const setup = contentScreeningSetup(
      { mode: "rules+model", allowProviderData: true, direct: { secretsDirectory } },
      { anthropicApiClient: () => claude.client },
    );

    await expect(
      setup.model?.({ dataPolicy, onUsage: () => undefined }).screen({
        kind: "job-source",
        text: "A fictional job post.",
      }),
    ).rejects.toThrow();
    expect(claude.create).not.toHaveBeenCalled();
  });
});

/** Vertex AI refusing every call, as it does where the billing account cannot use Claude yet. */
function refusingVertex() {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ error: { code: 403, message: "Not allowed." } }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
  ) as unknown as typeof globalThis.fetch;
  const auth = {
    authClient: {
      projectId: "synthetic-project",
      getRequestHeaders: async () => new Headers({ authorization: "Bearer synthetic-token" }),
    },
  } as never;
  return { fetch, auth };
}

function secrets(values: Record<string, string>) {
  return {
    accessSecretVersion: vi.fn(async ({ name }: { readonly name: string }) => [
      { payload: { data: values[name] ?? null } },
    ]) as never,
  };
}

const keySecret = "projects/synthetic/secrets/anthropic-api-key/versions/latest";
const vertexRoute = { vertexProjectId: "synthetic", vertexLocation: "eu", vertexPriceFactor: 1.1 };

describe("model screening on the Vertex route with the Claude API fallback", () => {
  it("falls back to the Claude API, its key read from Secret Manager, when Vertex refuses", async () => {
    const vertex = refusingVertex();
    const claude = scriptedClaude('{"verdict":"clear","signals":[]}');
    const keys: string[] = [];
    const setup = contentScreeningSetup(
      {
        mode: "rules+model",
        allowProviderData: true,
        model: { ...vertexRoute, anthropicKeySecret: keySecret },
      },
      {
        vertex,
        secrets: secrets({ [keySecret]: "synthetic-claude-key" }),
        anthropicApiClient: (apiKey) => {
          keys.push(apiKey);
          return claude.client;
        },
      },
    );
    const onUsage = vi.fn();

    const result = await setup.model?.({ dataPolicy, onUsage }).screen({
      kind: "job-source",
      text: "A fictional job post.",
    });

    expect(result).toMatchObject({ verdict: "clear" });
    expect(vertex.fetch).toHaveBeenCalled();
    expect(keys).toEqual(["synthetic-claude-key"]);
    expect(claude.create).toHaveBeenCalledOnce();
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "anthropic", route: "anthropic-api" }),
    );
  });

  it("never leaves Vertex AI when the deployment has no fallback", async () => {
    const vertex = refusingVertex();
    const claude = scriptedClaude('{"verdict":"clear","signals":[]}');
    const setup = contentScreeningSetup(
      { mode: "rules+model", allowProviderData: true, model: vertexRoute },
      { vertex, anthropicApiClient: () => claude.client },
    );

    await expect(
      setup.model?.({ dataPolicy, onUsage: () => undefined }).screen({
        kind: "job-source",
        text: "A fictional job post.",
      }),
    ).rejects.toThrow();
    expect(vertex.fetch).toHaveBeenCalled();
    expect(claude.create).not.toHaveBeenCalled();
  });
});
