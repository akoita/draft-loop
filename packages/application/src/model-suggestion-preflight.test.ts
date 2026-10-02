import { writeFile } from "node:fs/promises";
import { ProviderAdapterError } from "@draft-loop/providers";
import { describe, expect, it, vi } from "vitest";
import { createDeepInfraGLMAuthorProfile } from "./glm-development-profile.js";
import type { ProviderClientFactories } from "./local-provider-adapter.js";
import { listModelProfileCatalog } from "./model-profile-catalog.js";
import {
  buildModelSuggestionPreflightPlan,
  runModelSuggestionPreflight,
} from "./model-suggestion-preflight.js";

const apiModes = { anthropic: "api-key", openai: "api-key" } as const;
const sessionModes = { anthropic: "user-session", openai: "user-session" } as const;
const providerErrorMarker = "private provider diagnostic marker";

function apiFactories(
  responseFor: (provider: "anthropic" | "openai", modelId: string) => unknown = () => ({
    ready: true,
  }),
) {
  const calls: {
    provider: string;
    modelId: string;
    params: Record<string, unknown>;
    signal: AbortSignal | undefined;
  }[] = [];
  const factories: ProviderClientFactories = {
    anthropic: () =>
      ({
        messages: {
          create: async (
            params: Record<string, unknown>,
            options?: { readonly signal?: AbortSignal },
          ) => {
            const modelId = String(params.model);
            calls.push({ provider: "anthropic", modelId, params, signal: options?.signal });
            const output = responseFor("anthropic", modelId);
            return {
              content: [{ type: "text", text: JSON.stringify(output) }],
              stop_reason: "end_turn",
              usage: { input_tokens: 7, output_tokens: 2 },
            };
          },
        },
      }) as never,
    openai: () =>
      ({
        responses: {
          create: async (
            params: Record<string, unknown>,
            options?: { readonly signal?: AbortSignal },
          ) => {
            const modelId = String(params.model);
            calls.push({ provider: "openai", modelId, params, signal: options?.signal });
            const output = responseFor("openai", modelId);
            return {
              output_text: JSON.stringify(output),
              usage: { input_tokens: 7, output_tokens: 2 },
            };
          },
        },
      }) as never,
  };
  return { factories, calls };
}

describe("registry-derived model-suggestion preflight", () => {
  it("builds four required rows for the active economy and standard destinations", () => {
    const plan = buildModelSuggestionPreflightPlan(sessionModes);

    expect(plan.rows).toHaveLength(4);
    expect(plan.rows.filter(({ required }) => required)).toHaveLength(4);
    expect(plan.rows.filter(({ required }) => !required)).toHaveLength(0);
    expect(plan.rows.map(({ provider, modelId, role }) => [provider, modelId, role])).toEqual([
      ["anthropic", "claude-sonnet-5-5", "author"],
      ["openai", "gpt-6-luna", "critic"],
      ["anthropic", "claude-opus-5-5", "author"],
      ["openai", "gpt-6.1-sol", "critic"],
    ]);
    expect(plan.rows.every((row) => row.profileControls === false)).toBe(true);
    expect(
      plan.rows.filter((row) => row.provider === "openai").map((row) => row.generationCap),
    ).toEqual(["post-response-only", "post-response-only"]);
  });

  it("groups duplicate exact destinations and rejects unsupported companies before execution", async () => {
    const catalog = listModelProfileCatalog();
    const sonnet = catalog[0];
    if (sonnet === undefined) throw new Error("expected a profile catalog");
    const alias = {
      ...sonnet,
      profile: { ...sonnet.profile, id: "sonnet-alias-profile" },
    };
    const grouped = buildModelSuggestionPreflightPlan(apiModes, { catalog: [...catalog, alias] });
    expect(grouped.rows[0]?.profileRefs).toHaveLength(2);

    const openAi = apiFactories();
    await expect(
      runModelSuggestionPreflight({
        authModes: apiModes,
        providerClientFactories: openAi.factories,
        planDependencies: {
          catalog: [
            {
              ...sonnet,
              profile: { ...sonnet.profile, provider: "local" },
            },
          ],
        },
      }),
    ).rejects.toThrow("Model-suggestion preflight configuration is invalid.");
    expect(openAi.calls).toEqual([]);
  });

  it("omits only the exact development GLM profile without creating a DeepInfra request", async () => {
    const catalog = listModelProfileCatalog();
    const template = catalog[0];
    if (template === undefined) throw new Error("expected a profile catalog");
    const developmentEntry = {
      ...template,
      profile: createDeepInfraGLMAuthorProfile(),
    };
    const planned = buildModelSuggestionPreflightPlan(apiModes, {
      catalog: [...catalog, developmentEntry],
    });
    expect(planned.rows).toHaveLength(4);
    expect(JSON.stringify(planned.rows)).not.toContain("deepinfra");

    const { factories, calls } = apiFactories();
    const resolvedProviders: string[] = [];
    const result = await runModelSuggestionPreflight({
      authModes: apiModes,
      providerClientFactories: factories,
      resolveCredential: async (provider) => {
        resolvedProviders.push(provider);
        return "test-only-api-key";
      },
      planDependencies: { catalog: [...catalog, developmentEntry] },
    });
    expect(result.passed).toBe(true);
    expect(result.rows).toHaveLength(4);
    expect(calls).toHaveLength(4);
    expect(resolvedProviders).toHaveLength(4);
    expect(resolvedProviders).not.toContain("deepinfra");
  });

  it("rejects malformed or unknown DeepInfra profiles before any provider calls", async () => {
    const catalog = listModelProfileCatalog();
    const template = catalog[0];
    if (template === undefined) throw new Error("expected a profile catalog");
    const exactProfile = createDeepInfraGLMAuthorProfile();
    const invalidEntries = [
      {
        ...template,
        profile: { ...exactProfile, id: "unknown-deepinfra-profile" },
      },
      {
        ...template,
        profile: { ...exactProfile, runtime: undefined },
      },
    ];
    for (const invalidEntry of invalidEntries) {
      const { factories, calls } = apiFactories();
      await expect(
        runModelSuggestionPreflight({
          authModes: apiModes,
          providerClientFactories: factories,
          planDependencies: {
            catalog: [...catalog, invalidEntry] as unknown as typeof catalog,
          },
        }),
      ).rejects.toThrow("Model-suggestion preflight configuration is invalid.");
      expect(calls).toEqual([]);
    }
  });

  it("uses one bounded request per API destination and reports only exact ready output", async () => {
    const { factories, calls } = apiFactories((provider, modelId) => {
      if (provider === "openai" && modelId === "gpt-6.1-sol") return { ready: false };
      if (provider === "openai" && modelId === "gpt-optional-synthetic")
        return { ready: true, extra: "discard" };
      return { ready: true };
    });
    const catalog = listModelProfileCatalog();
    const economyCritic = catalog.find(({ profile }) => profile.id === "economy-openai-critic");
    if (economyCritic === undefined) throw new Error("Expected an active economy critic profile.");
    const resolveCredential = vi.fn(async () => "test-only-api-key");
    const result = await runModelSuggestionPreflight({
      authModes: apiModes,
      providerClientFactories: factories,
      planDependencies: {
        catalog: [
          ...catalog,
          {
            ...economyCritic,
            profile: {
              ...economyCritic.profile,
              id: "optional-openai-critic",
              modelId: "gpt-optional-synthetic",
              tier: "premium",
            },
          },
        ],
      },
      resolveCredential,
      checkedAt: () => new Date("2026-09-30T12:00:00.000Z"),
    });

    expect(calls).toHaveLength(5);
    expect(calls.every((call) => call.signal instanceof AbortSignal)).toBe(true);
    expect(resolveCredential).toHaveBeenCalledTimes(5);
    expect(result.passed).toBe(false);
    expect(result.checkedAtISO).toBe("2026-09-30T12:00:00.000Z");
    expect(result.rows.find((row) => row.modelId === "gpt-6.1-sol")).toMatchObject({
      required: true,
      status: "unavailable",
      reason: "invalid-response",
    });
    expect(result.rows.find((row) => row.modelId === "gpt-optional-synthetic")).toMatchObject({
      required: false,
      status: "unavailable",
      reason: "invalid-response",
    });
    expect(result.optionalFailures).toEqual([
      expect.objectContaining({ modelId: "gpt-optional-synthetic", role: "critic" }),
    ]);

    const anthropicRequest = calls.find((call) => call.provider === "anthropic");
    const openAiRequest = calls.find((call) => call.provider === "openai");
    expect(anthropicRequest?.params).toMatchObject({
      system: expect.stringContaining('Return exactly {"ready":true}'),
      max_tokens: 1024,
      messages: [
        { role: "user", content: JSON.stringify({ check: "model-suggestion-preflight" }) },
      ],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            required: ["ready"],
            additionalProperties: false,
          },
        },
      },
    });
    expect(anthropicRequest?.params).not.toHaveProperty("thinking");
    expect(
      (anthropicRequest?.params.output_config as Record<string, unknown>) ?? {},
    ).not.toHaveProperty("effort");
    expect(openAiRequest?.params).toMatchObject({
      model: "gpt-6-luna",
      max_output_tokens: 1024,
      store: false,
      text: { format: { type: "json_schema", strict: true } },
    });
    expect(openAiRequest?.params).not.toHaveProperty("reasoning");
    expect(JSON.stringify(result)).not.toContain("test-only-api-key");
    expect(JSON.stringify(result)).not.toContain("discard");
  });

  it("makes one API attempt per current row and retains only fixed error codes", async () => {
    let gptSolCalls = 0;
    const calls: string[] = [];
    const factories: ProviderClientFactories = {
      anthropic: () =>
        ({
          messages: {
            create: async (params: Record<string, unknown>) => {
              calls.push(String(params.model));
              return {
                content: [{ type: "text", text: JSON.stringify({ ready: true }) }],
                stop_reason: "end_turn",
                usage: { input_tokens: 1, output_tokens: 1 },
              };
            },
          },
        }) as never,
      openai: () =>
        ({
          responses: {
            create: async (params: Record<string, unknown>) => {
              const modelId = String(params.model);
              calls.push(modelId);
              if (modelId === "gpt-6.1-sol") {
                gptSolCalls += 1;
                throw new ProviderAdapterError("openai", "rate-limit", providerErrorMarker);
              }
              return {
                output_text: JSON.stringify({ ready: true }),
                usage: { input_tokens: 1, output_tokens: 1 },
              };
            },
          },
        }) as never,
    };
    const result = await runModelSuggestionPreflight({
      authModes: apiModes,
      providerClientFactories: factories,
      resolveCredential: async () => "test-key",
    });
    expect(gptSolCalls).toBe(1);
    expect(calls).toHaveLength(4);
    expect(result.rows.find((row) => row.modelId === "gpt-6.1-sol")?.reason).toBe("rate-limit");
    expect(result.rows.filter((row) => row.status === "available")).toHaveLength(3);
    expect(result.passed).toBe(false);
    expect(JSON.stringify(result)).not.toContain(providerErrorMarker);
    expect(JSON.stringify(result)).not.toContain("test-key");
  });

  it("uses injected Claude and Codex session runners and marks the Codex cap honestly", async () => {
    const claudeCalls: { args: readonly string[]; timeoutMs: number; stdin: string }[] = [];
    const codexCalls: { args: readonly string[]; timeoutMs: number; stdin: string }[] = [];
    const result = await runModelSuggestionPreflight({
      authModes: sessionModes,
      userSessionRunners: {
        anthropic: async (_command, args, options) => {
          claudeCalls.push({ args, timeoutMs: options.timeoutMs, stdin: options.stdin });
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              type: "result",
              subtype: "success",
              is_error: false,
              session_id: "synthetic",
              structured_output: { ready: true },
              usage: { input_tokens: 1, output_tokens: 1 },
            }),
            stderr: providerErrorMarker,
          };
        },
        openai: async (_command, args, options) => {
          codexCalls.push({ args, timeoutMs: options.timeoutMs, stdin: options.stdin });
          const outputPathIndex = args.indexOf("--output-last-message") + 1;
          const outputPath = args[outputPathIndex];
          if (outputPath === undefined) throw new Error("missing output path in test runner");
          await writeFile(outputPath, JSON.stringify({ ready: true }));
          return {
            exitCode: 0,
            stdout: [
              JSON.stringify({ type: "thread.started", thread_id: "synthetic" }),
              JSON.stringify({
                type: "turn.completed",
                usage: { input_tokens: 1, output_tokens: 1 },
              }),
            ].join("\n"),
            stderr: providerErrorMarker,
          };
        },
      },
    });

    expect(result.passed).toBe(true);
    expect(claudeCalls).toHaveLength(2);
    expect(codexCalls).toHaveLength(2);
    expect(claudeCalls[0]).toMatchObject({
      timeoutMs: 60_000,
      stdin: JSON.stringify({ check: "model-suggestion-preflight" }),
    });
    expect(codexCalls[0]?.timeoutMs).toBe(60_000);
    expect(codexCalls[0]?.args).toContain("--output-schema");
    expect(
      result.rows
        .filter((row) => row.provider === "openai")
        .every((row) => row.generationCap === "post-response-only"),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain(providerErrorMarker);
  });
});
