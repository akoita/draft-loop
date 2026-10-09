import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ContextSnapshot, ModelSelection } from "@draft-loop/domain";
import {
  type JsonObject,
  type MistralClient,
  mistralLarge4ModelId,
  ProviderAdapterError,
} from "@draft-loop/providers";
import { openSqliteStorage } from "@draft-loop/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalExtractionProfileFor } from "./canonical-extraction-profile.js";
import {
  environmentCredentialResolver,
  opportunityExtractionMaxOutputTokens,
  providerDataPolicy,
} from "./glm-provider-routing.js";
import {
  createLocalApplicationDriver,
  createProviderCanonicalCandidateProfileExtractionPort,
  createProviderOpportunityExtractionPort,
  readWorkspace,
} from "./local.js";
import {
  createProviderAdapter,
  type ProviderClientFactories,
  type ProviderCredentialResolver,
} from "./local-provider-adapter.js";
import { createMistralAuthorProfile } from "./mistral-development-profile.js";
import { createMistralExtractionProfile } from "./mistral-extraction-profile.js";
import { defaultModelProfileRegistry } from "./model-profiles.js";
import { resolveRunModelProfiles } from "./run-model-profiles.js";

const silent = { write: (_line: string) => undefined };
const authModes = { anthropic: "user-session", openai: "user-session" } as const;
const schema = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
  additionalProperties: false,
} as const;

function selection(): ModelSelection {
  return {
    company: "mistral",
    modelId: mistralLarge4ModelId,
    role: "author",
    promptTemplateVersion: "mistral-runtime-test-v1",
    profile: createMistralAuthorProfile(),
  };
}

function mistralClient(output: JsonObject) {
  const event = {
    data: {
      id: "mistral-test-response",
      object: "chat.completion.chunk",
      created: 1,
      model: mistralLarge4ModelId,
      usage: { promptTokens: 120, completionTokens: 30, totalTokens: 150 },
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: JSON.stringify(output) },
          finishReason: "stop",
        },
      ],
    },
  };
  const stream = vi.fn<MistralClient["chat"]["stream"]>(async () =>
    (async function* () {
      yield event;
    })(),
  );
  const client: MistralClient = { chat: { stream } };
  return { client, stream };
}

async function contextForRun(root: string, contextSnapshotId: string): Promise<ContextSnapshot> {
  const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
  try {
    const record = await storage.getContextSnapshot(contextSnapshotId);
    if (record === undefined) throw new Error("Missing persisted Mistral profile context");
    return record.payload as unknown as ContextSnapshot;
  } finally {
    await storage.close();
  }
}

describe("Mistral application route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses only the dedicated Mistral credential and profile controls", async () => {
    const model = selection();
    const { client, stream } = mistralClient({ answer: "ready" });
    const resolveCredential = vi.fn<ProviderCredentialResolver>(async (provider) =>
      provider === "mistral" ? "synthetic-mistral-key" : "wrong-provider-key",
    );
    const factory = vi.fn(() => client);
    const factories: ProviderClientFactories = { mistral: factory };
    const adapter = await createProviderAdapter(
      {},
      model,
      true,
      resolveCredential,
      factories,
      authModes,
    );
    const policy = providerDataPolicy("mistral", true, authModes);
    const result = await adapter.execute({
      contextSnapshotId: "mistral-runtime-snapshot",
      model,
      systemPrompt: "Return the requested JSON.",
      input: { task: "test" },
      outputSchema: schema,
      outputName: "mistral_test",
      maxOutputTokens: 32768,
      dataPolicy: policy,
    });

    expect(result.output).toEqual({ answer: "ready" });
    expect(resolveCredential.mock.calls).toEqual([["mistral"]]);
    expect(factory).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledWith("synthetic-mistral-key");
    expect(stream.mock.calls[0]?.[0]).toMatchObject({
      model: mistralLarge4ModelId,
      // The author profile keeps reasoning on, which shares the model's 65,536-token limit.
      maxTokens: 65536,
    });
    expect(policy.allowedCompanies).toEqual(["mistral"]);
    expect(policy.requestedRetention).toBe("ephemeral-request");
  });

  it("rejects denied, missing-key, and unknown Mistral routes before constructing a client", async () => {
    const { client } = mistralClient({ answer: "unused" });
    const resolveCredential = vi.fn<ProviderCredentialResolver>(async () => undefined);
    const factory = vi.fn(() => client);
    const factories: ProviderClientFactories = { mistral: factory };
    const model = selection();

    await expect(
      createProviderAdapter({}, model, false, resolveCredential, factories),
    ).rejects.toMatchObject({ provider: "mistral", code: "policy" });
    expect(resolveCredential).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();

    const missing = await createProviderAdapter({}, model, true, resolveCredential, factories).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(missing).toBeInstanceOf(ProviderAdapterError);
    expect(missing).toMatchObject({
      provider: "mistral",
      code: "authentication",
      message: "The Mistral API credential is not configured.",
    });
    expect(resolveCredential.mock.calls).toEqual([["mistral"]]);
    expect(factory).not.toHaveBeenCalled();

    const blank = vi.fn<ProviderCredentialResolver>(async () => "   ");
    await expect(createProviderAdapter({}, model, true, blank, factories)).rejects.toMatchObject({
      code: "authentication",
    });
    expect(factory).not.toHaveBeenCalled();

    const wrongModel = { ...model, modelId: "another-mistral-model" };
    resolveCredential.mockClear();
    await expect(
      createProviderAdapter({}, wrongModel, true, resolveCredential, factories),
    ).rejects.toMatchObject({ provider: "mistral", code: "invalid-request" });
    expect(resolveCredential).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
  });

  it("reads only MISTRAL_API_KEY for Mistral and never falls back to other provider keys", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-key");
    vi.stubEnv("OPENAI_API_KEY", "openai-key");
    vi.stubEnv("DEEPINFRA_API_KEY", "deepinfra-key");
    vi.stubEnv("GEMINI_API_KEY", "gemini-key");
    vi.stubEnv("MISTRAL_API_KEY", "mistral-key");
    await expect(environmentCredentialResolver("mistral")).resolves.toBe("mistral-key");
    await expect(environmentCredentialResolver("google")).resolves.toBe("gemini-key");
    await expect(environmentCredentialResolver("deepinfra")).resolves.toBe("deepinfra-key");
    await expect(environmentCredentialResolver("anthropic")).resolves.toBe("anthropic-key");
    await expect(environmentCredentialResolver("openai")).resolves.toBe("openai-key");

    vi.unstubAllEnvs();
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-key");
    vi.stubEnv("OPENAI_API_KEY", "openai-key");
    vi.stubEnv("DEEPINFRA_API_KEY", "deepinfra-key");
    vi.stubEnv("GEMINI_API_KEY", "gemini-key");
    delete process.env.MISTRAL_API_KEY;
    await expect(environmentCredentialResolver("mistral")).resolves.toBeUndefined();

    // Other providers never pick up the Mistral key either.
    vi.unstubAllEnvs();
    vi.stubEnv("MISTRAL_API_KEY", "mistral-key");
    delete process.env.GEMINI_API_KEY;
    delete process.env.DEEPINFRA_API_KEY;
    await expect(environmentCredentialResolver("google")).resolves.toBeUndefined();
    await expect(environmentCredentialResolver("deepinfra")).resolves.toBeUndefined();
  });

  it("keeps the data destination to Mistral and leaves the other exposure policies unchanged", () => {
    const apiModes = { anthropic: "api-key", openai: "api-key" } as const;
    expect(providerDataPolicy("mistral", true, apiModes).allowedCompanies).toEqual(["mistral"]);
    expect(providerDataPolicy("zai", true, apiModes).allowedCompanies).toEqual(["deepinfra"]);
    expect(providerDataPolicy("google", true, apiModes).allowedCompanies).toEqual(["google"]);
    expect(providerDataPolicy("anthropic", true, apiModes).allowedCompanies).toEqual([
      "anthropic",
      "openai",
      "local",
      "zai",
      "google",
      "mistral",
    ]);
  });

  it("registers the profile and accepts it as a run author alongside the OpenAI critic", () => {
    const apiModes = { anthropic: "api-key", openai: "api-key" } as const;
    const author = defaultModelProfileRegistry.resolve("dev-mistral-author", 1, "author");
    const critic = defaultModelProfileRegistry.resolve("economy-openai-critic", 1, "critic");
    expect(author).toEqual(createMistralAuthorProfile());
    expect(
      resolveRunModelProfiles(
        { author: { id: author.id, version: 1 }, critic: { id: critic.id, version: 1 } },
        defaultModelProfileRegistry,
        apiModes,
      ),
    ).toEqual({ author, critic });
  });

  it("selects the detached extraction profile only for the exact Mistral model", () => {
    expect(canonicalExtractionProfileFor("mistral", mistralLarge4ModelId)).toEqual(
      createMistralExtractionProfile(),
    );
    expect(createMistralExtractionProfile().id).toBe("dev-mistral-extraction");
    expect(createMistralExtractionProfile().version).toBe(2);
    expect(canonicalExtractionProfileFor("mistral", "another-mistral-model")).toBeUndefined();
    expect(canonicalExtractionProfileFor("google", mistralLarge4ModelId)).toBeUndefined();
    expect(canonicalExtractionProfileFor("openai", "gpt-6-luna")).toBeUndefined();
  });

  it("binds the detached extraction profile and exact budget", async () => {
    const root = await mkdtemp(join(tmpdir(), "mistral-canonical-extraction-"));
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
    const { client, stream } = mistralClient(proposal);
    const driver = createLocalApplicationDriver();
    const resolveCredential = vi.fn<ProviderCredentialResolver>(async (provider) =>
      provider === "mistral" ? "synthetic-mistral-key" : undefined,
    );

    try {
      await mkdir(join(root, "evidence"), { recursive: true });
      await writeFile(join(root, "job.md"), "Software engineering role.");
      await driver.initialize(
        {
          root,
          jobDescription: "job.md",
          sources: "evidence",
          authorCompany: "mistral",
          authorModel: mistralLarge4ModelId,
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
          providerClientFactories: { mistral: () => client },
        },
      );

      await expect(
        port.extract({ operationId: "mistral-extraction", sources: [source] }),
      ).resolves.toEqual(proposal);
      expect(resolveCredential.mock.calls).toEqual([["mistral"]]);
      expect(stream.mock.calls[0]?.[0]).toMatchObject({
        model: mistralLarge4ModelId,
        maxTokens: 32768,
        reasoningEffort: "none",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("gives Mistral opportunity extraction a 16,384-token output ceiling", async () => {
    // A live run overran 4,096 tokens on a short job posting; other providers keep 4,096.
    expect(opportunityExtractionMaxOutputTokens("anthropic")).toBe(4096);
    expect(opportunityExtractionMaxOutputTokens("google")).toBe(4096);
    const root = await mkdtemp(join(tmpdir(), "mistral-opportunity-extraction-"));
    const proposal = {
      schemaVersion: 1,
      role: null,
      employer: null,
      responsibilities: [],
      requirements: [],
      priorities: [],
      contradictions: [],
    };
    const { client, stream } = mistralClient(proposal);
    const driver = createLocalApplicationDriver();
    try {
      await mkdir(join(root, "evidence"), { recursive: true });
      await writeFile(join(root, "job.md"), "Software engineering role.");
      await driver.initialize(
        {
          root,
          jobDescription: "job.md",
          sources: "evidence",
          authorCompany: "mistral",
          authorModel: mistralLarge4ModelId,
          criticCompany: "openai",
          criticModel: "gpt-6-luna",
        },
        silent,
      );
      const port = createProviderOpportunityExtractionPort(await readWorkspace(root), {
        allowProviderData: true,
        resolveCredential: async (provider) =>
          provider === "mistral" ? "synthetic-mistral-key" : undefined,
        providerClientFactories: { mistral: () => client },
      });

      await port.extract({
        operationId: "mistral-opportunity",
        sources: [
          {
            id: "job",
            classification: "job-posting",
            status: "available",
            mediaType: "text/plain",
            checksum: "b".repeat(64),
            text: "Requirements: 5+ years of Go.",
          },
        ],
      });
      expect(stream.mock.calls[0]?.[0]).toMatchObject({
        model: mistralLarge4ModelId,
        maxTokens: 16384,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists exact profile controls for a Mistral author with the OpenAI critic and resumes without the registry", async () => {
    const root = await mkdtemp(join(tmpdir(), "mistral-profile-resume-"));
    const author = defaultModelProfileRegistry.resolve("dev-mistral-author", 1, "author");
    const critic = defaultModelProfileRegistry.resolve("economy-openai-critic", 1, "critic");
    const driver = createLocalApplicationDriver();

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
        company: "mistral",
        modelId: mistralLarge4ModelId,
        profile: author,
      });
      expect(persisted.modelConfiguration.critic.company).toBe("openai");
      expect(persisted.modelConfiguration.critic.profile).toEqual(critic);
      // Cross-company pair: Mistral and OpenAI are independent, with no shared-lineage override.
      expect(persisted.modelConfiguration.independentReview).toEqual({
        authorLineage: "mistral:mistral-large-4",
        criticLineage: expect.stringMatching(/^openai:/),
        lineagesDistinct: true,
        required: true,
      });
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
      ).toContainEqual(["mistral", mistralLarge4ModelId]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
