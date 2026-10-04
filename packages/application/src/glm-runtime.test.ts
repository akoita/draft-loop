import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ContextSnapshot, ModelSelection } from "@draft-loop/domain";
import {
  type DeepInfraGLMClient,
  deepInfraGLMModelId,
  type JsonObject,
} from "@draft-loop/providers";
import { openSqliteStorage } from "@draft-loop/storage";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeepInfraGLMAuthorProfile } from "./glm-development-profile.js";
import { providerDataPolicy } from "./glm-provider-routing.js";
import {
  createLocalApplicationDriver,
  createProviderCanonicalCandidateProfileExtractionPort,
  readWorkspace,
} from "./local.js";
import {
  createProviderAdapter,
  type ProviderClientFactories,
  type ProviderCredentialResolver,
} from "./local-provider-adapter.js";
import { defaultModelProfileRegistry } from "./model-profiles.js";

const silent = { write: (_line: string) => undefined };
const schema = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
  additionalProperties: false,
} as const;

function selection(): ModelSelection {
  return {
    company: "zai",
    modelId: deepInfraGLMModelId,
    role: "author",
    promptTemplateVersion: "glm-runtime-test-v1",
    profile: createDeepInfraGLMAuthorProfile(),
  };
}

function completion(output: JsonObject): ChatCompletion {
  return {
    id: "glm-test-response",
    object: "chat.completion",
    created: 1,
    model: deepInfraGLMModelId,
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        logprobs: null,
        message: { role: "assistant", content: JSON.stringify(output), refusal: null },
      },
    ],
    usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
  } as unknown as ChatCompletion;
}

function glmClient(output: JsonObject) {
  const create = vi.fn<DeepInfraGLMClient["chat"]["completions"]["create"]>(async () =>
    completion(output),
  );
  const client: DeepInfraGLMClient = { chat: { completions: { create } } };
  return { client, create };
}

async function contextForRun(root: string, contextSnapshotId: string): Promise<ContextSnapshot> {
  const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
  try {
    const record = await storage.getContextSnapshot(contextSnapshotId);
    if (record === undefined) throw new Error("Missing persisted GLM profile context");
    return record.payload as unknown as ContextSnapshot;
  } finally {
    await storage.close();
  }
}

describe("DeepInfra GLM application route", () => {
  it("uses only the dedicated DeepInfra credential and profile controls", async () => {
    const model = selection();
    const { client, create } = glmClient({ answer: "ready" });
    const resolveCredential = vi.fn<ProviderCredentialResolver>(async (provider) =>
      provider === "deepinfra" ? "synthetic-deepinfra-key" : undefined,
    );
    const factory = vi.fn(() => client);
    const factories: ProviderClientFactories = { deepinfra: factory };
    const authModes = { anthropic: "user-session", openai: "user-session" } as const;
    const adapter = await createProviderAdapter(
      {},
      model,
      true,
      resolveCredential,
      factories,
      authModes,
    );
    const policy = providerDataPolicy("zai", true, authModes);
    const result = await adapter.execute({
      contextSnapshotId: "glm-runtime-snapshot",
      model,
      systemPrompt: "Return the requested JSON.",
      input: { task: "test" },
      outputSchema: schema,
      outputName: "glm_test",
      maxOutputTokens: 32768,
      dataPolicy: policy,
    });

    expect(result.output).toEqual({ answer: "ready" });
    expect(resolveCredential.mock.calls).toEqual([["deepinfra"]]);
    expect(factory).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledWith("synthetic-deepinfra-key");
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      model: deepInfraGLMModelId,
      max_tokens: 32768,
      reasoning_effort: "low",
    });
    expect(create.mock.calls[0]?.[1]).toMatchObject({ maxRetries: 0, timeout: 120_000 });
    expect(policy.allowedCompanies).toEqual(["deepinfra"]);
  });

  describe("temporary overload retry", () => {
    const overloaded = () =>
      Object.assign(new Error("Service temporarily overloaded."), { status: 503 });

    async function runWith(
      create: ReturnType<typeof glmClient>["create"],
      config: Parameters<typeof createProviderAdapter>[0] = {},
    ) {
      const model = selection();
      const authModes = { anthropic: "user-session", openai: "user-session" } as const;
      const adapter = await createProviderAdapter(
        config,
        model,
        true,
        async () => "synthetic-deepinfra-key",
        { deepinfra: () => ({ chat: { completions: { create } } }) },
        authModes,
      );
      return adapter.execute({
        contextSnapshotId: "glm-retry-snapshot",
        model,
        systemPrompt: "Return the requested JSON.",
        input: { task: "test" },
        outputSchema: schema,
        outputName: "glm_test",
        maxOutputTokens: 32768,
        dataPolicy: providerDataPolicy("zai", true, authModes),
      });
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it("retries a temporary 503 once and then completes", async () => {
      vi.useFakeTimers();
      const { create } = glmClient({ answer: "ready" });
      create.mockRejectedValueOnce(overloaded());
      const pending = runWith(create);
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(pending).resolves.toMatchObject({ output: { answer: "ready" } });
      expect(create).toHaveBeenCalledTimes(2);
    });

    it("stops after the third consecutive 503", async () => {
      vi.useFakeTimers();
      const { create } = glmClient({ answer: "unused" });
      create.mockRejectedValue(overloaded());
      const settled = expect(runWith(create)).rejects.toMatchObject({
        code: "transient",
        retryable: true,
      });
      await vi.advanceTimersByTimeAsync(30_000);
      await settled;
      expect(create).toHaveBeenCalledTimes(3);
    });

    it.each([
      [
        "credit exhaustion",
        Object.assign(new Error("Insufficient credits"), { status: 402 }),
        "quota-exhausted",
      ],
      [
        "authentication",
        Object.assign(new Error("Unauthorized"), { status: 401 }),
        "authentication",
      ],
    ])("does not retry %s", async (_label, failure, code) => {
      const { create } = glmClient({ answer: "unused" });
      create.mockRejectedValue(failure);
      await expect(runWith(create)).rejects.toMatchObject({ code, retryable: false });
      expect(create).toHaveBeenCalledTimes(1);
    });

    it("honours an explicit retry configuration of zero retries", async () => {
      const { create } = glmClient({ answer: "unused" });
      create.mockRejectedValue(overloaded());
      await expect(runWith(create, { retry: { maxRetries: 0 } })).rejects.toMatchObject({
        code: "transient",
      });
      expect(create).toHaveBeenCalledTimes(1);
    });
  });

  it("rejects denied, missing-key, and unknown Z.ai routes before constructing a client", async () => {
    const { client: _client } = glmClient({ answer: "unused" });
    const resolveCredential = vi.fn<ProviderCredentialResolver>(async () => undefined);
    const factory = vi.fn(() => _client);
    const factories: ProviderClientFactories = { deepinfra: factory };
    const model = selection();

    await expect(
      createProviderAdapter({}, model, false, resolveCredential, factories),
    ).rejects.toMatchObject({ code: "policy" });
    expect(resolveCredential).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();

    await expect(
      createProviderAdapter({}, model, true, resolveCredential, factories),
    ).rejects.toMatchObject({ code: "authentication" });
    expect(resolveCredential.mock.calls).toEqual([["deepinfra"]]);
    expect(factory).not.toHaveBeenCalled();

    const wrongModel = { ...model, modelId: "another-zai-model" };
    resolveCredential.mockClear();
    await expect(
      createProviderAdapter({}, wrongModel, true, resolveCredential, factories),
    ).rejects.toMatchObject({ code: "invalid-request" });
    expect(resolveCredential).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
  });

  it("binds the detached extraction profile and exact budget with disabled reasoning", async () => {
    const root = await mkdtemp(join(tmpdir(), "glm-canonical-extraction-"));
    const source = {
      id: "source-one",
      mediaType: "text/plain",
      checksum: "a".repeat(64),
      text: "Ada Lovelace built local-first tools.",
    };
    const proposal = {
      schemaVersion: 1,
      facts: [
        {
          key: "name",
          category: "identity",
          field: "name",
          value: "Ada Lovelace",
          evidence: [{ sourceId: source.id, quote: "Ada Lovelace" }],
        },
      ],
      issues: [],
    };
    const { client, create } = glmClient(proposal);
    const driver = createLocalApplicationDriver();

    try {
      await mkdir(join(root, "evidence"), { recursive: true });
      await writeFile(join(root, "job.md"), "Software engineering role.");
      await driver.initialize(
        {
          root,
          jobDescription: "job.md",
          sources: "evidence",
          authorCompany: "zai",
          authorModel: deepInfraGLMModelId,
          criticCompany: "openai",
          criticModel: "gpt-6-luna",
        },
        silent,
      );
      const port = createProviderCanonicalCandidateProfileExtractionPort(
        await readWorkspace(root),
        {
          allowProviderData: true,
          resolveCredential: async (provider) =>
            provider === "deepinfra" ? "synthetic-deepinfra-key" : undefined,
          providerClientFactories: { deepinfra: () => client },
        },
      );

      await expect(
        port.extract({ operationId: "glm-extraction", sources: [source] }),
      ).resolves.toEqual(proposal);
      expect(create.mock.calls[0]?.[0]).toMatchObject({
        model: deepInfraGLMModelId,
        max_tokens: 32768,
        reasoning_effort: "none",
      });
      expect(create.mock.calls[0]?.[0].messages[1]?.content).toBe(
        JSON.stringify({ sources: [source] }),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists exact profile controls and resumes without consulting the registry", async () => {
    const root = await mkdtemp(join(tmpdir(), "glm-profile-resume-"));
    const author = defaultModelProfileRegistry.resolve("dev-deepinfra-glm-author", 1, "author");
    const critic = defaultModelProfileRegistry.resolve("economy-openai-critic", 1, "critic");
    const resolve = vi.fn(defaultModelProfileRegistry.resolve);
    const driver = createLocalApplicationDriver({
      modelProfileRegistry: { resolve, list: defaultModelProfileRegistry.list },
    });

    try {
      await mkdir(join(root, "evidence"), { recursive: true });
      await writeFile(join(root, "job.md"), "Software engineering role.");
      await writeFile(join(root, "evidence", "candidate.md"), "Built TypeScript tools.");
      await driver.initialize(
        {
          root,
          jobDescription: "job.md",
          sources: "evidence",
          authorCompany: "anthropic",
          authorModel: "claude-sonnet-5-5",
          criticCompany: "openai",
          criticModel: "gpt-6-luna",
          fixtureMode: true,
        },
        silent,
      );
      const originalWorkspace = await driver.readWorkspace(root);
      const begun = await driver.begin(
        {
          root,
          modelProfiles: {
            author: { id: author.id, version: author.version },
            critic: { id: critic.id, version: critic.version },
          },
        },
        silent,
      );
      const persisted = await contextForRun(root, begun.contextSnapshotId);
      expect(persisted.modelConfiguration.author).toMatchObject({
        company: "zai",
        modelId: deepInfraGLMModelId,
        profile: author,
      });
      expect(persisted.modelConfiguration.author.profile?.runtime).toEqual(author.runtime);
      expect((await driver.readWorkspace(root)).author).toEqual(originalWorkspace.author);

      const throwingRegistry = {
        resolve: vi.fn(() => {
          throw new Error("resume must not resolve profiles");
        }),
        list: vi.fn(() => []),
      };
      const restarted = createLocalApplicationDriver({ modelProfileRegistry: throwingRegistry });
      const resumed = await restarted.resume({ root, runId: begun.runId }, silent);

      expect(throwingRegistry.resolve).not.toHaveBeenCalled();
      expect(
        resumed.executionHistory.map(({ provider, modelId }) => [provider, modelId]),
      ).toContainEqual(["zai", deepInfraGLMModelId]);
      expect(persisted.modelConfiguration.critic.profile).toEqual(critic);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
