import type { SemanticRelevanceFloor } from "@draft-loop/embeddings";
import type { CoverageJudgementPlanner } from "@draft-loop/orchestrator";
import { assessRequirementCoverage, coverageJudgementRequestsFrom } from "@draft-loop/validation";

import type { EmbeddingModelTier } from "./embedding-model-install.js";
import {
  openRunEmbedder,
  type RunSemanticRetrievalOptions,
  runEmbeddingModelRoot,
} from "./run-semantic-retrieval.js";
import { attachSemanticCoverageCandidates } from "./semantic-coverage-candidates.js";
import { readWorkspaceRetrievalMode } from "./workspace-retrieval-mode.js";

/*
 * Plans the critic's coverage judgements for a run (#961).
 *
 * Every lexically uncovered requirement is sent to the critic, which judges it against the whole
 * draft inside its existing call (#1208). With an installed local embedding model, the
 * assessments also gain semantic candidates as hints. Without a model, or when the semantic step
 * fails, the requests carry no candidates rather than disappearing, so a requirement met in other
 * words is still found (#1835). The deterministic validation of the
 * critic step passes no explicit gaps, so none are passed here.
 */

type OpenEmbedderOptions = Pick<RunSemanticRetrievalOptions, "tier" | "modelRoot">;

export interface RunCoverageJudgementPlannerOptions {
  /** Workspace root; its retrieval-mode setting chooses the model tier. */
  readonly root: string;
  /** Defaults to the process model root. */
  readonly modelRoot?: string;
  /** Test seam; defaults to the process-shared embedder cache used by semantic retrieval. */
  readonly open?: (options: OpenEmbedderOptions) => ReturnType<typeof openRunEmbedder>;
  /** Overrides the embedder's calibrated relevance floor; a test seam. */
  readonly floor?: SemanticRelevanceFloor;
}

export function createRunCoverageJudgementPlanner(
  options: RunCoverageJudgementPlannerOptions,
): CoverageJudgementPlanner {
  const open = options.open ?? openRunEmbedder;
  // The tier is read once per planner; an unreadable setting disables only this optional step.
  let tier: Promise<EmbeddingModelTier | undefined> | undefined;
  const readTier = (): Promise<EmbeddingModelTier | undefined> => {
    tier ??= readWorkspaceRetrievalMode(options.root).then(
      ({ modelTier }) => modelTier,
      () => undefined,
    );
    return tier;
  };

  return {
    plan: async ({ artifact, context, signal }) => {
      const baseline = assessRequirementCoverage(context.requirements, artifact);
      const lexical = { assessments: baseline, requests: coverageJudgementRequestsFrom(baseline) };
      const modelTier = await readTier();
      if (modelTier === undefined) return lexical;
      const opened = await open({
        tier: modelTier,
        modelRoot: options.modelRoot ?? runEmbeddingModelRoot(),
      });
      if (!opened.ok) return lexical;
      try {
        const candidates = await attachSemanticCoverageCandidates({
          assessments: baseline,
          requirements: context.requirements,
          artifact,
          embedder: opened.embedder,
          ...(options.floor === undefined ? {} : { floor: options.floor }),
          ...(signal === undefined ? {} : { signal }),
        });
        return {
          assessments: candidates.assessments,
          requests: coverageJudgementRequestsFrom(candidates.assessments),
        };
      } catch (error) {
        if (signal?.aborted === true) throw error;
        return lexical;
      }
    },
  };
}
