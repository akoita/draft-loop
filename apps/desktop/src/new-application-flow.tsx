import { type ReactNode, useEffect, useRef, useState } from "react";

import type { ApplicationSummaryView } from "./application-contract.js";
import type { OpportunityLatestResult } from "./bridge.js";
import { WorkspaceLocation } from "./home.js";
import {
  briefOperationsOf,
  JobRequirementsExtraction,
  type JobRequirementsExtractionBinding,
} from "./job-requirements-extraction.js";
import type { CandidateProfileSelection, ProviderTransmissionPreflight } from "./model.js";
import type { DesktopProfileCapabilities } from "./native.js";
import {
  defaultReviewedProfile,
  emptyNewApplicationDraft,
  loadReviewedProfileChoices,
  type NewApplicationDraft,
  type NewApplicationJobKind,
  type NewApplicationStepId,
  newApplicationJobInput,
  newApplicationProblem,
  newApplicationStartBlocker,
  newApplicationSteps,
  noReviewedProfileMessage,
  type ReviewedProfileChoice,
  type ReviewedProfilesState,
  requirementsReviewed,
  requirementsStatusText,
  reviewedProfileKey,
  reviewedProfileLabel,
  stepPosition,
  stepProgressText,
} from "./new-application-flow-model.js";
import { OpportunityBriefReviewAction } from "./opportunity-brief-review.js";
import {
  LatestRequirementsBriefView,
  useLatestOpportunity,
  withLatestBriefRefresh,
} from "./start-requirements.js";

// -- Presentation ----------------------------------------------------------------------------

function StepList({
  step,
  created,
}: {
  readonly step: NewApplicationStepId;
  readonly created: boolean;
}) {
  const current = stepPosition(step);
  return (
    <ol className="flow-steps" aria-label="New application steps">
      {newApplicationSteps.map((candidate, index) => {
        const position = index + 1;
        const state = position < current ? "done" : position === current ? "current" : "todo";
        return (
          <li
            key={candidate.id}
            className={`flow-step flow-step-${state}`}
            {...(state === "current" ? { "aria-current": "step" as const } : {})}
          >
            <span className="flow-step-number" aria-hidden="true">
              {state === "done" || (candidate.id === "job" && created && state !== "current")
                ? "✓"
                : position}
            </span>
            <span className="flow-step-label">{candidate.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export interface JobStepProps {
  readonly draft: NewApplicationDraft;
  readonly busy: boolean;
  readonly errorMessage: string | null;
  /** Set once the application exists: the job is then fixed and shown as a summary. */
  readonly application: ApplicationSummaryView | null;
  readonly onDraftChange: (draft: NewApplicationDraft) => void;
  readonly onSubmit: () => void;
  readonly onContinue: () => void;
}

export function JobStep({
  draft,
  busy,
  errorMessage,
  application,
  onDraftChange,
  onSubmit,
  onContinue,
}: JobStepProps) {
  if (application !== null) {
    return (
      <section className="panel flow-panel" aria-labelledby="flow-job-title">
        <h2 id="flow-job-title">Job</h2>
        <p className="flow-summary">
          <strong>{application.name}</strong> was created from{" "}
          {application.jobSourceKind === "approved-url"
            ? "an approved job page"
            : "pasted job text"}
          .
        </p>
        <div className="flow-actions">
          <button className="button button-primary" type="button" onClick={onContinue}>
            Continue
          </button>
        </div>
      </section>
    );
  }
  const problem = newApplicationProblem(draft);
  const kindButton = (kind: NewApplicationJobKind, label: string) => (
    <button
      className="view-toggle-option"
      type="button"
      aria-pressed={draft.jobKind === kind}
      disabled={busy}
      onClick={() => onDraftChange({ ...draft, jobKind: kind })}
    >
      {label}
    </button>
  );
  return (
    <form
      className="panel flow-panel"
      aria-labelledby="flow-job-title"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && problem === null) onSubmit();
      }}
    >
      <h2 id="flow-job-title">Name and job</h2>
      <p className="subtle">
        Name the role and give its job posting. DraftLoop reuses your career profile and evidence,
        and keeps this application&apos;s drafts and exports together.
      </p>
      <label className="new-application-field">
        <span>Name</span>
        <input
          type="text"
          value={draft.name}
          maxLength={120}
          disabled={busy}
          placeholder="Company and role"
          onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
        />
      </label>
      <fieldset className="model-editor-mode">
        <legend>Job posting</legend>
        <div className="view-toggle">
          {kindButton("text", "Paste text")}
          {kindButton("url", "Job page address")}
        </div>
      </fieldset>
      {draft.jobKind === "text" ? (
        <label className="new-application-field">
          <span>Job description</span>
          <textarea
            value={draft.jobText}
            rows={9}
            disabled={busy}
            placeholder="Paste the job description"
            onChange={(event) => onDraftChange({ ...draft, jobText: event.target.value })}
          />
        </label>
      ) : (
        <>
          <label className="new-application-field">
            <span>Job page address</span>
            <input
              type="url"
              value={draft.jobUrl}
              disabled={busy}
              placeholder="https://"
              onChange={(event) => onDraftChange({ ...draft, jobUrl: event.target.value })}
            />
          </label>
          <label className="flow-approval">
            <input
              type="checkbox"
              checked={draft.urlApproved}
              disabled={busy}
              onChange={(event) => onDraftChange({ ...draft, urlApproved: event.target.checked })}
            />
            <span>
              I approve DraftLoop fetching this page. It is read only when you extract requirements
              in the next step, never before.
            </span>
          </label>
        </>
      )}
      {errorMessage === null ? null : (
        <p className="setup-blocker" role="alert">
          {errorMessage}
        </p>
      )}
      <div className="flow-actions">
        <button
          className="button button-primary"
          type="submit"
          disabled={busy || problem !== null}
          {...(problem === null ? {} : { "aria-describedby": "flow-job-problem" })}
        >
          {busy ? "Creating…" : "Create application"}
        </button>
      </div>
      {problem === null ? null : (
        <p className="subtle" id="flow-job-problem">
          {problem}
        </p>
      )}
    </form>
  );
}

export interface RequirementsStepProps {
  readonly latest: OpportunityLatestResult | undefined;
  /** The extraction card and the brief review, supplied by the container. */
  readonly children: ReactNode;
  readonly onBack: () => void;
  readonly onContinue: () => void;
}

export function RequirementsStep({ latest, children, onBack, onContinue }: RequirementsStepProps) {
  const ready = requirementsReviewed(latest);
  return (
    <section className="panel flow-panel" aria-labelledby="flow-requirements-title">
      <h2 id="flow-requirements-title">Extract and review requirements</h2>
      <p className="subtle">
        DraftLoop drafts a list of requirements from the job with your writing model, after you
        consent. Review and correct it; the review then starts from your reviewed version.
      </p>
      <p className="flow-status" role="status">
        {requirementsStatusText(latest)}
      </p>
      {children}
      <div className="flow-actions">
        <button className="button button-quiet" type="button" onClick={onBack}>
          Back
        </button>
        <button
          className="button button-primary"
          type="button"
          disabled={!ready}
          onClick={onContinue}
        >
          Continue
        </button>
      </div>
    </section>
  );
}

export interface ProfileStepProps {
  readonly reviewed: ReviewedProfilesState;
  readonly selected: CandidateProfileSelection | null;
  readonly onSelect: (choice: ReviewedProfileChoice) => void;
  readonly onManageProfile: () => void;
  readonly onBack: () => void;
  readonly onContinue: () => void;
}

export function ProfileStep({
  reviewed,
  selected,
  onSelect,
  onManageProfile,
  onBack,
  onContinue,
}: ProfileStepProps) {
  const choices = reviewed.status === "ready" ? reviewed.choices : [];
  const newest = defaultReviewedProfile(choices);
  return (
    <section className="panel flow-panel" aria-labelledby="flow-profile-title">
      <h2 id="flow-profile-title">Career profile</h2>
      <p className="subtle">
        Every application reuses your reviewed career profile. Nothing is generated again here.
      </p>
      {reviewed.status === "loading" ? (
        <p className="flow-status" role="status">
          Reading your reviewed career profiles…
        </p>
      ) : reviewed.status === "unsupported" ? (
        <p className="flow-status" role="status">
          This version of DraftLoop cannot manage a career profile.
        </p>
      ) : reviewed.status === "failed" ? (
        <p className="setup-blocker" role="alert">
          The reviewed career profiles could not be read. Open Manage profile to try again.
        </p>
      ) : choices.length === 0 ? (
        <div className="flow-status" role="status">
          <p>{noReviewedProfileMessage}</p>
          <button className="button button-outline" type="button" onClick={onManageProfile}>
            Manage profile
          </button>
        </div>
      ) : (
        <fieldset className="flow-choices">
          <legend>Reviewed career profile</legend>
          {choices.map((choice) => {
            const key = reviewedProfileKey(choice);
            return (
              <label key={key} className="flow-choice">
                <input
                  type="radio"
                  name="reviewed-profile"
                  checked={selected !== null && reviewedProfileKey(selected) === key}
                  onChange={() => onSelect(choice)}
                />
                <span>
                  {reviewedProfileLabel(choice)}
                  {newest !== undefined && reviewedProfileKey(newest) === key ? (
                    <span className="home-chip home-chip-ready flow-latest"> Latest</span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </fieldset>
      )}
      <div className="flow-actions">
        <button className="button button-quiet" type="button" onClick={onBack}>
          Back
        </button>
        <button
          className="button button-primary"
          type="button"
          disabled={selected === null}
          onClick={onContinue}
        >
          Continue
        </button>
      </div>
    </section>
  );
}

export interface StartStepProps {
  readonly application: ApplicationSummaryView;
  readonly latest: OpportunityLatestResult | undefined;
  readonly profile: CandidateProfileSelection | null;
  readonly modelPair: ReactNode;
  readonly preflight: ProviderTransmissionPreflight;
  readonly transmissionConfirmed: boolean;
  readonly starting: boolean;
  readonly errorMessage: string | null;
  readonly startDisabledReason: string | null;
  readonly onTransmissionConfirmedChange: (confirmed: boolean) => void;
  readonly onBack: () => void;
  readonly onStart: () => void;
}

export function StartStep({
  application,
  latest,
  profile,
  modelPair,
  preflight,
  transmissionConfirmed,
  starting,
  errorMessage,
  startDisabledReason,
  onTransmissionConfirmedChange,
  onBack,
  onStart,
}: StartStepProps) {
  const transmissionRequired = preflight.required && !preflight.acknowledged;
  const blocker =
    startDisabledReason ??
    newApplicationStartBlocker({
      requirementsReady: requirementsReviewed(latest),
      profile,
      transmissionRequired,
      transmissionConfirmed,
    });
  return (
    <section className="panel flow-panel" aria-labelledby="flow-start-title">
      <h2 id="flow-start-title">Start the review</h2>
      <p className="subtle">
        The author drafts your CV and the critic reviews it. This run is pinned to the exact
        versions below, so the result stays reproducible.
      </p>
      <dl className="flow-facts">
        <div>
          <dt>Application</dt>
          <dd>{application.name}</dd>
        </div>
        <div>
          <dt>Requirements</dt>
          <dd>
            {latest === null || latest === undefined
              ? "Not available"
              : `Brief ${latest.briefId}, version ${latest.version} (${latest.status})`}
          </dd>
        </div>
        <div>
          <dt>Career profile</dt>
          <dd>
            {profile === null
              ? "None selected"
              : `${profile.profileId}, version ${profile.version}`}
          </dd>
        </div>
      </dl>
      {modelPair}
      {transmissionRequired ? (
        <label className="flow-approval">
          <input
            type="checkbox"
            checked={transmissionConfirmed}
            disabled={starting}
            onChange={(event) => onTransmissionConfirmedChange(event.target.checked)}
          />
          <span>
            I reviewed that this review sends my CV evidence to the author and critic models above (
            {preflight.author.company} and {preflight.critic.company}).
          </span>
        </label>
      ) : null}
      {errorMessage === null ? null : (
        <p className="setup-blocker" role="alert">
          {errorMessage}
        </p>
      )}
      <div className="flow-actions">
        <button className="button button-quiet" type="button" disabled={starting} onClick={onBack}>
          Back
        </button>
        <button
          className="button button-primary"
          type="button"
          disabled={starting || blocker !== null}
          {...(blocker === null ? {} : { "aria-describedby": "flow-start-blocker" })}
          onClick={onStart}
        >
          {starting ? "Starting…" : "Start review"}
        </button>
      </div>
      {blocker === null ? null : (
        <p className="subtle" id="flow-start-blocker">
          {blocker}
        </p>
      )}
    </section>
  );
}

// -- Screen ---------------------------------------------------------------------------------

export interface NewApplicationFlowProps {
  readonly workspaceId: string;
  readonly workspaceTitle: ReactNode;
  readonly workspaceNavigation: ReactNode;
  readonly errorMessage: string | null;
  readonly createApplication: (
    name: string,
    job: string | { readonly url: string },
  ) => Promise<ApplicationSummaryView>;
  /** Called once the application exists, so the window scopes later calls to it. */
  readonly onCreated: (application: ApplicationSummaryView) => void;
  /** The extraction binding; the port already scopes it to the created application. */
  readonly requirements: JobRequirementsExtractionBinding;
  readonly profileCapabilities: DesktopProfileCapabilities;
  readonly selectedProfile: CandidateProfileSelection | null;
  readonly onSelectProfile: (selection: CandidateProfileSelection | null) => void;
  readonly onManageProfile: () => void;
  readonly modelPair: ReactNode;
  readonly preflight: ProviderTransmissionPreflight;
  /** Why a review cannot start for a reason outside the flow, such as an unsupported model. */
  readonly startDisabledReason: string | null;
  /** Starts the review for the application; rejects with the message to show. */
  readonly onStart: (
    application: ApplicationSummaryView,
    acknowledgeFingerprint: string | null,
  ) => Promise<void>;
  readonly onHome: () => void;
}

function failureText(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message.trim() !== "" ? reason.message : fallback;
}

/** The guided flow: job, reviewed requirements, reviewed career profile, then the review. */
export function NewApplicationFlow({
  workspaceId,
  workspaceTitle,
  workspaceNavigation,
  errorMessage,
  createApplication,
  onCreated,
  requirements,
  profileCapabilities,
  selectedProfile,
  onSelectProfile,
  onManageProfile,
  modelPair,
  preflight,
  startDisabledReason,
  onStart,
  onHome,
}: NewApplicationFlowProps) {
  const [step, setStep] = useState<NewApplicationStepId>("job");
  const [draft, setDraft] = useState<NewApplicationDraft>(emptyNewApplicationDraft);
  const [application, setApplication] = useState<ApplicationSummaryView | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState<ReviewedProfilesState>({ status: "loading" });
  const [transmissionConfirmed, setTransmissionConfirmed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Briefs are read only after the application exists: until then the port is not scoped to it.
  const { latest, refresh } = useLatestOpportunity(
    application === null ? undefined : requirements.getLatestOpportunity,
    `${workspaceId}:${application?.id ?? ""}`,
    application?.id ?? "",
  );

  const profileRef = useRef(profileCapabilities);
  profileRef.current = profileCapabilities;
  const selectedRef = useRef(selectedProfile);
  selectedRef.current = selectedProfile;
  const onSelectRef = useRef(onSelectProfile);
  onSelectRef.current = onSelectProfile;
  useEffect(() => {
    let active = true;
    setReviewed({ status: "loading" });
    void loadReviewedProfileChoices(profileRef.current, workspaceId).then((loaded) => {
      if (!active) return;
      setReviewed(loaded);
      if (loaded.status !== "ready") return;
      // The latest reviewed profile is selected for the person; a still-valid choice is kept.
      const current = selectedRef.current;
      const stillReviewed =
        current !== null &&
        loaded.choices.some((choice) => reviewedProfileKey(choice) === reviewedProfileKey(current));
      if (stillReviewed) return;
      const newest = defaultReviewedProfile(loaded.choices);
      onSelectRef.current(
        newest === undefined ? null : { profileId: newest.profileId, version: newest.version },
      );
    });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  const create = async () => {
    if (creating || newApplicationProblem(draft) !== null) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createApplication(draft.name.trim(), newApplicationJobInput(draft));
      if (!mounted.current) return;
      setApplication(created);
      onCreated(created);
      setStep("requirements");
    } catch (reason: unknown) {
      if (mounted.current)
        setCreateError(failureText(reason, "The application could not be created."));
    } finally {
      if (mounted.current) setCreating(false);
    }
  };

  const start = async () => {
    if (application === null || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      const needsAcknowledgement = preflight.required && !preflight.acknowledged;
      await onStart(application, needsAcknowledgement ? preflight.fingerprint : null);
    } catch (reason: unknown) {
      if (mounted.current) setStartError(failureText(reason, "The review could not be started."));
    } finally {
      if (mounted.current) setStarting(false);
    }
  };

  const binding = withLatestBriefRefresh(
    {
      ...requirements,
      ...(application?.jobSourceKind === "approved-url" ? { jobFromUrl: true } : {}),
    },
    refresh,
  );
  const briefOperations = briefOperationsOf(binding);

  const requirementsPanel =
    application === null ? null : (
      <>
        {latest === undefined || latest === null || briefOperations === undefined ? null : (
          <LatestRequirementsBriefView
            latest={latest}
            action={
              <OpportunityBriefReviewAction
                briefId={latest.briefId}
                operations={briefOperations}
                disabled={requirements.disabled}
                label={latest.status === "reviewed" ? "View requirements" : "Review requirements"}
                onBriefChanged={() => binding.onBriefChanged?.()}
              />
            }
          />
        )}
        <JobRequirementsExtraction binding={binding} />
      </>
    );

  return (
    <div className="app-frame">
      <main className="app-shell app-shell-single">
        <div className="main-column">
          <header className="home-header">
            <div className="home-header-identity">
              <WorkspaceLocation current="New application" onHome={onHome} asHeading />
              {workspaceTitle}
            </div>
            <div className="home-header-actions">{workspaceNavigation}</div>
          </header>
          {errorMessage === null ? null : (
            <div className="error-banner" role="alert">
              <p>{errorMessage}</p>
            </div>
          )}
          <p className="subtle flow-progress">{stepProgressText(step)}</p>
          <StepList step={step} created={application !== null} />
          {step === "job" || application === null ? (
            <JobStep
              draft={draft}
              busy={creating}
              errorMessage={createError}
              application={application}
              onDraftChange={setDraft}
              onSubmit={() => void create()}
              onContinue={() => setStep("requirements")}
            />
          ) : step === "requirements" ? (
            <RequirementsStep
              latest={latest}
              onBack={() => setStep("job")}
              onContinue={() => setStep("profile")}
            >
              {requirementsPanel}
            </RequirementsStep>
          ) : step === "profile" ? (
            <ProfileStep
              reviewed={reviewed}
              selected={selectedProfile}
              onSelect={(choice) =>
                onSelectProfile({ profileId: choice.profileId, version: choice.version })
              }
              onManageProfile={onManageProfile}
              onBack={() => setStep("requirements")}
              onContinue={() => setStep("start")}
            />
          ) : (
            <StartStep
              application={application}
              latest={latest}
              profile={selectedProfile}
              modelPair={modelPair}
              preflight={preflight}
              transmissionConfirmed={transmissionConfirmed}
              starting={starting}
              errorMessage={startError}
              startDisabledReason={startDisabledReason}
              onTransmissionConfirmedChange={setTransmissionConfirmed}
              onBack={() => setStep("profile")}
              onStart={() => void start()}
            />
          )}
        </div>
      </main>
    </div>
  );
}
