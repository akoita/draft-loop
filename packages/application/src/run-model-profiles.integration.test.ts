import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type ContextSnapshot, deriveModelLineage } from "@draft-loop/domain";
import type { RunSnapshot } from "@draft-loop/orchestrator";
import type { OpenAIClient, UserSessionProcessRunner } from "@draft-loop/providers";
import { openSqliteStorage } from "@draft-loop/storage";
import { expect, it, vi } from "vitest";
import { createLocalApplicationDriver, type ProviderClientFactories } from "./local.js";
import { createModelProfileRegistry } from "./model-profiles.js";

const silent = { write: (_line: string) => undefined };

function testProfiles() {
  const author = {
    id: "snapshot-author",
    version: 1,
    provider: "anthropic",
    modelId: "claude-sonnet-4-5",
    tier: "standard" as const,
    roles: ["author"] as const,
    runtime: {
      effort: "provider-default" as const,
      maxOutputTokens: 12_000,
      thinking: { mode: "budgeted" as const, maxTokens: 2_048 },
    },
    knownLimits: { maxOutputTokens: 64_000 },
  };
  const critic = {
    id: "snapshot-critic",
    version: 1,
    provider: "openai",
    modelId: "gpt-5.6-luna",
    tier: "economy" as const,
    roles: ["critic"] as const,
    runtime: {
      effort: "provider-default" as const,
      maxOutputTokens: 6_144,
      thinking: { mode: "provider-default" as const },
    },
    knownLimits: { maxOutputTokens: 128_000 },
  };
  return { author, critic, registry: createModelProfileRegistry([author, critic]) };
}

async function contextForRun(root: string, contextSnapshotId: string): Promise<ContextSnapshot> {
  const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
  try {
    const record = await storage.getContextSnapshot(contextSnapshotId);
    if (record === undefined) throw new Error("Missing persisted profile context");
    return record.payload as unknown as ContextSnapshot;
  } finally {
    await storage.close();
  }
}

it("persists exact profile snapshots before execution and resumes without registry access", async () => {
  const root = await mkdtemp(join(tmpdir(), "recorded-run-profiles-"));
  const { author, critic, registry } = testProfiles();
  const resolve = vi.fn(registry.resolve);
  const driver = createLocalApplicationDriver({
    modelProfileRegistry: { resolve, list: registry.list },
  });
  try {
    await mkdir(join(root, "evidence"));
    await writeFile(join(root, "job.md"), "TypeScript tools");
    await writeFile(
      join(root, "evidence", "candidate.md"),
      "Built TypeScript tools with deterministic testing.",
    );
    await driver.initialize(
      {
        root,
        jobDescription: "job.md",
        sources: "evidence",
        authorModel: "claude-haiku-4-5",
        authorLineage: "workspace-author-lineage",
        criticLineage: "workspace-critic-lineage",
        fixtureMode: true,
      },
      silent,
    );
    const workspaceBefore = await driver.readWorkspace(root);
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

    expect(resolve.mock.calls).toEqual([
      [author.id, author.version, "author"],
      [critic.id, critic.version, "critic"],
    ]);
    const context = await contextForRun(root, begun.contextSnapshotId);
    expect(context.modelConfiguration.author).toMatchObject({
      company: "anthropic",
      modelId: author.modelId,
      promptTemplateVersion: "cli-author-v5",
      profile: author,
    });
    expect(context.modelConfiguration.critic).toMatchObject({
      company: "openai",
      modelId: critic.modelId,
      promptTemplateVersion: "cli-critic-v3",
      profile: critic,
    });
    expect(context.modelConfiguration.author.lineage).toBeUndefined();
    expect(deriveModelLineage(context.modelConfiguration.author)).toBe(
      deriveModelLineage({ company: author.provider, modelId: author.modelId }),
    );
    expect(context.modelConfiguration.critic.lineage).toBe("workspace-critic-lineage");
    expect((await driver.readWorkspace(root)).author.model).toBe(workspaceBefore.author.model);

    const configPath = join(root, ".draft-loop", "workspace.json");
    const savedConfig = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
    await writeFile(
      configPath,
      `${JSON.stringify({ ...savedConfig, authorModel: "claude-opus-test-after-begin" })}\n`,
    );

    const throwingRegistry = {
      resolve: vi.fn(() => {
        throw new Error("resume must not resolve profiles");
      }),
      list: vi.fn(() => []),
    };
    const restarted = createLocalApplicationDriver({ modelProfileRegistry: throwingRegistry });
    const resumed = await restarted.resume({ root, runId: begun.runId }, silent);

    expect(throwingRegistry.resolve).not.toHaveBeenCalled();
    expect((await restarted.readWorkspace(root)).author.model).toBe("claude-opus-test-after-begin");
    expect(resumed.executionHistory.map(({ provider, modelId }) => [provider, modelId])).toEqual([
      [author.provider, author.modelId],
      [critic.provider, critic.modelId],
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects invalid profile references before persisting run or context records", async () => {
  const root = await mkdtemp(join(tmpdir(), "invalid-run-profiles-"));
  const { author, critic, registry } = testProfiles();
  const driver = createLocalApplicationDriver({ modelProfileRegistry: registry });
  try {
    await mkdir(join(root, "evidence"));
    await writeFile(join(root, "job.md"), "Platform engineer");
    await writeFile(join(root, "evidence", "candidate.md"), "Built TypeScript tools.");
    await driver.initialize(
      { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
      silent,
    );
    const workspace = await driver.readWorkspace(root);
    await expect(
      driver.begin(
        {
          root,
          modelProfiles: {
            author: { id: "unknown-profile", version: 1 },
            critic: { id: critic.id, version: critic.version },
          },
        },
        silent,
      ),
    ).rejects.toThrow("selected model profiles are invalid or unsupported");
    const unsupportedRoute = createLocalApplicationDriver({
      modelProfileRegistry: registry,
      providerAuthModeConfiguration: { anthropic: "api-key", openai: "user-session" },
    });
    await expect(
      unsupportedRoute.begin(
        {
          root,
          modelProfiles: {
            author: { id: author.id, version: author.version },
            critic: { id: critic.id, version: critic.version },
          },
        },
        silent,
      ),
    ).rejects.toThrow("selected model profiles are invalid or unsupported");
    const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
    try {
      expect(await storage.listRuns(workspace.id)).toEqual([]);
    } finally {
      await storage.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each(["start", "begin-resume"] as const)(
  "uses the saved profile identities and budgets for Claude and OpenAI requests on %s",
  async (phase) => {
    const root = await mkdtemp(join(tmpdir(), "profile-runtime-controls-"));
    const { author, critic, registry } = testProfiles();
    const resolve = vi.fn(registry.resolve);
    const claudeCalls: { args: readonly string[]; env: NodeJS.ProcessEnv; budget: unknown }[] = [];
    const claudeRunner: UserSessionProcessRunner = vi.fn(async (_command, args, options) => {
      const input = JSON.parse(options.stdin) as {
        readonly retrievedEvidence: readonly { readonly id: string; readonly text: string }[];
        readonly outputBudget: unknown;
      };
      claudeCalls.push({ args, env: options.env, budget: input.outputBudget });
      const evidence =
        input.retrievedEvidence.find(({ text }) =>
          text.includes("Built TypeScript tools with deterministic testing."),
        ) ?? input.retrievedEvidence[0];
      if (evidence === undefined) throw new Error("Missing evidence in fake request");
      const claim = evidence.text;
      return {
        exitCode: 0,
        stderr: "",
        stdout: JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          session_id: "profile-author-session",
          usage: { input_tokens: 100, output_tokens: 100 },
          structured_output: {
            sections: [
              {
                title: "Summary",
                kind: "summary",
                blocks: [
                  {
                    type: "paragraph",
                    text: claim,
                    claims: [{ text: claim, substantive: true, evidenceChunkIds: [evidence.id] }],
                  },
                ],
              },
            ],
          },
        }),
      };
    });
    type OpenAIParams = Parameters<OpenAIClient["responses"]["create"]>[0];
    const openAiCalls: OpenAIParams[] = [];
    const openAiResponse = {
      id: "profile-critic-response",
      model: critic.modelId,
      output_text: JSON.stringify({ findings: [] }),
      usage: {
        input_tokens: 100,
        output_tokens: 10,
        total_tokens: 110,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
      _request_id: "profile-critic-request",
    };
    const openAiClient = {
      responses: {
        create: async (params: OpenAIParams) => {
          openAiCalls.push(params);
          return openAiResponse as never;
        },
      },
    } as unknown as OpenAIClient;
    const factories: ProviderClientFactories = { openai: () => openAiClient };
    const providerAuthModeConfiguration = {
      anthropic: "user-session" as const,
      openai: "api-key" as const,
    };
    const providerOptions = {
      modelProfileRegistry: { resolve, list: registry.list },
      providerAuthModeConfiguration,
      userSessionRunners: { anthropic: claudeRunner },
      resolveCredential: async () => "fake-openai-key",
      providerClientFactories: factories,
    };
    const driver = createLocalApplicationDriver(providerOptions);
    try {
      await mkdir(join(root, "evidence"));
      await writeFile(join(root, "job.md"), "TypeScript tools");
      await writeFile(
        join(root, "evidence", "candidate.md"),
        "Built TypeScript tools with deterministic testing.",
      );
      await driver.initialize(
        {
          root,
          jobDescription: "job.md",
          sources: "evidence",
          authorModel: "claude-haiku-4-5",
          authorLineage: "workspace-author-lineage",
          criticLineage: "workspace-critic-lineage",
          maxRounds: 1,
        },
        silent,
      );
      const command = {
        root,
        allowProviderData: true,
        modelProfiles: {
          author: { id: author.id, version: author.version },
          critic: { id: critic.id, version: critic.version },
        },
      };
      let initial: RunSnapshot;
      if (phase === "start") {
        initial = await driver.start(command, silent);
      } else {
        const begun = await driver.begin(command, silent);
        const configPath = join(root, ".draft-loop", "workspace.json");
        const savedConfig = JSON.parse(await readFile(configPath, "utf8")) as Record<
          string,
          unknown
        >;
        await writeFile(
          configPath,
          `${JSON.stringify({ ...savedConfig, authorModel: "claude-opus-test-after-begin" })}\n`,
        );
        const throwingRegistry = {
          resolve: vi.fn(() => {
            throw new Error("resume must not resolve profiles");
          }),
          list: vi.fn(() => []),
        };
        const restarted = createLocalApplicationDriver({
          ...providerOptions,
          modelProfileRegistry: throwingRegistry,
        });
        initial = await restarted.resume(
          { root, runId: begun.runId, allowProviderData: true },
          silent,
        );
        expect(throwingRegistry.resolve).not.toHaveBeenCalled();
        expect((await restarted.readWorkspace(root)).author.model).toBe(
          "claude-opus-test-after-begin",
        );
      }

      expect(claudeCalls).toHaveLength(1);
      expect(claudeCalls[0]?.args).toContain(author.modelId);
      expect(claudeCalls[0]?.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe("12000");
      expect(claudeCalls[0]?.env.MAX_THINKING_TOKENS).toBe("2048");
      expect(claudeCalls[0]?.budget).toEqual({ maxOutputTokens: 12_000 });
      expect(initial.lastError ?? null).toBeNull();
      expect(resolve.mock.calls).toEqual([
        [author.id, author.version, "author"],
        [critic.id, critic.version, "critic"],
      ]);
      expect(openAiCalls).toHaveLength(1);
      expect(openAiCalls[0]).toMatchObject({
        model: critic.modelId,
        max_output_tokens: 6_144,
        store: false,
      });
      expect(openAiCalls[0]).not.toHaveProperty("reasoning");
      expect((await driver.readWorkspace(root)).author.model).toBe(
        phase === "start" ? "claude-haiku-4-5" : "claude-opus-test-after-begin",
      );
      const context = await contextForRun(root, initial.contextSnapshotId);
      expect(context.modelConfiguration.author.lineage).toBeUndefined();
      expect(context.modelConfiguration.critic.lineage).toBe("workspace-critic-lineage");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
