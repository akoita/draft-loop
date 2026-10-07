import type { CoverageJudgementPlanner } from "@draft-loop/orchestrator";
import type { RetrievalPort } from "@draft-loop/storage";

import type { CandidateKnowledgeSensitivityExclusions } from "./candidate-knowledge-sensitivity-exclusion.js";
import { createRunCoverageJudgementPlanner } from "./run-coverage-judgement.js";
import type { RunOptions } from "./run-model-profiles.js";

/** The trailing, run-scoped arguments of the engine factory, in its parameter order. */
export type RunEngineTail = readonly [
  userSessionRunners: RunOptions["userSessionRunners"],
  userSessionTimeoutMs: RunOptions["userSessionTimeoutMs"],
  retrieval: RetrievalPort | undefined,
  authorProposalCaptureDirectory: string | undefined,
  localClaudeCategoryCaptureParent: string | undefined,
  withheld: CandidateKnowledgeSensitivityExclusions | undefined,
  coverageJudgement: CoverageJudgementPlanner,
];

/** Gathers the run-scoped engine arguments that start, begin, and resume pass identically. */
export function runEngineTail(
  options: RunOptions,
  retrieval: RetrievalPort | undefined,
  withheld: CandidateKnowledgeSensitivityExclusions | undefined,
  root: string,
): RunEngineTail {
  return [
    options.userSessionRunners,
    options.userSessionTimeoutMs,
    retrieval,
    options.authorProposalCaptureDirectory,
    options.localClaudeCategoryCaptureParent,
    withheld,
    createRunCoverageJudgementPlanner({ root }),
  ];
}
