import type { CoverageJudgementPlanner } from "@draft-loop/orchestrator";
import type { AuditTrailStoragePort, RetrievalPort } from "@draft-loop/storage";
import type { CandidateKnowledgeSensitivityExclusions } from "./candidate-knowledge-sensitivity-exclusion.js";
import { type RunRecorders, runRecorders } from "./run-application-plan.js";
import { type RunAuthorInputTotalsSource, runAuthorInputRecorder } from "./run-author-input.js";
import { createRunCoverageJudgementPlanner } from "./run-coverage-judgement.js";
import type { RunOptions } from "./run-model-profiles.js";
import {
  type RequirementEvidenceGradeHook,
  runRequirementEvidenceGradeHook,
} from "./run-requirement-evidence-grade.js";
import { criticEvidenceFromMap, preferredEvidenceFromMap } from "./run-requirement-evidence-map.js";

/** The trailing, run-scoped arguments of the engine factory, in its parameter order. */
export type RunEngineTail = readonly [
  userSessionRunners: RunOptions["userSessionRunners"],
  userSessionTimeoutMs: RunOptions["userSessionTimeoutMs"],
  retrieval: RetrievalPort | undefined,
  authorProposalCaptureDirectory: string | undefined,
  localClaudeCategoryCaptureParent: string | undefined,
  withheld: CandidateKnowledgeSensitivityExclusions | undefined,
  coverageJudgement: CoverageJudgementPlanner,
  recorders: RunRecorders,
];

/** Gathers the run-scoped engine arguments that start, begin, and resume pass identically. */
export function runEngineTail(
  options: RunOptions,
  retrieval:
    | (RunAuthorInputTotalsSource &
        Parameters<typeof runRequirementEvidenceGradeHook>[0] & { readonly port: RetrievalPort })
    | undefined,
  withheld: CandidateKnowledgeSensitivityExclusions | undefined,
  root: string,
  storage: Pick<AuditTrailStoragePort, "appendAuditEvent">,
  workspaceId: string,
): RunEngineTail {
  return [
    options.userSessionRunners,
    options.userSessionTimeoutMs,
    retrieval?.port,
    options.authorProposalCaptureDirectory,
    options.localClaudeCategoryCaptureParent,
    withheld,
    createRunCoverageJudgementPlanner({ root }),
    withEvidenceGrade(
      runRecorders(
        storage,
        workspaceId,
        runAuthorInputRecorder(storage, workspaceId, retrieval),
        options.applicationPlan,
        options.tracer,
      ),
      runRequirementEvidenceGradeHook(retrieval, storage, workspaceId),
      preferredEvidenceFromMap(retrieval?.requirementEvidenceMap),
      criticEvidenceFromMap(retrieval?.requirementEvidenceMap),
      options.criticFallback,
    ),
  ];
}

function withEvidenceGrade(
  recorders: RunRecorders,
  evidenceGrade: RequirementEvidenceGradeHook | undefined,
  preferredEvidence: RunRecorders["preferredEvidence"],
  criticMapEvidence: RunRecorders["criticMapEvidence"],
  criticFallback: RunRecorders["criticFallback"],
): RunRecorders {
  return {
    ...recorders,
    ...(criticFallback === undefined ? {} : { criticFallback }),
    ...(evidenceGrade === undefined ? {} : { evidenceGrade }),
    ...(preferredEvidence === undefined ? {} : { preferredEvidence }),
    ...(criticMapEvidence === undefined ? {} : { criticMapEvidence }),
  };
}
