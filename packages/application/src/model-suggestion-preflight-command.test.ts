import { describe, expect, it, vi } from "vitest";
import type { ProviderClientFactories } from "./local-provider-adapter.js";
import {
  parseCliVersionOutput,
  runModelSuggestionPreflightCommand,
} from "./model-suggestion-preflight-command.js";

function apiFactories(calls: string[]): ProviderClientFactories {
  return {
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
            calls.push(String(params.model));
            return {
              output_text: JSON.stringify({ ready: true }),
              usage: { input_tokens: 1, output_tokens: 1 },
            };
          },
        },
      }) as never,
  };
}

describe("model-suggestion preflight command", () => {
  it("keeps only a bounded plain CLI version from version-only output", () => {
    expect(parseCliVersionOutput("2.1.300 (Claude Code)\nprivate-marker")).toBe("2.1.300");
    expect(parseCliVersionOutput("codex-cli 0.134.0")).toBe("0.134.0");
    expect(parseCliVersionOutput("unexpected diagnostics private-marker")).toBeNull();
    expect(parseCliVersionOutput("x".repeat(129))).toBeNull();
  });

  it("prints a provider-free plan and probes only bounded session CLI versions", async () => {
    const output: string[] = [];
    const probes: string[] = [];
    const resolveCredential = vi.fn(async () => "credential-marker");
    const adapterCalls: string[] = [];
    const status = await runModelSuggestionPreflightCommand(["--plan"], {
      environment: {},
      probeCliVersion: (command) => {
        probes.push(command);
        return command === "claude" ? "2.1.300" : "0.134.0";
      },
      resolveCredential,
      providerClientFactories: apiFactories(adapterCalls),
      writeStdout: (value) => output.push(value),
      writeStderr: (value) => output.push(value),
    });

    const plan = JSON.parse(output[0] ?? "null") as Record<string, unknown>;
    expect(status).toBe(0);
    expect(plan.mode).toBe("plan");
    expect(plan.authModes).toEqual({ anthropic: "api-key", openai: "user-session" });
    expect(plan.cliVersions).toEqual({ claude: null, codex: "0.134.0" });
    expect(plan.rows as unknown[]).toHaveLength(4);
    expect(probes).toEqual(["codex"]);
    expect(resolveCredential).not.toHaveBeenCalled();
    expect(adapterCalls).toEqual([]);
    expect(output.join("\n")).not.toContain("credential-marker");
  });

  it("refuses CI before planning, CLI version probes, or adapter creation", async () => {
    const output: string[] = [];
    const probes: string[] = [];
    const adapterCalls: string[] = [];
    const status = await runModelSuggestionPreflightCommand(["--plan"], {
      environment: { GITHUB_ACTIONS: "true" },
      probeCliVersion: (command) => {
        probes.push(command);
        return null;
      },
      providerClientFactories: apiFactories(adapterCalls),
      writeStdout: (value) => output.push(value),
      writeStderr: (value) => output.push(value),
    });

    expect(status).toBe(2);
    expect(probes).toEqual([]);
    expect(adapterCalls).toEqual([]);
    expect(output.join("\n")).toContain("local-only");
  });

  it("rejects invalid auth modes and unknown arguments without probing or calling adapters", async () => {
    for (const argsAndEnvironment of [
      { args: ["--plan"], environment: { DRAFT_LOOP_OPENAI_AUTH_MODE: "oauth" } },
      { args: ["--provider", "anthropic"], environment: {} },
    ]) {
      const output: string[] = [];
      const probes: string[] = [];
      const calls: string[] = [];
      const status = await runModelSuggestionPreflightCommand(argsAndEnvironment.args, {
        environment: argsAndEnvironment.environment,
        probeCliVersion: (command) => {
          probes.push(command);
          return null;
        },
        providerClientFactories: apiFactories(calls),
        writeStdout: (value) => output.push(value),
        writeStderr: (value) => output.push(value),
      });
      expect(status).toBe(2);
      expect(probes).toEqual([]);
      expect(calls).toEqual([]);
    }
  });

  it("performs all four explicitly requested live checks and returns only safe rows", async () => {
    const output: string[] = [];
    const calls: string[] = [];
    const status = await runModelSuggestionPreflightCommand([], {
      environment: {
        DRAFT_LOOP_ANTHROPIC_AUTH_MODE: "api-key",
        DRAFT_LOOP_OPENAI_AUTH_MODE: "api-key",
      },
      resolveCredential: async () => "synthetic-secret",
      providerClientFactories: apiFactories(calls),
      writeStdout: (value) => output.push(value),
      writeStderr: (value) => output.push(value),
    });

    const result = JSON.parse(output[0] ?? "null") as Record<string, unknown>;
    expect(status).toBe(0);
    expect(calls).toHaveLength(4);
    expect(result.passed).toBe(true);
    expect(result.rows as unknown[]).toHaveLength(4);
    expect(output.join("\n")).not.toContain("synthetic-secret");
  });

  it("prints help without probing or invoking a provider", async () => {
    const output: string[] = [];
    const probes: string[] = [];
    const calls: string[] = [];
    const status = await runModelSuggestionPreflightCommand(["--help"], {
      environment: { CI: "true" },
      probeCliVersion: (command) => {
        probes.push(command);
        return null;
      },
      providerClientFactories: apiFactories(calls),
      writeStdout: (value) => output.push(value),
    });
    expect(status).toBe(0);
    expect(output.join("\n")).toContain("--plan");
    expect(probes).toEqual([]);
    expect(calls).toEqual([]);
  });
});
