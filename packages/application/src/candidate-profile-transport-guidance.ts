import type { ProviderAdapterError } from "@draft-loop/providers";

const timeoutPhaseMessages = new Map<string, string>([
  [
    "stream_timeout_initial",
    "DeepInfra did not begin the GLM response in time. Check provider status or the network connection; no facts were saved.",
  ],
  [
    "stream_timeout_idle",
    "The DeepInfra GLM stream stopped producing chunks. Check provider status or the network connection; no facts were saved.",
  ],
  [
    "stream_timeout_total",
    "The DeepInfra GLM stream exceeded its total time limit. Check provider status or the network connection; no facts were saved.",
  ],
]);

const genericTimeoutMessage =
  "The DeepInfra GLM response timed out. Check provider status or the network connection, or choose another supported model; no facts were saved.";
const genericTransientMessage =
  "DeepInfra temporarily failed while generating the GLM profile. Check provider status or the network connection, then retry; no facts were saved.";

const transientStatusMessages = new Map<number, string>([
  [
    500,
    "DeepInfra returned HTTP 500 while generating the GLM profile. Check provider status or the network connection; no facts were saved.",
  ],
  [
    502,
    "DeepInfra returned HTTP 502 while generating the GLM profile. Check provider status or the network connection; no facts were saved.",
  ],
  [
    503,
    "DeepInfra returned HTTP 503 while generating the GLM profile. Check provider status or the network connection; no facts were saved.",
  ],
  [
    504,
    "DeepInfra returned HTTP 504 while generating the GLM profile. Check provider status or the network connection; no facts were saved.",
  ],
]);

/** Return fixed transport guidance only for recognized DeepInfra GLM failure classes. */
export function deepInfraProfileTransportFailureMessage(
  error: ProviderAdapterError,
): string | undefined {
  if (error.provider !== "deepinfra") return undefined;

  if (error.code === "timeout") {
    const phases = new Set(
      error.diagnostics.flatMap((diagnostic) =>
        timeoutPhaseMessages.has(diagnostic.code) ? [diagnostic.code] : [],
      ),
    );
    if (phases.size !== 1) return genericTimeoutMessage;
    return timeoutPhaseMessages.get([...phases][0] ?? "") ?? genericTimeoutMessage;
  }

  if (error.code === "transient") {
    return transientStatusMessages.get(error.status ?? -1) ?? genericTransientMessage;
  }

  return undefined;
}
