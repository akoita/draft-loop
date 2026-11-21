import type { RunSnapshot } from "@draft-loop/orchestrator";
import type { RefusalFallbackView } from "@draft-loop/ui/model";

/**
 * Each call Claude declined and the fallback model answered (#3120), in run order: the step and
 * round, the model that declined, the one that answered and the refusal's category.
 */
export function refusalFallbackViews(snapshot: RunSnapshot): readonly RefusalFallbackView[] {
  return snapshot.executionHistory.flatMap((execution) =>
    execution.refusalFallback === undefined
      ? []
      : [
          {
            step: execution.step,
            round: execution.round,
            fromModel: execution.refusalFallback.fromModel,
            toModel: execution.modelId,
            category: execution.refusalFallback.category,
          },
        ],
  );
}
