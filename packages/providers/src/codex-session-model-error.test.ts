import { describe, expect, it } from "vitest";

import {
  codexSessionModelUnsupportedDiagnosticCode,
  codexSessionModelUnsupportedError,
} from "./codex-session-model-error.js";

describe("Codex ChatGPT-session unsupported-model diagnosis", () => {
  it("returns a fixed non-retryable invalid-request error for the explicit message", () => {
    const error = codexSessionModelUnsupportedError("openai", {
      exitCode: 1,
      stdout: "MODEL IS NOT SUPPORTED WHEN USING CODEX WITH A CHATGPT ACCOUNT",
      stderr: "private account marker",
    });

    expect(error).toMatchObject({
      code: "invalid-request",
      retryable: false,
      message: "The selected model is not supported by this Codex ChatGPT account.",
      diagnostics: [{ code: codexSessionModelUnsupportedDiagnosticCode, path: "model" }],
    });
    expect(JSON.stringify(error)).not.toContain("private account marker");
  });

  it("does not classify a successful process even if output contains the phrase", () => {
    expect(
      codexSessionModelUnsupportedError("openai", {
        exitCode: 0,
        stdout: "model is not supported when using Codex with a ChatGPT account",
        stderr: "",
      }),
    ).toBeUndefined();
  });

  it.each([
    ["anthropic", "model is not supported when using Codex with a ChatGPT account"],
    ["openai", "this model is unsupported by another runtime"],
    ["openai", "login required; private marker"],
  ] as const)("leaves unrelated %s process output unclassified", (provider, output) => {
    expect(
      codexSessionModelUnsupportedError(provider, {
        exitCode: 1,
        stdout: output,
        stderr: "",
      }),
    ).toBeUndefined();
  });
});
