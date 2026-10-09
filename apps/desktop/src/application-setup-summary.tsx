import { useEffect, useRef, useState } from "react";

import {
  type CareerEvidenceCapabilities,
  type CareerEvidenceStatus,
  loadCareerEvidenceStatus,
} from "./career-evidence.js";
import { SummaryCard } from "./home.js";
import { evidencePresentation, type HomeTone } from "./home-model.js";
import { safeKnowledgeBaseDisplayName } from "./knowledge.js";
import type { CandidateProfileSelection, ProviderTransmissionIdentity } from "./model.js";
import type { DesktopProfileCapabilities } from "./native.js";
import {
  defaultReviewedProfile,
  loadReviewedProfileChoices,
  noReviewedProfileMessage,
  type ReviewedProfilesState,
  reviewedProfileKey,
  reviewedProfileLabel,
} from "./new-application-flow-model.js";

export type WritingPolicySummaryStatus = "none" | "active" | "unavailable";

export interface ApplicationSetupSummaryViewProps {
  readonly evidence: CareerEvidenceStatus;
  readonly legacyEvidenceSourceCount: number;
  readonly reviewed: ReviewedProfilesState;
  readonly selectedProfile: CandidateProfileSelection | null;
  readonly author: ProviderTransmissionIdentity;
  readonly critic: ProviderTransmissionIdentity;
  readonly writingPolicyStatus: WritingPolicySummaryStatus;
  readonly writingPolicyVersion: string | null;
  readonly disabled: boolean;
  readonly onSelectProfile: (selection: CandidateProfileSelection) => void;
  readonly onManageEvidence: () => void;
  readonly onManageProfile: () => void;
  readonly onOpenSettings: () => void;
}

function profileCardState(
  reviewed: ReviewedProfilesState,
  selected: CandidateProfileSelection | null,
): { readonly chip: string; readonly tone: HomeTone; readonly text: string } {
  switch (reviewed.status) {
    case "loading":
      return { chip: "Checking", tone: "neutral", text: "Reading your reviewed career profiles…" };
    case "unsupported":
      return {
        chip: "Unavailable",
        tone: "neutral",
        text: "This version of DraftLoop cannot manage a career profile.",
      };
    case "failed":
      return {
        chip: "Unavailable",
        tone: "error",
        text: "The reviewed career profiles could not be read. Open Career profile to try again.",
      };
    case "ready": {
      if (reviewed.choices.length === 0) {
        return { chip: "Required", tone: "attention", text: noReviewedProfileMessage };
      }
      const choice =
        selected === null
          ? undefined
          : reviewed.choices.find(
              (candidate) => reviewedProfileKey(candidate) === reviewedProfileKey(selected),
            );
      return choice === undefined
        ? { chip: "Required", tone: "attention", text: "Choose a reviewed profile to start." }
        : { chip: "Selected", tone: "ready", text: `Using ${reviewedProfileLabel(choice)}` };
    }
  }
}

function writingPolicyText(status: WritingPolicySummaryStatus, version: string | null): string {
  if (status === "unavailable") return "Writing policy needs attention: it cannot be read.";
  if (status === "none" || version === null) return "No writing policy (optional).";
  return `Writing policy ${version} is active.`;
}

/**
 * The workspace-level inputs of an application, each as one compact card with the action that
 * opens its own screen. The application screen keeps only what starting a review needs.
 */
export function ApplicationSetupSummaryView({
  evidence,
  legacyEvidenceSourceCount,
  reviewed,
  selectedProfile,
  author,
  critic,
  writingPolicyStatus,
  writingPolicyVersion,
  disabled,
  onSelectProfile,
  onManageEvidence,
  onManageProfile,
  onOpenSettings,
}: ApplicationSetupSummaryViewProps) {
  const evidenceView = evidencePresentation(evidence, legacyEvidenceSourceCount);
  const profileState = profileCardState(reviewed, selectedProfile);
  const choices = reviewed.status === "ready" ? reviewed.choices : [];
  const settingsTone: HomeTone = writingPolicyStatus === "unavailable" ? "attention" : "ready";
  return (
    <div className="application-summary">
      <SummaryCard
        id="application-evidence-title"
        title="Career evidence"
        subtitle="What DraftLoop may quote. Shared by every application."
        presentation={evidenceView}
        headline={evidenceView.headline}
        action={
          <button
            className="button button-outline"
            type="button"
            disabled={disabled}
            onClick={onManageEvidence}
          >
            Open Career evidence
          </button>
        }
      />
      <SummaryCard
        id="application-profile-title"
        title="Career profile"
        subtitle="The reviewed record this review writes from."
        presentation={profileState}
        headline={profileState.text}
        action={
          <button
            className="button button-outline"
            type="button"
            disabled={disabled || reviewed.status === "unsupported"}
            onClick={onManageProfile}
          >
            Open Career profile
          </button>
        }
      >
        {choices.length > 1 ? (
          <label className="application-summary-select">
            <span>Reviewed version</span>
            <select
              value={selectedProfile === null ? "" : reviewedProfileKey(selectedProfile)}
              disabled={disabled}
              onChange={(event) => {
                const choice = choices.find(
                  (candidate) => reviewedProfileKey(candidate) === event.target.value,
                );
                if (choice !== undefined) {
                  onSelectProfile({ profileId: choice.profileId, version: choice.version });
                }
              }}
            >
              {selectedProfile === null ? <option value="">Choose a profile</option> : null}
              {choices.map((choice) => (
                <option key={reviewedProfileKey(choice)} value={reviewedProfileKey(choice)}>
                  {reviewedProfileLabel(choice)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </SummaryCard>
      <SummaryCard
        id="application-settings-title"
        title="Workspace settings"
        subtitle="Models, writing policy and provider sign-in. Set once on Home."
        presentation={{
          chip: writingPolicyStatus === "unavailable" ? "Check" : "Set",
          tone: settingsTone,
        }}
        headline={`Writer ${author.model} · Reviewer ${critic.model}`}
        action={
          <button
            className="button button-outline"
            type="button"
            disabled={disabled}
            onClick={onOpenSettings}
          >
            Open Home settings
          </button>
        }
      >
        <p className="home-card-copy">
          {writingPolicyText(writingPolicyStatus, writingPolicyVersion)}
        </p>
      </SummaryCard>
    </div>
  );
}

export interface ApplicationSetupSummaryProps
  extends Omit<ApplicationSetupSummaryViewProps, "evidence" | "reviewed"> {
  readonly workspaceId: string;
  readonly evidenceCapabilities: CareerEvidenceCapabilities;
  /** Bumped when the knowledge selection or contents change, so the summary reads again. */
  readonly evidenceRevision: number;
  readonly profileCapabilities: DesktopProfileCapabilities;
}

/**
 * Reads the evidence status and the reviewed profiles, and selects the latest reviewed profile
 * for the person, as New application does. A still-valid choice is kept.
 */
export function ApplicationSetupSummary({
  workspaceId,
  evidenceCapabilities,
  evidenceRevision,
  profileCapabilities,
  ...view
}: ApplicationSetupSummaryProps) {
  const [evidence, setEvidence] = useState<CareerEvidenceStatus>({ kind: "loading" });
  const [reviewed, setReviewed] = useState<ReviewedProfilesState>({ status: "loading" });
  const evidenceRef = useRef(evidenceCapabilities);
  evidenceRef.current = evidenceCapabilities;
  const profileRef = useRef(profileCapabilities);
  profileRef.current = profileCapabilities;
  const selectedRef = useRef(view.selectedProfile);
  selectedRef.current = view.selectedProfile;
  const onSelectRef = useRef(view.onSelectProfile);
  onSelectRef.current = view.onSelectProfile;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `evidenceRevision` re-reads the base after the knowledge changes; the capabilities go through a ref.
  useEffect(() => {
    let active = true;
    void loadCareerEvidenceStatus(
      evidenceRef.current,
      workspaceId,
      safeKnowledgeBaseDisplayName,
    ).then((loaded) => {
      if (active) setEvidence(loaded);
    });
    return () => {
      active = false;
    };
  }, [workspaceId, evidenceRevision]);

  useEffect(() => {
    let active = true;
    setReviewed({ status: "loading" });
    void loadReviewedProfileChoices(profileRef.current, workspaceId).then((loaded) => {
      if (!active) return;
      setReviewed(loaded);
      if (loaded.status !== "ready") return;
      const current = selectedRef.current;
      const stillReviewed =
        current !== null &&
        loaded.choices.some((choice) => reviewedProfileKey(choice) === reviewedProfileKey(current));
      if (stillReviewed) return;
      const newest = defaultReviewedProfile(loaded.choices);
      if (newest !== undefined) {
        onSelectRef.current({ profileId: newest.profileId, version: newest.version });
      }
    });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  return <ApplicationSetupSummaryView {...view} evidence={evidence} reviewed={reviewed} />;
}
