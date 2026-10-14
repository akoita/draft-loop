import type { ModelSelection } from "@draft-loop/domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AnthropicClaudeUserSessionAdapter,
  defaultUserSessionTimeoutMs,
  type ModelRequest,
  ProviderAdapterError,
  UserSessionProcessError,
} from "./index.js";

// Simulates Windows, where removing the working directory of a runtime that
// was just killed fails with EBUSY while the process is still exiting.
const cleanup = vi.hoisted(() => ({ failures: 0, attempts: [] as string[] }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rm: async (...args: Parameters<typeof actual.rm>) => {
      const [target] = args;
      if (String(target).includes("draft-loop-provider-")) {
        cleanup.attempts.push(String(target));
        if (cleanup.failures > 0) {
          cleanup.failures -= 1;
          throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
        }
      }
      return actual.rm(...args);
    },
  };
});

const anthropicModel: ModelSelection = {
  company: "anthropic",
  modelId: "claude-exact",
  role: "author",
  promptTemplateVersion: "author-v1",
};

const request: ModelRequest = {
  contextSnapshotId: "snapshot-user-session-cleanup",
  model: anthropicModel,
  systemPrompt: "Return JSON only.",
  input: { question: "answer?" },
  outputSchema: {
    type: "object",
    properties: { answer: { type: "string" } },
    required: ["answer"],
    additionalProperties: false,
  },
  outputName: "answer_schema",
  maxOutputTokens: 20,
  dataPolicy: {
    allowTransmission: true,
    allowedCompanies: ["anthropic", "openai"],
    sensitiveData: false,
    sensitiveDataAcknowledged: false,
  },
};

afterEach(async () => {
  const { rm } = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  for (const directory of new Set(cleanup.attempts)) {
    await rm(directory, { recursive: true, force: true });
  }
  cleanup.failures = 0;
  cleanup.attempts = [];
});

describe("user-session temporary directory cleanup", () => {
  it("gives a full-source author step ten minutes by default", () => {
    expect(defaultUserSessionTimeoutMs).toBe(600_000);
  });

  it("reports a timeout as a timeout when the working directory cannot be removed", async () => {
    cleanup.failures = Number.POSITIVE_INFINITY;
    const adapter = new AnthropicClaudeUserSessionAdapter({
      configuredModel: anthropicModel,
      runner: async () => {
        throw new UserSessionProcessError("timeout");
      },
    });

    const error = await adapter.execute(request).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderAdapterError);
    expect(error).toMatchObject({ code: "timeout", retryable: true });
    expect(cleanup.attempts.length).toBeGreaterThan(0);
  });

  it("returns a finished response when the first cleanup attempt fails", async () => {
    cleanup.failures = 1;
    const adapter = new AnthropicClaudeUserSessionAdapter({
      configuredModel: anthropicModel,
      runner: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          session_id: "claude-session",
          structured_output: { answer: "yes" },
          usage: { input_tokens: 9, output_tokens: 4 },
          permission_denials: [],
        }),
        stderr: "",
      }),
    });

    await expect(adapter.execute(request)).resolves.toMatchObject({ output: { answer: "yes" } });
    expect(cleanup.attempts).toHaveLength(2);
  });

  it("returns a finished response when every cleanup attempt fails", async () => {
    cleanup.failures = Number.POSITIVE_INFINITY;
    const adapter = new AnthropicClaudeUserSessionAdapter({
      configuredModel: anthropicModel,
      runner: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          session_id: "claude-session",
          structured_output: { answer: "yes" },
          usage: { input_tokens: 9, output_tokens: 4 },
          permission_denials: [],
        }),
        stderr: "",
      }),
    });

    await expect(adapter.execute(request)).resolves.toMatchObject({ output: { answer: "yes" } });
  });
});
