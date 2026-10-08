import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";

import type { ApplicationSummaryView } from "./application-contract.js";
import {
  type CareerEvidenceCapabilities,
  type CareerEvidenceStatus,
  loadCareerEvidenceStatus,
} from "./career-evidence.js";
import {
  CareerFlowStrip,
  careerEvidenceCardSubtitle,
  careerProfileCardSubtitle,
} from "./career-flow.js";
import {
  applicationActivityText,
  applicationRunText,
  applicationStatusLabel,
  applicationStatusTone,
  applicationsByActivity,
  evidencePresentation,
  type HomeApplicationsState,
  type HomeProfileStatus,
  type HomeStatusPresentation,
  type HomeTone,
  onlyDefaultApplication,
  profileStatusPresentation,
  readHomeProfile,
} from "./home-model.js";
import { safeKnowledgeBaseDisplayName } from "./knowledge.js";
import type { DesktopApplicationCapabilities, DesktopProfileCapabilities } from "./native.js";
import {
  loadProfileFreshness,
  type ProfileFreshnessPresentation,
  profileFreshnessPresentation,
} from "./profile-freshness.js";
import type { ProfileFreshnessResult } from "./profile-freshness-contract.js";

/** Focus lands on the location line of a screen when it opens, so assistive technology says where. */
function useFocusOnOpen(ref: RefObject<HTMLElement | null>): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the ref object is stable and focus moves once per screen.
  useEffect(() => {
    ref.current?.focus();
  }, []);
}

interface WorkspaceLocationProps {
  /** The name of the screen; shown as the current page. */
  readonly current: string;
  /** Present on every screen but Home. */
  readonly onHome?: () => void;
  /** Names the screen with the page heading, for a screen with no other title. */
  readonly asHeading?: boolean;
}

/** "← Home / Current screen": the way back to Home, and the screen's label. */
export function WorkspaceLocation({ current, onHome, asHeading = false }: WorkspaceLocationProps) {
  const ref = useRef<HTMLElement>(null);
  useFocusOnOpen(ref);
  return (
    <nav ref={ref} className="home-location" aria-label="Workspace location" tabIndex={-1}>
      {onHome === undefined ? null : (
        <button className="button button-quiet home-back" type="button" onClick={onHome}>
          <span aria-hidden="true">←</span> Home
        </button>
      )}
      {asHeading ? (
        <h1 className="home-location-current" title={current} aria-current="page">
          {current}
        </h1>
      ) : (
        <span className="home-location-current" aria-current="page">
          {current}
        </span>
      )}
    </nav>
  );
}

function Chip({ tone, children }: { readonly tone: HomeTone; readonly children: ReactNode }) {
  return <span className={`home-chip home-chip-${tone}`}>{children}</span>;
}

function SummaryCard({
  id,
  title,
  subtitle,
  presentation,
  headline,
  children,
  action,
}: {
  readonly id: string;
  readonly title: string;
  /** One line saying what the card is, consistent with the intro of the page it opens. */
  readonly subtitle: string;
  readonly presentation: Pick<HomeStatusPresentation, "chip" | "tone">;
  readonly headline?: string;
  readonly children?: ReactNode;
  readonly action: ReactNode;
}) {
  return (
    <section className="panel home-card" aria-labelledby={id}>
      <div className="home-card-head">
        <h2 id={id}>{title}</h2>
        <Chip tone={presentation.tone}>{presentation.chip}</Chip>
      </div>
      <p className="home-card-subtitle">{subtitle}</p>
      {headline === undefined ? null : <p className="home-card-headline">{headline}</p>}
      {children}
      <div className="home-card-actions">{action}</div>
    </section>
  );
}

/** One compact line saying whether the reviewed profile is current; its action opens the profile. */
export function ProfileFreshnessNote({
  presentation,
  disabled = false,
  onAction,
}: {
  readonly presentation: ProfileFreshnessPresentation;
  readonly disabled?: boolean;
  readonly onAction: () => void;
}) {
  return (
    <div className={`home-freshness home-freshness-${presentation.tone}`}>
      <p className="home-freshness-text">{presentation.text}</p>
      {presentation.action === undefined ? null : (
        <button
          className="button button-quiet home-freshness-action"
          type="button"
          disabled={disabled}
          onClick={onAction}
        >
          {presentation.action}
        </button>
      )}
    </div>
  );
}

function ApplicationCard({
  application,
  now,
  onOpen,
}: {
  readonly application: ApplicationSummaryView;
  readonly now: Date;
  readonly onOpen: (application: ApplicationSummaryView) => void;
}) {
  const metaId = `application-meta-${application.id}`;
  return (
    <li className="application-card">
      <div className="application-card-head">
        <h3>
          <button
            className="application-card-open"
            type="button"
            aria-describedby={metaId}
            onClick={() => onOpen(application)}
          >
            {application.name}
          </button>
        </h3>
        <Chip tone={applicationStatusTone(application.status)}>
          {applicationStatusLabel(application.status)}
        </Chip>
      </div>
      <p className="application-card-meta" id={metaId}>
        <span title={application.updatedAt}>
          {applicationActivityText(application.updatedAt, now)}
        </span>
        <span aria-hidden="true"> · </span>
        <span>{applicationRunText(application.runCount)}</span>
        {application.isDefault ? (
          <>
            <span aria-hidden="true"> · </span>
            <span>Original workspace job</span>
          </>
        ) : null}
      </p>
    </li>
  );
}

function ApplicationsList({
  state,
  now,
  onOpen,
}: {
  readonly state: HomeApplicationsState;
  readonly now: Date;
  readonly onOpen: (application: ApplicationSummaryView) => void;
}) {
  if (state.status === "loading") {
    return (
      <p className="empty-state" role="status">
        Loading applications…
      </p>
    );
  }
  if (state.status === "unavailable") {
    return (
      <p className="empty-state" role="alert">
        The applications could not be read. Close and reopen the workspace to try again.
      </p>
    );
  }
  const ordered = applicationsByActivity(state.applications);
  return (
    <>
      <ul className="application-list" aria-label="Applications">
        {ordered.map((application) => (
          <ApplicationCard
            key={application.id}
            application={application}
            now={now}
            onOpen={onOpen}
          />
        ))}
      </ul>
      {onlyDefaultApplication(state.applications) ? (
        <p className="empty-state home-empty-applications">
          Applying for another role? Start a new application. It reuses your career profile and
          evidence, so you do not generate them again.
        </p>
      ) : null}
    </>
  );
}

export interface HomeViewProps {
  readonly workspaceTitle: ReactNode;
  readonly workspaceNavigation: ReactNode;
  readonly profile: HomeProfileStatus;
  readonly evidence: CareerEvidenceStatus;
  /** Evidence files stored with the workspace itself, used when no knowledge base is selected. */
  readonly legacyEvidenceSourceCount: number;
  readonly applications: HomeApplicationsState;
  readonly now: Date;
  readonly errorMessage?: string | null;
  /** Disables navigation while a workspace operation is running. */
  readonly disabled?: boolean;
  /** The profile freshness line (up to date, update available, review pending, not generated). */
  readonly profileFreshness?: ReactNode;
  /** The workspace-level settings: model pair, writing policy. */
  readonly settings?: ReactNode;
  /** Present when the host can create applications. */
  readonly onNewApplication?: () => void;
  readonly onOpenApplication: (application: ApplicationSummaryView) => void;
  readonly onManageProfile: () => void;
  readonly onManageEvidence: () => void;
}

/** The landing page of an open workspace: what it holds once, and the applications inside it. */
export function HomeView({
  workspaceTitle,
  workspaceNavigation,
  profile,
  evidence,
  legacyEvidenceSourceCount,
  applications,
  now,
  errorMessage = null,
  disabled = false,
  profileFreshness,
  settings,
  onNewApplication,
  onOpenApplication,
  onManageProfile,
  onManageEvidence,
}: HomeViewProps) {
  const profilePresentation = profileStatusPresentation(profile);
  const evidenceView = evidencePresentation(evidence, legacyEvidenceSourceCount);
  return (
    <div className="app-frame">
      <main className="app-shell app-shell-single">
        <div className="main-column">
          <header className="home-header">
            <div className="home-header-identity">
              <WorkspaceLocation current="Home" />
              {workspaceTitle}
            </div>
            <div className="home-header-actions">{workspaceNavigation}</div>
          </header>

          {errorMessage === null ? null : (
            <div className="error-banner" role="alert">
              <p>{errorMessage}</p>
            </div>
          )}

          <CareerFlowStrip current="applications" />

          <div className="home-summary">
            {/* Evidence first, matching the Career evidence → Career profile → Applications flow. */}
            <SummaryCard
              id="home-evidence-title"
              title="Career evidence"
              subtitle={careerEvidenceCardSubtitle}
              presentation={evidenceView}
              headline={evidenceView.headline}
              action={
                <button
                  className="button button-outline"
                  type="button"
                  disabled={disabled}
                  onClick={onManageEvidence}
                >
                  {evidenceView.action}
                </button>
              }
            >
              {evidenceView.detail === "" ? null : (
                <p className="home-card-copy">{evidenceView.detail}</p>
              )}
            </SummaryCard>
            <SummaryCard
              id="home-profile-title"
              title="Career profile"
              subtitle={careerProfileCardSubtitle}
              presentation={profilePresentation}
              action={
                <button
                  className="button button-outline"
                  type="button"
                  disabled={disabled || profile.kind === "unsupported"}
                  onClick={onManageProfile}
                >
                  {profilePresentation.action}
                </button>
              }
            >
              <p className="home-card-copy">{profilePresentation.description}</p>
              {profileFreshness}
            </SummaryCard>
          </div>

          <section className="panel home-applications" aria-labelledby="home-applications-title">
            <div className="home-section-head">
              <h2 id="home-applications-title">Applications</h2>
              {onNewApplication === undefined ? null : (
                <button
                  className="button button-primary"
                  type="button"
                  disabled={disabled}
                  onClick={onNewApplication}
                >
                  New application
                </button>
              )}
            </div>
            <ApplicationsList state={applications} now={now} onOpen={onOpenApplication} />
          </section>

          {settings === undefined ? null : (
            <section className="panel home-settings" aria-labelledby="home-settings-title">
              <div className="home-section-head">
                <h2 id="home-settings-title">Workspace settings</h2>
              </div>
              {settings}
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

// -- Container ------------------------------------------------------------------------------

export interface HomeScreenProps {
  readonly workspaceId: string;
  readonly workspaceTitle: ReactNode;
  readonly workspaceNavigation: ReactNode;
  readonly profileCapabilities: DesktopProfileCapabilities;
  readonly evidenceCapabilities: CareerEvidenceCapabilities;
  /** Bumped when the knowledge selection or contents change, so the summary reads again. */
  readonly evidenceRevision: number;
  readonly legacyEvidenceSourceCount: number;
  readonly applicationCapabilities: DesktopApplicationCapabilities;
  readonly errorMessage: string | null;
  readonly disabled: boolean;
  readonly settings?: ReactNode;
  /** Opens the guided New application flow; absent when the host cannot create applications. */
  readonly onNewApplication?: () => void;
  readonly onOpenApplication: (application: ApplicationSummaryView) => void;
  readonly onManageProfile: () => void;
  readonly onManageEvidence: () => void;
}

export function HomeScreen({
  workspaceId,
  workspaceTitle,
  workspaceNavigation,
  profileCapabilities,
  evidenceCapabilities,
  evidenceRevision,
  legacyEvidenceSourceCount,
  applicationCapabilities,
  errorMessage,
  disabled,
  settings,
  onNewApplication,
  onOpenApplication,
  onManageProfile,
  onManageEvidence,
}: HomeScreenProps) {
  const [profile, setProfile] = useState<HomeProfileStatus>({ kind: "loading" });
  const [reviewedProfileId, setReviewedProfileId] = useState<string | undefined>(undefined);
  const [freshness, setFreshness] = useState<ProfileFreshnessResult | undefined>(undefined);
  const [evidence, setEvidence] = useState<CareerEvidenceStatus>({ kind: "loading" });
  const [applications, setApplications] = useState<HomeApplicationsState>({ status: "loading" });
  const profileRef = useRef(profileCapabilities);
  profileRef.current = profileCapabilities;
  const evidenceRef = useRef(evidenceCapabilities);
  evidenceRef.current = evidenceCapabilities;
  const listApplications = applicationCapabilities.listApplications;

  useEffect(() => {
    let active = true;
    void readHomeProfile(profileRef.current, workspaceId).then((loaded) => {
      if (!active) return;
      setProfile(loaded.status);
      setReviewedProfileId(loaded.status.kind === "reviewed" ? loaded.profileId : undefined);
    });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  // Only a reviewed profile can be stale; the other states are known from the status alone. The
  // evidence revision re-reads it after the career evidence changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `evidenceRevision` re-reads freshness after the knowledge changes; the capabilities go through a ref.
  useEffect(() => {
    setFreshness(undefined);
    if (reviewedProfileId === undefined) return;
    let active = true;
    void loadProfileFreshness(profileRef.current, workspaceId, reviewedProfileId).then((read) => {
      if (active) setFreshness(read);
    });
    return () => {
      active = false;
    };
  }, [workspaceId, reviewedProfileId, evidenceRevision]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `evidenceRevision` re-reads the base after the knowledge changes; the capabilities go through a ref so a new object never refetches.
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
    if (listApplications === undefined) {
      setApplications({ status: "unavailable" });
      return;
    }
    let active = true;
    setApplications({ status: "loading" });
    listApplications(workspaceId)
      .then((loaded) => {
        if (active) setApplications({ status: "ready", applications: loaded });
      })
      .catch(() => {
        if (active) setApplications({ status: "unavailable" });
      });
    return () => {
      active = false;
    };
  }, [workspaceId, listApplications]);

  const freshnessLine = profileFreshnessPresentation(profile, freshness);
  return (
    <HomeView
      workspaceTitle={workspaceTitle}
      workspaceNavigation={workspaceNavigation}
      profile={profile}
      evidence={evidence}
      legacyEvidenceSourceCount={legacyEvidenceSourceCount}
      applications={applications}
      now={new Date()}
      errorMessage={errorMessage}
      disabled={disabled}
      {...(freshnessLine === undefined
        ? {}
        : {
            profileFreshness: (
              <ProfileFreshnessNote
                presentation={freshnessLine}
                disabled={disabled}
                onAction={onManageProfile}
              />
            ),
          })}
      {...(settings === undefined ? {} : { settings })}
      {...(onNewApplication === undefined ? {} : { onNewApplication })}
      onOpenApplication={onOpenApplication}
      onManageProfile={onManageProfile}
      onManageEvidence={onManageEvidence}
    />
  );
}
