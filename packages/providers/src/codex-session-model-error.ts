import { ProviderAdapterError } from "./index.js";

export const codexSessionModelUnsupportedDiagnosticCode =
  "codex_session_model_unsupported" as const;

const unsupportedModelPhrase = "model is not supported when using codex with a chatgpt account";

interface UserSessionFailureOutput {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Recognize only Codex's explicit ChatGPT-account unsupported-model response. */
export function codexSessionModelUnsupportedError(
  provider: "anthropic" | "openai",
  result: UserSessionFailureOutput,
): ProviderAdapterError | undefined {
  if (provider !== "openai" || result.exitCode === 0) return undefined;
  const details = `${result.stdout}\n${result.stderr}`.toLowerCase();
  if (!details.includes(unsupportedModelPhrase)) return undefined;

  return new ProviderAdapterError(
    "openai",
    "invalid-request",
    "The selected model is not supported by this Codex ChatGPT account.",
    {
      retryable: false,
      diagnostics: [{ code: codexSessionModelUnsupportedDiagnosticCode, path: "model" }],
    },
  );
}
