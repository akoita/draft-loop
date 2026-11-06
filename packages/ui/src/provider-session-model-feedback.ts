import type { codexSessionModelUnsupportedDiagnosticCode as providerCode } from "@draft-loop/providers";

import type { ProviderFailureDiagnostic, ProviderFailureView } from "./model.js";

/**
 * The providers package's code, typed against it so a change there fails the build. Loading the
 * package itself would pull its SDKs and Node-only code into a browser bundle.
 */
const codexSessionModelUnsupportedDiagnosticCode: typeof providerCode =
  "codex_session_model_unsupported";

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
