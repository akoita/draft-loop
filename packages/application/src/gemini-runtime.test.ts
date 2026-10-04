import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ContextSnapshot, ModelSelection } from "@draft-loop/domain";
import {
  type GoogleGeminiClient,
  googleGeminiModelId,
  type JsonObject,
} from "@draft-loop/providers";
import { openSqliteStorage } from "@draft-loop/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalExtractionProfileFor } from "./canonical-extraction-profile.js";
import { createGoogleGeminiAuthorProfile } from "./gemini-development-profile.js";
import { createGoogleGeminiExtractionProfile } from "./gemini-extraction-profile.js";
import { environmentCredentialResolver, providerDataPolicy } from "./glm-provider-routing.js";
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
    company: "google",
    modelId: googleGeminiModelId,
    role: "author",
    promptTemplateVersion: "gemini-runtime-test-v1",
    profile: createGoogleGeminiAuthorProfile(),
  };
}

function geminiClient(output: JsonObject) {
  const generate = vi.fn<GoogleGeminiClient["models"]["generateContentStream"]>(
    async () =>
      ({
        async *[Symbol.asyncIterator]() {
          yield {
            candidates: [
              {
                content: { role: "model", parts: [{ text: JSON.stringify(output) }] },
                finishReason: "STOP",
              },
            ],
            responseId: "gemini-test-response",
            usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30 },
          };
        },
      }) as AsyncIterable<unknown>,
  );
  const client: GoogleGeminiClient = { models: { generateContentStream: generate } };
  return { client, generate };
}

async function contextForRun(root: string, contextSnapshotId: string): Promise<ContextSnapshot> {
  const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
  try {
    const record = await storage.getContextSnapshot(contextSnapshotId);
    if (record === undefined) throw new Error("Missing persisted Gemini profile context");
    return record.payload as unknown as ContextSnapshot;
  } finally {
    await storage.close();
  }
}

describe("Google Gemini application route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses only the dedicated Gemini credential and profile controls", async () => {
    const model = selection();
    const { client, generate } = geminiClient({ answer: "ready" });
    const resolveCredential = vi.fn<ProviderCredentialResolver>(async (provider) =>
      provider === "google" ? "synthetic-gemini-key" : "wrong-provider-key",
    );
    const factory = vi.fn(() => client);
    const factories: ProviderClientFactories = { google: factory };
    const authModes = { anthropic: "user-session", openai: "user-session" } as const;
    const adapter = await createProviderAdapter(
      {},
      model,
      true,
      resolveCredential,
      factories,
      authModes,
    );
    const policy = providerDataPolicy("google", true, authModes);
    const result = await adapter.execute({
      contextSnapshotId: "gemini-runtime-snapshot",
      model,
      systemPrompt: "Return the requested JSON.",
      input: { task: "test" },
      outputSchema: schema,
      outputName: "gemini_test",
      maxOutputTokens: 32768,
      dataPolicy: policy,
    });

    expect(result.output).toEqual({ answer: "ready" });
    expect(resolveCredential.mock.calls).toEqual([["google"]]);
    expect(factory).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledWith("synthetic-gemini-key");
    expect(generate.mock.calls[0]?.[0]).toMatchObject({
      model: googleGeminiModelId,
      config: { maxOutputTokens: 32768, thinkingConfig: { thinkingLevel: "LOW" } },
    });
    expect(policy.allowedCompanies).toEqual(["google"]);
    expect(policy.requestedRetention).toBe("ephemeral-request");
  });

  describe("temporary overload retry", () => {
    const overloaded = () =>
      Object.assign(new Error("The model is overloaded due to high demand."), { status: 503 });

    async function runWith(
      generate: ReturnType<typeof geminiClient>["generate"],
      config: Parameters<typeof createProviderAdapter>[0] = {},
    ) {
      const model = selection();
      const authModes = { anthropic: "user-session", openai: "user-session" } as const;
      const adapter = await createProviderAdapter(
        config,
        model,
        true,
        async () => "synthetic-gemini-key",
        { google: () => ({ models: { generateContentStream: generate } }) },
        authModes,
      );
      return adapter.execute({
        contextSnapshotId: "gemini-retry-snapshot",
        model,
        systemPrompt: "Return the requested JSON.",
        input: { task: "test" },
        outputSchema: schema,
        outputName: "gemini_test",
        maxOutputTokens: 32768,
        dataPolicy: providerDataPolicy("google", true, authModes),
      });
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it("retries a temporary 503 once and then completes", async () => {
      vi.useFakeTimers();
      const { generate } = geminiClient({ answer: "ready" });
      generate.mockRejectedValueOnce(overloaded());
      const pending = runWith(generate);
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(pending).resolves.toMatchObject({ output: { answer: "ready" } });
      expect(generate).toHaveBeenCalledTimes(2);
    });

    it("stops after the third consecutive 503", async () => {
      vi.useFakeTimers();
      const { generate } = geminiClient({ answer: "unused" });
      generate.mockRejectedValue(overloaded());
      const pending = runWith(generate);
      const settled = expect(pending).rejects.toMatchObject({
        provider: "google",
        code: "transient",
        retryable: true,
      });
      await vi.advanceTimersByTimeAsync(30_000);
      await settled;
      expect(generate).toHaveBeenCalledTimes(3);
    });

    it.each([
      [
        "quota exhaustion",
        Object.assign(new Error("You exceeded your current quota, please check your plan."), {
          status: 429,
        }),
        "quota-exhausted",
      ],
      [
        "authentication",
        Object.assign(new Error("Unauthorized"), { status: 401 }),
        "authentication",
      ],
      [
        "an invalid API key",
        Object.assign(new Error("API key not valid. Please pass a valid API key."), {
          status: 400,
        }),
        "authentication",
      ],
    ])("does not retry %s", async (_label, failure, code) => {
      const { generate } = geminiClient({ answer: "unused" });
      generate.mockRejectedValue(failure);
      await expect(runWith(generate)).rejects.toMatchObject({ code, retryable: false });
      expect(generate).toHaveBeenCalledTimes(1);
    });

    it("honours an explicit retry configuration of zero retries", async () => {
      const { generate } = geminiClient({ answer: "unused" });
      generate.mockRejectedValue(overloaded());
      await expect(runWith(generate, { retry: { maxRetries: 0 } })).rejects.toMatchObject({
        code: "transient",
      });
      expect(generate).toHaveBeenCalledTimes(1);
    });
  });

  it("rejects denied, missing-key, and unknown Google routes before constructing a client", async () => {
    const { client } = geminiClient({ answer: "unused" });
    const resolveCredential = vi.fn<ProviderCredentialResolver>(async () => undefined);
    const factory = vi.fn(() => client);
    const factories: ProviderClientFactories = { google: factory };
    const model = selection();

    await expect(
      createProviderAdapter({}, model, false, resolveCredential, factories),
    ).rejects.toMatchObject({ provider: "google", code: "policy" });
    expect(resolveCredential).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();

    await expect(
      createProviderAdapter({}, model, true, resolveCredential, factories),
    ).rejects.toMatchObject({ provider: "google", code: "authentication" });
    expect(resolveCredential.mock.calls).toEqual([["google"]]);
    expect(factory).not.toHaveBeenCalled();

    const blank = vi.fn<ProviderCredentialResolver>(async () => "   ");
    await expect(createProviderAdapter({}, model, true, blank, factories)).rejects.toMatchObject({
      code: "authentication",
    });
    expect(factory).not.toHaveBeenCalled();

    const wrongModel = { ...model, modelId: "another-google-model" };
    resolveCredential.mockClear();
    await expect(
      createProviderAdapter({}, wrongModel, true, resolveCredential, factories),
    ).rejects.toMatchObject({ provider: "google", code: "invalid-request" });
    expect(resolveCredential).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
  });

  it("reads only GEMINI_API_KEY for Google and never leaks other provider keys", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-key");
    vi.stubEnv("OPENAI_API_KEY", "openai-key");
    vi.stubEnv("DEEPINFRA_API_KEY", "deepinfra-key");
    vi.stubEnv("GEMINI_API_KEY", "gemini-key");
    await expect(environmentCredentialResolver("google")).resolves.toBe("gemini-key");
    await expect(environmentCredentialResolver("deepinfra")).resolves.toBe("deepinfra-key");
    await expect(environmentCredentialResolver("anthropic")).resolves.toBe("anthropic-key");
    await expect(environmentCredentialResolver("openai")).resolves.toBe("openai-key");

    vi.unstubAllEnvs();
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-key");
    vi.stubEnv("OPENAI_API_KEY", "openai-key");
    vi.stubEnv("DEEPINFRA_API_KEY", "deepinfra-key");
    delete process.env.GEMINI_API_KEY;
    await expect(environmentCredentialResolver("google")).resolves.toBeUndefined();
  });

  it("keeps the other provider exposure policies unchanged", () => {
    const authModes = { anthropic: "api-key", openai: "api-key" } as const;
    expect(providerDataPolicy("zai", true, authModes).allowedCompanies).toEqual(["deepinfra"]);
    expect(providerDataPolicy("anthropic", true, authModes).allowedCompanies).toEqual([
      "anthropic",
      "openai",
      "local",
      "zai",
      "google",
    ]);
  });

  it("selects the detached extraction profile only for the exact Gemini model", () => {
    expect(canonicalExtractionProfileFor("google", googleGeminiModelId)).toEqual(
      createGoogleGeminiExtractionProfile(),
    );
    expect(canonicalExtractionProfileFor("google", "another-google-model")).toBeUndefined();
    expect(canonicalExtractionProfileFor("anthropic", googleGeminiModelId)).toBeUndefined();
    expect(canonicalExtractionProfileFor("zai", "zai-org/GLM-5.3-Flash")?.id).toBe(
      "dev-deepinfra-glm-extraction",
    );
    expect(canonicalExtractionProfileFor("openai", "gpt-6-luna")).toBeUndefined();
  });

  it("binds the detached extraction profile and exact budget with disabled thinking", async () => {
    const root = await mkdtemp(join(tmpdir(), "gemini-canonical-extraction-"));
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
    const { client, generate } = geminiClient(proposal);
    const driver = createLocalApplicationDriver();
    const resolveCredential = vi.fn<ProviderCredentialResolver>(async (provider) =>
      provider === "google" ? "synthetic-gemini-key" : undefined,
    );

    try {
      await mkdir(join(root, "evidence"), { recursive: true });
      await writeFile(join(root, "job.md"), "Software engineering role.");
      await driver.initialize(
        {
          root,
          jobDescription: "job.md",
          sources: "evidence",
          authorCompany: "google",
          authorModel: googleGeminiModelId,
          criticCompany: "openai",
          criticModel: "gpt-6-luna",
        },
        silent,
      );
      const port = createProviderCanonicalCandidateProfileExtractionPort(
        await readWorkspace(root),
        {
          allowProviderData: true,
          resolveCredential,
          providerClientFactories: { google: () => client },
        },
      );

      await expect(
        port.extract({ operationId: "gemini-extraction", sources: [source] }),
      ).resolves.toEqual(proposal);
      expect(resolveCredential.mock.calls).toEqual([["google"]]);
      expect(generate.mock.calls[0]?.[0]).toMatchObject({
        model: googleGeminiModelId,
        config: { maxOutputTokens: 32768, thinkingConfig: { thinkingBudget: 0 } },
      });
      expect(generate.mock.calls[0]?.[0].contents).toEqual([
        { role: "user", parts: [{ text: JSON.stringify({ sources: [source] }) }] },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists exact profile controls and resumes without consulting the registry", async () => {
    const root = await mkdtemp(join(tmpdir(), "gemini-profile-resume-"));
    const author = defaultModelProfileRegistry.resolve("dev-google-gemini-author", 1, "author");
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
        company: "google",
        modelId: googleGeminiModelId,
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
      ).toContainEqual(["google", googleGeminiModelId]);
      expect(persisted.modelConfiguration.critic.profile).toEqual(critic);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
