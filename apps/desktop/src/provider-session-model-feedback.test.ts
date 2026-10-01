import { codexSessionModelUnsupportedDiagnosticCode } from "@draft-loop/providers";
import { describe, expect, it } from "vitest";

import { providerSessionModelFeedback } from "./provider-session-model-feedback.js";

const fallback = "The provider rejected the request configuration.";
const codexDiagnostic = { code: codexSessionModelUnsupportedDiagnosticCode, path: "model" };

describe("provider session model feedback", () => {
  it("shows fixed guidance only for the OpenAI Codex unsupported-model diagnostic", () => {
    expect(
      providerSessionModelFeedback({
        code: "invalid-request",
        provider: "openai",
        diagnostics: [codexDiagnostic],
        fallbackExplanation: fallback,
      }),
    ).toBe(
      "This model is not supported by the Codex / ChatGPT session. Choose a model supported by your account, or explicitly switch OpenAI authentication to an API key and check model access.",
    );
  });

  it.each([
    { code: "invalid-request", provider: "anthropic", diagnostics: [codexDiagnostic] },
    { code: "permission", provider: "openai", diagnostics: [codexDiagnostic] },
    {
      code: "invalid-request",
      provider: "openai",
      diagnostics: [{ ...codexDiagnostic, path: "other" }],
    },
    {
      code: "invalid-request",
      provider: "openai",
      diagnostics: [{ code: "unknown_private_marker", path: "model" }],
    },
  ] as const)("keeps fallback guidance for unrelated feedback %#", (input) => {
    expect(
      providerSessionModelFeedback({
        ...input,
        fallbackExplanation: fallback,
      }),
    ).toBe(fallback);
  });
});
