import { codexSessionModelUnsupportedDiagnosticCode } from "@draft-loop/providers";

import type { ProviderFailureDiagnostic, ProviderFailureView } from "./model.js";

export interface ProviderSessionModelFeedbackInput {
  readonly code: ProviderFailureView["code"];
  readonly provider: string;
  readonly diagnostics: readonly ProviderFailureDiagnostic[];
  readonly fallbackExplanation: string;
}

/** Add actionable guidance only for the recognized Codex ChatGPT model rejection. */
export function providerSessionModelFeedback(input: ProviderSessionModelFeedbackInput): string {
  if (
    input.provider === "openai" &&
    input.code === "invalid-request" &&
    input.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === codexSessionModelUnsupportedDiagnosticCode &&
        diagnostic.path === "model",
    )
  ) {
    return "This model is not supported by the Codex / ChatGPT session. Choose a model supported by your account, or explicitly switch OpenAI authentication to an API key and check model access.";
  }
  return input.fallbackExplanation;
}
