import {
  JobRequirementUserError,
  localJobRequirements,
  type WorkspaceDescriptor,
} from "@draft-loop/application";
import type {
  OpportunityBriefSelection,
  PendingWritingPolicyOverride,
  WorkspaceReadiness,
  WritingPolicyVersionMetadata,
} from "@draft-loop/ui/model";

/** What a host found out about a workspace before a run; each host reads it from its own store. */
export interface WorkspaceReadinessFacts {
  readonly descriptor: Pick<WorkspaceDescriptor, "fixtureMode" | "requiredSections" | "autopilot">;
  /** The job description's text, trimmed; empty when there is none to read. */
  readonly jobDescription: string;
  readonly jobDescriptionReady: boolean;
  /** A reviewed brief stands in for a job that has no text of its own, such as a job page. */
  readonly briefSuppliesJob: boolean;
  readonly evidenceSourceCount: number;
  /** Whether the run uses selected knowledge bases rather than the legacy evidence folder. */
  readonly knowledgeSelected: boolean;
  readonly writingPolicy: WritingPolicyVersionMetadata | undefined;
  readonly writingPolicyHistory: readonly WritingPolicyVersionMetadata[];
  readonly writingPolicyStatus: WorkspaceReadiness["writingPolicyStatus"];
  readonly retrieval: {
    readonly status: WorkspaceReadiness["retrievalStatus"];
    readonly indexedEvidenceChunkCount: number;
    readonly selectedEvidenceChunkCount: number;
    readonly selectedEvidenceSourceCount: number;
  };
  readonly reviewedOpportunity: OpportunityBriefSelection | undefined;
  readonly pendingWritingPolicyOverride: PendingWritingPolicyOverride | undefined;
  /** The step to show while the job is missing, in the host's words for its kind of job. */
  readonly missingJobStep: string;
}

/**
 * Whether a workspace can start a run, and the next steps when it cannot. Both hosts decide it here
 * from their own facts, so the start checklist reads the same on the desktop and the web.
 */
export function workspaceReadinessFrom(facts: WorkspaceReadinessFacts): WorkspaceReadiness {
  const { descriptor, jobDescriptionReady, briefSuppliesJob, evidenceSourceCount } = facts;
  const { writingPolicyStatus, retrieval } = facts;
  // The run splits the job description into requirements unless a reviewed brief supplies
  // them, so surface the same guard here instead of failing when Start is clicked.
  let rawJobRequirementProblem: string | undefined;
  if (jobDescriptionReady) {
    try {
      localJobRequirements(facts.jobDescription);
    } catch (error) {
      if (!(error instanceof JobRequirementUserError)) throw error;
      rawJobRequirementProblem = error.summary;
    }
  }
  // A reviewed brief supplies the requirements, so the raw refusal only blocks without one.
  const jobRequirementProblem =
    facts.reviewedOpportunity === undefined ? rawJobRequirementProblem : undefined;
  const nextSteps: string[] = [];
  if (!jobDescriptionReady && !briefSuppliesJob) nextSteps.push(facts.missingJobStep);
  if (jobRequirementProblem !== undefined) nextSteps.push(jobRequirementProblem);
  if (evidenceSourceCount === 0) {
    nextSteps.push(
      facts.knowledgeSelected
        ? "Add at least one source to the selected knowledge base."
        : "Add at least one candidate evidence source.",
    );
  }
  if (writingPolicyStatus === "unavailable") {
    nextSteps.push("Replace the configured writing policy before starting a review.");
  }
  if (retrieval.status === "no-query") {
    nextSteps.push("Replace the job description with searchable role content.");
  }
  if (retrieval.status === "unavailable") {
    nextSteps.push("Resolve the local evidence index error before starting a review.");
  }
  return {
    fixtureMode: descriptor.fixtureMode,
    jobDescriptionReady: jobDescriptionReady || briefSuppliesJob,
    evidenceSourceCount,
    writingPolicyStatus,
    writingPolicy: facts.writingPolicy ?? null,
    writingPolicyHistory: [...facts.writingPolicyHistory],
    pendingWritingPolicyOverride: facts.pendingWritingPolicyOverride ?? null,
    reviewedOpportunity: facts.reviewedOpportunity ?? null,
    jobRequirementProblem: rawJobRequirementProblem ?? null,
    retrievalStatus: retrieval.status,
    indexedEvidenceChunkCount: retrieval.indexedEvidenceChunkCount,
    selectedEvidenceChunkCount: retrieval.selectedEvidenceChunkCount,
    selectedEvidenceSourceCount: retrieval.selectedEvidenceSourceCount,
    requiredSections: [...descriptor.requiredSections],
    autopilot: descriptor.autopilot === true,
    ready:
      (jobDescriptionReady || briefSuppliesJob) &&
      jobRequirementProblem === undefined &&
      evidenceSourceCount > 0 &&
      writingPolicyStatus !== "unavailable" &&
      retrieval.status !== "no-query" &&
      retrieval.status !== "unavailable",
    nextSteps,
  };
}
