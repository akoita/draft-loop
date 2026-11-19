import type { RunSnapshot } from "@draft-loop/orchestrator";
import type { CriticFallbackView } from "@draft-loop/ui/model";

function company(provider: string): string {
  return provider.trim().toLowerCase();
}

/**
 * The run's switch to its fallback critic (#3123): the critic it replaced, the one that took
 * over, the provider error class and round of the first failure, and whether the fallback now
 * shares the author's company. `null` when the run kept its critic.
 */
export function criticFallbackView(snapshot: RunSnapshot): CriticFallbackView | null {
  const switched = snapshot.executionHistory.find(
    (execution) => execution.step === "critic" && execution.criticFallback !== undefined,
  );
  if (switched?.criticFallback === undefined) return null;
  const author = snapshot.executionHistory.findLast(
    (execution) => execution.step === "author" || execution.step === "revision",
  );
  return {
    fromProvider: switched.criticFallback.fromProvider,
    fromModel: switched.criticFallback.fromModel,
    toProvider: switched.provider,
    toModel: switched.modelId,
    errorClass: switched.criticFallback.errorClass,
    round: switched.criticFallback.round,
    sameCompanyAsAuthor:
      author !== undefined && company(author.provider) === company(switched.provider),
  };
}
