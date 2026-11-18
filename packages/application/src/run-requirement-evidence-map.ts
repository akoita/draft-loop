import type { ContextSnapshot, ScoredEvidenceChunk } from "@draft-loop/domain";

import {
  buildRequirementEvidenceMap,
  type RequirementEvidenceMap,
} from "./requirement-evidence-map.js";
import {
  openRunEmbedder,
  type RunSemanticRetrievalOptions,
  runEmbeddingModelRoot,
} from "./run-semantic-retrieval.js";

export interface RequirementEvidenceMapRuntime {
  /** Every eligible chunk of the pinned sources; empty when the run does not use full source. */
  readonly fullSourceEvidence: () => Promise<readonly ScoredEvidenceChunk[]>;
}

export type RunRequirementEvidenceMapOptions = Pick<
  RunSemanticRetrievalOptions,
  "tier" | "modelService" | "createEmbedder" | "shareEmbedder" | "relevanceFloor"
> & { readonly modelRoot?: string };

/**
 * Give a run's retrieval a memoized requirement-evidence map (#2981). The map is built once, from
 * the same eligible chunks full source sends, with the process-shared local embedder when one is
 * installed. It is undefined when the job has no requirements or the run has no eligible chunks.
 */
export function withRequirementEvidenceMap<Runtime extends RequirementEvidenceMapRuntime>(
  runtime: Runtime,
  context: Pick<ContextSnapshot, "requirements">,
  options: RunRequirementEvidenceMapOptions,
): Runtime & {
  readonly requirementEvidenceMap: () => Promise<RequirementEvidenceMap | undefined>;
} {
  let map: Promise<RequirementEvidenceMap | undefined> | undefined;
  const requirementEvidenceMap = () => {
    map ??= (async () => {
      const requirements = (context.requirements ?? []).map(({ id, text }) => ({ id, text }));
      if (requirements.length === 0) return undefined;
      const eligible = await runtime.fullSourceEvidence();
      if (eligible.length === 0) return undefined;
      const opened = await openRunEmbedder({
        tier: options.tier,
        modelRoot: options.modelRoot ?? runEmbeddingModelRoot(),
        ...(options.modelService === undefined ? {} : { modelService: options.modelService }),
        ...(options.createEmbedder === undefined ? {} : { createEmbedder: options.createEmbedder }),
        ...(options.shareEmbedder === undefined ? {} : { shareEmbedder: options.shareEmbedder }),
      }).catch(() => ({ ok: false as const }));
      return buildRequirementEvidenceMap({
        requirements,
        eligible,
        ...(opened.ok ? { embedder: opened.embedder } : { unavailableReason: "no-model" as const }),
        ...(options.relevanceFloor === undefined ? {} : { floor: options.relevanceFloor }),
      });
    })();
    return map;
  };
  return { ...runtime, requirementEvidenceMap };
}
