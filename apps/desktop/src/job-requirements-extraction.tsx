import { type ReactNode, useEffect, useRef, useState } from "react";

import type {
  OpportunityCreateInput,
  OpportunityEditInput,
  OpportunityIssueResult,
  OpportunityLatestResult,
  OpportunityRecordResult,
} from "./bridge.js";
import { modelDisplayName, providerDisplayName } from "./model-profile-presentation.js";
import { OpportunityBriefReviewAction } from "./opportunity-brief-review.js";
import type { BriefOperations } from "./opportunity-brief-review-model.js";

/** The host connection that lets setup card 01 extract requirements from the workspace's job text. */
export interface JobRequirementsExtractionBinding {
  readonly workspaceId: string;
  /** Absent when the host cannot create opportunity briefs; the action is then hidden. */
  readonly createOpportunity?: (
    input: Omit<OpportunityCreateInput, "workspaceId">,
  ) => Promise<OpportunityRecordResult>;
  /** Read, edit and review the brief; absent when the host cannot, which hides the review dialog. */
  readonly getOpportunity?: (briefId: string, version?: number) => Promise<OpportunityRecordResult>;
  readonly editOpportunity?: (
    input: Omit<OpportunityEditInput, "workspaceId">,
  ) => Promise<OpportunityRecordResult>;
  readonly reviewOpportunity?: (
    briefId: string,
    expectedVersion: number,
  ) => Promise<OpportunityRecordResult>;
  /** The workspace's latest brief (draft or reviewed); absent when the host cannot report it. */
  readonly getLatestOpportunity?: () => Promise<OpportunityLatestResult>;
  /** Called after the brief was saved or reviewed, so the workspace can reload its setup state. */
  readonly onBriefChanged?: () => void;
  /** The configured writing model: the one that would receive the job description. */
  readonly writingModel: { readonly company: string; readonly model: string };
  readonly disabled: boolean;
}

/** The brief operations the review dialog needs, or `undefined` when the host lacks any. */
export function briefOperationsOf(
  binding: Pick<
    JobRequirementsExtractionBinding,
    "getOpportunity" | "editOpportunity" | "reviewOpportunity"
  >,
): BriefOperations | undefined {
  const { getOpportunity, editOpportunity, reviewOpportunity } = binding;
  if (getOpportunity === undefined || editOpportunity === undefined) return undefined;
  if (reviewOpportunity === undefined) return undefined;
  return { getOpportunity, editOpportunity, reviewOpportunity };
}

const jobDescriptionSourceId = "workspace-job-description";
const failureFallback = "Requirements could not be extracted. Nothing was saved.";

export interface JobRequirementsSummary {
  readonly briefId: string;
  readonly version: number;
  readonly status: OpportunityRecordResult["status"];
  readonly requirementCount: number;
  readonly responsibilityCount: number;
  readonly issues: readonly OpportunityIssueResult[];
}

/** Content-free counts of an extracted brief; the requirement text itself stays out of this card. */
export function summarizeJobRequirements(record: OpportunityRecordResult): JobRequirementsSummary {
  return {
    briefId: record.briefId,
    version: record.version,
    status: record.status,
    requirementCount: record.requirements.length,
    responsibilityCount: record.responsibilities.length,
    issues: record.issues.filter((issue) => issue.status === "open"),
  };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function issueLabel(issue: OpportunityIssueResult): string {
  return issue.severity === "error" ? "Problem" : "Warning";
}

/**
 * Sends the one approved request: the workspace job description, with provider transmission
 * approved because the person just confirmed it. The host resolves the document; no path is sent.
 */
export async function runJobRequirementsExtraction(
  createOpportunity: NonNullable<JobRequirementsExtractionBinding["createOpportunity"]>,
): Promise<JobRequirementsPhase> {
  try {
    const record = await createOpportunity({
      sources: [
        {
          id: jobDescriptionSourceId,
          kind: "workspace-job-description",
          classification: "job-posting",
        },
      ],
      providerTransmissionApproved: true,
    });
    return { kind: "done", summary: summarizeJobRequirements(record) };
  } catch (reason: unknown) {
    const message =
      reason instanceof Error && reason.message.trim() !== "" ? reason.message : failureFallback;
    return { kind: "failed", message };
  }
}

export type JobRequirementsPhase =
  | { readonly kind: "idle" }
  | { readonly kind: "consent" }
  | { readonly kind: "running" }
  | { readonly kind: "done"; readonly summary: JobRequirementsSummary }
  | { readonly kind: "failed"; readonly message: string };

export interface JobRequirementsExtractionViewProps {
  readonly phase: JobRequirementsPhase;
  readonly writingModel: JobRequirementsExtractionBinding["writingModel"];
  readonly disabled: boolean;
  /** The "Review requirements" action shown once a draft brief was saved. */
  readonly reviewAction?: ReactNode;
  readonly onOpen: () => void;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function JobRequirementsExtractionView({
  phase,
  writingModel,
  disabled,
  reviewAction = null,
  onOpen,
  onConfirm,
  onCancel,
}: JobRequirementsExtractionViewProps) {
  const providerName = providerDisplayName(writingModel.company);
  const modelName = modelDisplayName(writingModel.model);
  switch (phase.kind) {
    case "idle":
      return (
        <div className="job-extraction">
          <p className="setup-note">
            Long or pasted job pages can be split into reviewable requirements with your writing
            model.
          </p>
          <button
            className="button button-outline"
            type="button"
            disabled={disabled}
            onClick={onOpen}
          >
            Extract requirements
          </button>
        </div>
      );
    case "consent":
      return (
        <section className="job-extraction" aria-label="Extract requirements consent">
          <p className="job-extraction-title">Send the job description to the writing model?</p>
          <p className="setup-note">
            Extract sends this workspace&apos;s job description to {providerName} ({modelName}) to
            draft an opportunity brief.
          </p>
          <code className="job-extraction-model">
            {writingModel.company}/{writingModel.model}
          </code>
          <p className="setup-note">
            Only the job description is sent. Your career evidence is not sent. Nothing is sent
            until you choose Extract.
          </p>
          <div className="job-extraction-actions">
            <button
              className="button button-primary"
              type="button"
              disabled={disabled}
              onClick={onConfirm}
            >
              Extract
            </button>
            <button className="button button-quiet" type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </section>
      );
    case "running":
      return (
        <div className="job-extraction" role="status">
          <div className="profile-generation-progress-row">
            <span className="profile-generation-spinner" aria-hidden="true" />
            <strong>Extracting requirements…</strong>
          </div>
          <p className="setup-note">
            Waiting for {providerName} ({modelName}). Extraction cannot be cancelled once it has
            started; keep DraftLoop open.
          </p>
        </div>
      );
    case "done":
      return (
        <div className="job-extraction" role="status">
          <p className="job-extraction-title">Draft brief saved</p>
          <dl className="job-extraction-facts">
            <div>
              <dt>Brief</dt>
              <dd>
                <code>{phase.summary.briefId}</code> version {phase.summary.version} (
                {phase.summary.status})
              </dd>
            </div>
            <div>
              <dt>Extracted</dt>
              <dd>
                {plural(phase.summary.requirementCount, "requirement")},{" "}
                {phase.summary.responsibilityCount === 1
                  ? "1 responsibility"
                  : `${phase.summary.responsibilityCount} responsibilities`}
              </dd>
            </div>
          </dl>
          {phase.summary.issues.length === 0 ? null : (
            <ul className="job-extraction-issues">
              {phase.summary.issues.map((issue) => (
                <li key={issue.id}>
                  <strong>{issueLabel(issue)}:</strong> {issue.message}
                </li>
              ))}
            </ul>
          )}
          <p className="setup-note">
            This is a draft: it has not been reviewed and cannot start a run yet.
          </p>
          {reviewAction}
        </div>
      );
    case "failed":
      return (
        <div className="job-extraction" role="alert">
          <p className="job-extraction-title">Requirements were not extracted</p>
          <p className="setup-note">{phase.message}</p>
          <button
            className="button button-outline"
            type="button"
            disabled={disabled}
            onClick={onOpen}
          >
            Try again
          </button>
        </div>
      );
  }
}

/** Setup card 01 action: extract reviewable requirements from the workspace's job description. */
export function JobRequirementsExtraction({
  binding,
  openSignal = 0,
}: {
  readonly binding: JobRequirementsExtractionBinding;
  /** Raising this number opens the consent step, for the start blocker's guided action. */
  readonly openSignal?: number;
}) {
  const [phase, setPhase] = useState<JobRequirementsPhase>({ kind: "idle" });
  const handledSignal = useRef(openSignal);
  useEffect(() => {
    if (openSignal === handledSignal.current) return;
    handledSignal.current = openSignal;
    setPhase((current) => (current.kind === "idle" ? { kind: "consent" } : current));
  }, [openSignal]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { createOpportunity } = binding;
  if (createOpportunity === undefined) return null;
  const briefOperations = briefOperationsOf(binding);

  const confirm = () => {
    setPhase({ kind: "running" });
    void runJobRequirementsExtraction(createOpportunity).then((outcome) => {
      if (mounted.current) setPhase(outcome);
    });
  };

  return (
    <JobRequirementsExtractionView
      phase={phase}
      writingModel={binding.writingModel}
      disabled={binding.disabled}
      reviewAction={
        briefOperations === undefined || phase.kind !== "done" ? null : (
          <OpportunityBriefReviewAction
            briefId={phase.summary.briefId}
            operations={briefOperations}
            disabled={binding.disabled}
            {...(binding.onBriefChanged === undefined
              ? {}
              : { onBriefChanged: binding.onBriefChanged })}
          />
        )
      }
      onOpen={() => setPhase({ kind: "consent" })}
      onConfirm={confirm}
      onCancel={() => setPhase({ kind: "idle" })}
    />
  );
}
