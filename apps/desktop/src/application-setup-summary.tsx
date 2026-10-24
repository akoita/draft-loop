import type { ApplicationModelProfilesView } from "@draft-loop/ui/application-contract";
import type { CandidateProfileSelection } from "@draft-loop/ui/model";
import { useEffect, useRef, useState } from "react";
import { applicationPairLabel } from "./application-model-pair.js";
import {
  type CareerEvidenceCapabilities,
  type CareerEvidenceStatus,
  loadCareerEvidenceStatus,
} from "./career-evidence.js";
import { Chip } from "./home.js";
import { evidencePresentation, type HomeTone } from "./home-model.js";
import { safeKnowledgeBaseDisplayName } from "./knowledge.js";
import type { DesktopProfileCapabilities } from "./native.js";
import {
  defaultReviewedProfile,
  loadReviewedProfileChoices,
  noReviewedProfileMessage,
  type ReviewedProfilesState,
  reviewedProfileKey,
  reviewedProfileLabel,
} from "./new-application-model.js";

export type WritingPolicySummaryStatus = "none" | "active" | "unavailable";

export interface ApplicationSetupSummaryViewProps {
  readonly evidence: CareerEvidenceStatus;
  readonly legacyEvidenceSourceCount: number;
  readonly reviewed: ReviewedProfilesState;
  readonly selectedProfile: CandidateProfileSelection | null;
  /** The application's own model pair, when it has one rather than the workspace's. */
  readonly applicationPair?: ApplicationModelProfilesView | null;
  readonly writingPolicyStatus: WritingPolicySummaryStatus;
  readonly disabled: boolean;
  readonly onSelectProfile: (selection: CandidateProfileSelection) => void;
  readonly onManageEvidence: () => void;
  readonly onManageProfile: () => void;
  readonly onOpenSettings: () => void;
}

function profileState(
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

export interface ApplicationProfileChoiceProps {
  readonly reviewed: ReviewedProfilesState;
  readonly selectedProfile: CandidateProfileSelection | null;
  readonly disabled: boolean;
  readonly onSelectProfile: (selection: CandidateProfileSelection) => void;
  readonly onManageProfile: () => void;
}

/**
 * The reviewed career profile this review writes from: the latest one, chosen automatically,
 * with a picker when there are several and a link to the Career profile page to update it.
 */
export function ApplicationProfileChoice({
  reviewed,
  selectedProfile,
  disabled,
  onSelectProfile,
  onManageProfile,
}: ApplicationProfileChoiceProps) {
  const state = profileState(reviewed, selectedProfile);
  const choices = reviewed.status === "ready" ? reviewed.choices : [];
  return (
    <section className="application-profile" aria-labelledby="application-profile-title">
      <div className="application-profile-head">
        <strong id="application-profile-title">Reviewed career profile</strong>
        <Chip tone={state.tone}>{state.chip}</Chip>
      </div>
      <p className="application-profile-text">{state.text}</p>
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
      <div>
        <button
          className="button button-outline"
          type="button"
          disabled={disabled || reviewed.status === "unsupported"}
          onClick={onManageProfile}
        >
          Update in Career profile
        </button>
      </div>
    </section>
  );
}

export interface WorkspaceSettingsLinksProps {
  readonly evidence: CareerEvidenceStatus;
  readonly legacyEvidenceSourceCount: number;
  readonly applicationPair?: ApplicationModelProfilesView | null;
  readonly writingPolicyStatus: WritingPolicySummaryStatus;
  readonly disabled: boolean;
  readonly onManageEvidence: () => void;
  readonly onOpenSettings: () => void;
}

/** The workspace-level inputs, each as one line that opens the page where it is changed. */
export function WorkspaceSettingsLinks({
  evidence,
  legacyEvidenceSourceCount,
  applicationPair = null,
  writingPolicyStatus,
  disabled,
  onManageEvidence,
  onOpenSettings,
}: WorkspaceSettingsLinksProps) {
  const evidenceView = evidencePresentation(evidence, legacyEvidenceSourceCount);
  return (
    <ul className="application-workspace-links">
      <li>
        <span>Career evidence: {evidenceView.headline}</span>
        <span aria-hidden="true"> · </span>
        <button
          className="link-action"
          type="button"
          disabled={disabled}
          onClick={onManageEvidence}
        >
          Manage
        </button>
      </li>
      <li>
        <span>Models, writing policy and sign-in are set on Home</span>
        <span aria-hidden="true"> · </span>
        <button className="link-action" type="button" disabled={disabled} onClick={onOpenSettings}>
          Open Home
        </button>
      </li>
      {applicationPair === null ? null : (
        <li className="application-workspace-note">
          This application uses {applicationPairLabel(applicationPair)}. Other applications use the
          workspace&apos;s pair.
        </li>
      )}
      {writingPolicyStatus === "unavailable" ? (
        <li className="application-workspace-attention">
          Writing policy needs attention: it cannot be read.
        </li>
      ) : null}
    </ul>
  );
}

/**
 * The profile step of an application: the reviewed profile it writes from, then one line per
 * workspace-level input with the link that opens its own page.
 */
export function ApplicationSetupSummaryView({
  evidence,
  legacyEvidenceSourceCount,
  reviewed,
  selectedProfile,
  applicationPair = null,
  writingPolicyStatus,
  disabled,
  onSelectProfile,
  onManageEvidence,
  onManageProfile,
  onOpenSettings,
}: ApplicationSetupSummaryViewProps) {
  return (
    <div className="application-summary">
      <ApplicationProfileChoice
        reviewed={reviewed}
        selectedProfile={selectedProfile}
        disabled={disabled}
        onSelectProfile={onSelectProfile}
        onManageProfile={onManageProfile}
      />
      <WorkspaceSettingsLinks
        evidence={evidence}
        legacyEvidenceSourceCount={legacyEvidenceSourceCount}
        applicationPair={applicationPair}
        writingPolicyStatus={writingPolicyStatus}
        disabled={disabled}
        onManageEvidence={onManageEvidence}
        onOpenSettings={onOpenSettings}
      />
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
