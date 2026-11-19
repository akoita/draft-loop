import type { CriticAgent } from "@draft-loop/orchestrator";
import { CliUserError } from "./cli-user-error.js";
import { runCriticWithFallback } from "./critic-fallback.js";
import {
  createProviderCriticAgent,
  type ProviderCriticAgentDependencies,
} from "./provider-critic-agent.js";
import { criticRecorderDependencies, type RunRecorders } from "./run-application-plan.js";

/**
 * The local driver's provider critic: its identity, CLI user errors, the run's recorders, and the
 * deployment's fallback critic when the run names one (#3131).
 */
export function createRecordedCriticAgent(
  context: ProviderCriticAgentDependencies["context"],
  identity: { readonly company: string; readonly modelId: string },
  recorders: RunRecorders | undefined,
  deps: Pick<ProviderCriticAgentDependencies, "promptContext" | "dataPolicy" | "createAdapter">,
): CriticAgent {
  return runCriticWithFallback(identity, recorders?.criticFallback, (company, modelId) =>
    createProviderCriticAgent({
      context,
      ...deps,
      criticCompany: company,
      criticModel: modelId,
      userError: (message) => new CliUserError(message),
      ...criticRecorderDependencies(recorders),
    }),
  );
}
