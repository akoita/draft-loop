import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";

import {
  type ApplicationAction,
  type ApplicationActionNotice,
  applicationActionErrorNotice,
  applicationActionSuccessNotice,
  applicationDeleteConfirmation,
  applicationDeleteExplanation,
  canDeleteApplication,
  partitionApplications,
} from "./application-archive-model.js";
import type { ApplicationSummaryView } from "./application-contract.js";
import {
  type ApplicationImportNotice,
  applicationImportErrorNotice,
  applicationImportExplanation,
  applicationImportSuccessNotice,
} from "./application-import-model.js";
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
  applicationRunningLabel,
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
  profileGenerationPresentation,
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
import {
  type ProfileGenerationActivity,
  ProfileGenerationSummary,
} from "./profile-generation-progress.js";

/**
 * Focus lands on the location line of a screen when it opens or is returned to, so assistive
 * technology says where. It does not scroll: a page returned to keeps its scroll position.
 */
function useFocusOnOpen(ref: RefObject<HTMLElement | null>): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the ref object is stable and focus moves once per screen.
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
}

/** The Back action of a screen: the page it returns to. */
export interface WorkspaceBack {
  /** The name of the page Back returns to, such as "Home" or an application's name. */
  readonly label: string;
  readonly onBack: () => void;
}

interface WorkspaceLocationProps {
  /** The name of the screen; shown as the current page. */
  readonly current: string;
  /** Present on every screen but Home: returns to the page the person came from. */
  readonly back?: WorkspaceBack;
  /** Names the screen with the page heading, for a screen with no other title. */
  readonly asHeading?: boolean;
}

/** "← Previous page / Current screen": the way back, and the screen's label. */
export function WorkspaceLocation({ current, back, asHeading = false }: WorkspaceLocationProps) {
  const ref = useRef<HTMLElement>(null);
  useFocusOnOpen(ref);
  return (
    <nav ref={ref} className="home-location" aria-label="Workspace location" tabIndex={-1}>
      {back === undefined ? null : (
        <button
          className="button button-quiet home-back"
          type="button"
          title={`Back to ${back.label}`}
          aria-label={`Back to ${back.label}`}
          onClick={back.onBack}
        >
          <span aria-hidden="true">←</span> <span className="home-back-label">{back.label}</span>
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

/** A status card: title, one-line purpose, a chip, and the action that opens its screen. */
export function SummaryCard({
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

/** What a card can do besides opening; each action is absent when the host cannot do it. */
export interface ApplicationCardActions {
  /** Archives an active application, or restores an archived one. */
  readonly onArchive?: () => void;
  /** Asks to delete; present only for an application that can be deleted. */
  readonly onRequestDelete?: () => void;
  readonly onConfirmDelete?: () => void;
  readonly onCancelDelete?: () => void;
  /** True while the delete confirmation is showing on this card. */
  readonly confirmingDelete?: boolean;
  /** True while an action on this card, or anything else in the workspace, is running. */
  readonly busy?: boolean;
}

export function ApplicationCard({
  application,
  now,
  onOpen,
  actions = {},
  running = false,
}: {
  readonly application: ApplicationSummaryView;
  readonly now: Date;
  readonly onOpen: (application: ApplicationSummaryView) => void;
  readonly actions?: ApplicationCardActions;
  /** True while this application's review is running; the card says so in place of its status. */
  readonly running?: boolean;
}) {
  const metaId = `application-meta-${application.id}`;
  const archived = application.archivedAt !== null;
  const { onArchive, onRequestDelete, onConfirmDelete, onCancelDelete } = actions;
  const busy = actions.busy === true;
  return (
    <li className={archived ? "application-card application-card-archived" : "application-card"}>
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
        {running ? (
          <Chip tone="progress">{applicationRunningLabel}</Chip>
        ) : (
          <Chip tone={applicationStatusTone(application.status)}>
            {applicationStatusLabel(application.status)}
          </Chip>
        )}
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
      {actions.confirmingDelete === true && onConfirmDelete !== undefined ? (
        <fieldset className="application-card-confirm">
          <legend>{applicationDeleteConfirmation(application.name)}</legend>
          <div className="application-card-actions">
            <button
              className="button button-danger"
              type="button"
              disabled={busy}
              onClick={onConfirmDelete}
            >
              Delete
            </button>
            <button
              className="button button-outline"
              type="button"
              disabled={busy}
              onClick={onCancelDelete}
            >
              Cancel
            </button>
          </div>
        </fieldset>
      ) : onArchive === undefined && onRequestDelete === undefined ? null : (
        <div className="application-card-actions">
          {onArchive === undefined ? null : (
            <button
              className="button button-outline"
              type="button"
              disabled={busy}
              aria-label={`${archived ? "Restore" : "Archive"} ${application.name}`}
              onClick={onArchive}
            >
              {archived ? "Restore" : "Archive"}
            </button>
          )}
          {onRequestDelete === undefined ? null : (
            <button
              className="button button-danger"
              type="button"
              disabled={busy}
              aria-label={`Delete ${application.name}`}
              onClick={onRequestDelete}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function ApplicationsList({
  state,
  now,
  onOpen,
  onArchive,
  onDelete,
  busyApplicationId = null,
  runningApplicationId = null,
  disabled = false,
  initialShowArchived = false,
}: {
  readonly state: HomeApplicationsState;
  readonly now: Date;
  readonly onOpen: (application: ApplicationSummaryView) => void;
  readonly onArchive?:
    | ((application: ApplicationSummaryView, archived: boolean) => void)
    | undefined;
  readonly onDelete?: ((application: ApplicationSummaryView) => void) | undefined;
  readonly busyApplicationId?: string | null;
  readonly runningApplicationId?: string | null;
  readonly disabled?: boolean;
  readonly initialShowArchived?: boolean;
}) {
  const [showArchived, setShowArchived] = useState(initialShowArchived);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
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
  const { active, archived } = partitionApplications(applicationsByActivity(state.applications));
  const actionsFor = (application: ApplicationSummaryView): ApplicationCardActions => {
    const isArchived = application.archivedAt !== null;
    return {
      busy: disabled || busyApplicationId !== null,
      confirmingDelete: confirmingId === application.id,
      ...(onArchive === undefined ? {} : { onArchive: () => onArchive(application, !isArchived) }),
      ...(onDelete === undefined || !canDeleteApplication(application)
        ? {}
        : {
            onRequestDelete: () => setConfirmingId(application.id),
            onConfirmDelete: () => {
              setConfirmingId(null);
              onDelete(application);
            },
            onCancelDelete: () => setConfirmingId(null),
          }),
    };
  };
  const card = (application: ApplicationSummaryView) => (
    <ApplicationCard
      key={application.id}
      application={application}
      now={now}
      onOpen={onOpen}
      actions={actionsFor(application)}
      running={application.id === runningApplicationId}
    />
  );
  return (
    <>
      {active.length === 0 ? null : (
        <ul className="application-list" aria-label="Applications">
          {active.map(card)}
        </ul>
      )}
      {active.length === 0 && archived.length > 0 ? (
        <p className="empty-state home-empty-applications">
          Every application is archived. Start a new application, or restore one below.
        </p>
      ) : archived.length === 0 && onlyDefaultApplication(active) ? (
        <p className="empty-state home-empty-applications">
          Applying for another role? Start a new application. It reuses your career profile and
          evidence, so you do not generate them again.
        </p>
      ) : null}
      {archived.length === 0 ? null : (
        <div className="home-archived-applications">
          <button
            className="button button-outline"
            type="button"
            aria-expanded={showArchived}
            aria-controls="home-archived-applications"
            onClick={() => setShowArchived((shown) => !shown)}
          >
            {showArchived ? "Hide archived" : `Show archived (${archived.length})`}
          </button>
          {showArchived ? (
            <div id="home-archived-applications" className="home-archived-applications-body">
              <ul className="application-list" aria-label="Archived applications">
                {archived.map(card)}
              </ul>
              {onDelete === undefined ? null : (
                <p className="home-card-copy">{applicationDeleteExplanation}</p>
              )}
            </div>
          ) : null}
        </div>
      )}
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
  /**
   * Disables the actions that change applications (new, import, archive, delete) while a
   * workspace operation runs. Moving between pages always stays available.
   */
  readonly disabled?: boolean;
  /** Says why those actions are disabled; shown only while they are. */
  readonly disabledReason?: string | null;
  /** The profile generation running on the profile page, shown on the Career profile card. */
  readonly profileGeneration?: ProfileGenerationActivity | null;
  /** The application whose review is running, marked on its card. */
  readonly runningApplicationId?: string | null;
  /** The profile freshness line (up to date, update available, review pending, not generated). */
  readonly profileFreshness?: ReactNode;
  /** The workspace-level settings: model pair, writing policy. */
  readonly settings?: ReactNode;
  /** Present when the host can create applications. */
  readonly onNewApplication?: () => void;
  /** Present when the host can import another workspace as an application. */
  readonly onImportApplication?: () => void;
  /** True while the folder picker or the import is running. */
  readonly importing?: boolean;
  /** The outcome of the last import: what it copied, or why it was refused. */
  readonly importNotice?: ApplicationImportNotice | null;
  /** Present when the host can archive and restore applications. */
  readonly onArchiveApplication?: (application: ApplicationSummaryView, archived: boolean) => void;
  /** Present when the host can delete applications; called after the person confirmed. */
  readonly onDeleteApplication?: (application: ApplicationSummaryView) => void;
  /** The application an archive, restore or delete is running on. */
  readonly busyApplicationId?: string | null;
  /** The outcome of the last archive, restore or delete. */
  readonly applicationNotice?: ApplicationActionNotice | null;
  /** Opens the archived applications on first render; for tests and previews. */
  readonly initialShowArchived?: boolean;
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
  disabledReason = null,
  profileGeneration = null,
  runningApplicationId = null,
  profileFreshness,
  settings,
  onNewApplication,
  onImportApplication,
  importing = false,
  importNotice = null,
  onArchiveApplication,
  onDeleteApplication,
  busyApplicationId = null,
  applicationNotice = null,
  initialShowArchived = false,
  onOpenApplication,
  onManageProfile,
  onManageEvidence,
}: HomeViewProps) {
  const profilePresentation =
    profileGeneration === null ? profileStatusPresentation(profile) : profileGenerationPresentation;
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

          <CareerFlowStrip
            current="applications"
            onOpen={{
              evidence: onManageEvidence,
              ...(profile.kind === "unsupported" ? {} : { profile: onManageProfile }),
            }}
          />

          <div className="home-summary">
            {/* Evidence first, matching the Career evidence → Career profile → Applications flow. */}
            <SummaryCard
              id="home-evidence-title"
              title="Career evidence"
              subtitle={careerEvidenceCardSubtitle}
              presentation={evidenceView}
              headline={evidenceView.headline}
              action={
                <button className="button button-outline" type="button" onClick={onManageEvidence}>
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
                  disabled={profile.kind === "unsupported"}
                  onClick={onManageProfile}
                >
                  {profilePresentation.action}
                </button>
              }
            >
              <p className="home-card-copy">{profilePresentation.description}</p>
              {profileGeneration === null ? (
                profileFreshness
              ) : (
                <div role="status">
                  <ProfileGenerationSummary activity={profileGeneration} />
                </div>
              )}
            </SummaryCard>
          </div>

          <section className="panel home-applications" aria-labelledby="home-applications-title">
            <div className="home-section-head">
              <h2 id="home-applications-title">Applications</h2>
              <div className="home-section-actions">
                {onImportApplication === undefined ? null : (
                  <button
                    className="button button-outline"
                    type="button"
                    disabled={disabled || importing}
                    aria-describedby="home-import-explanation"
                    onClick={onImportApplication}
                  >
                    {importing ? "Importing…" : "Import from another workspace"}
                  </button>
                )}
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
            </div>
            {onImportApplication === undefined ? null : (
              <p className="home-card-copy" id="home-import-explanation">
                {applicationImportExplanation}
              </p>
            )}
            {!disabled || disabledReason === null ? null : (
              <p className="home-card-copy home-actions-blocked" role="status">
                {disabledReason}
              </p>
            )}
            {[importNotice, applicationNotice].map((notice, index) =>
              notice === null ? null : notice.kind === "error" ? (
                <div className="error-banner" role="alert" key={index === 0 ? "import" : "action"}>
                  <p>{notice.message}</p>
                </div>
              ) : (
                <p
                  className="home-card-copy home-import-success"
                  role="status"
                  key={index === 0 ? "import" : "action"}
                >
                  {notice.message}
                </p>
              ),
            )}
            <ApplicationsList
              state={applications}
              now={now}
              onOpen={onOpenApplication}
              onArchive={onArchiveApplication}
              onDelete={onDeleteApplication}
              busyApplicationId={busyApplicationId}
              runningApplicationId={runningApplicationId}
              disabled={disabled}
              initialShowArchived={initialShowArchived}
            />
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
  /** Disables the actions that change applications; navigation stays available. */
  readonly disabled: boolean;
  readonly disabledReason?: string | null;
  readonly profileGeneration?: ProfileGenerationActivity | null;
  readonly runningApplicationId?: string | null;
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
  disabledReason = null,
  profileGeneration = null,
  runningApplicationId = null,
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
  const importApplication = applicationCapabilities.importApplication;
  const archiveApplication = applicationCapabilities.archiveApplication;
  const deleteApplication = applicationCapabilities.deleteApplication;
  const [busyApplicationId, setBusyApplicationId] = useState<string | null>(null);
  const [applicationNotice, setApplicationNotice] = useState<ApplicationActionNotice | null>(null);
  const [importing, setImporting] = useState(false);
  const [importNotice, setImportNotice] = useState<ApplicationImportNotice | null>(null);
  const [applicationsRevision, setApplicationsRevision] = useState(0);
  const importRun = useRef(0);

  // A different workspace never inherits the previous one's import outcome.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the workspace id is the trigger.
  useEffect(() => {
    importRun.current += 1;
    setImporting(false);
    setImportNotice(null);
    setBusyApplicationId(null);
    setApplicationNotice(null);
  }, [workspaceId]);

  // One action at a time; its outcome replaces the previous notice and re-reads the list.
  const runApplicationAction = (
    application: ApplicationSummaryView,
    action: ApplicationAction,
    operation: () => Promise<unknown>,
  ) => {
    const run = importRun.current;
    setBusyApplicationId(application.id);
    setImportNotice(null);
    setApplicationNotice(null);
    operation()
      .then(() => {
        if (run !== importRun.current) return;
        setApplicationNotice(applicationActionSuccessNotice(application.name, action));
        setApplicationsRevision((revision) => revision + 1);
      })
      .catch((error: unknown) => {
        if (run === importRun.current) {
          setApplicationNotice(applicationActionErrorNotice(error, action));
        }
      })
      .finally(() => {
        if (run === importRun.current) setBusyApplicationId(null);
      });
  };
  const onArchiveApplication =
    archiveApplication === undefined
      ? undefined
      : (application: ApplicationSummaryView, archived: boolean) =>
          runApplicationAction(application, archived ? "archive" : "restore", () =>
            archiveApplication(workspaceId, application.id, archived),
          );
  const onDeleteApplication =
    deleteApplication === undefined
      ? undefined
      : (application: ApplicationSummaryView) =>
          runApplicationAction(application, "delete", () =>
            deleteApplication(workspaceId, application.id),
          );

  const runImport =
    importApplication === undefined
      ? undefined
      : () => {
          const run = ++importRun.current;
          setImporting(true);
          setImportNotice(null);
          setApplicationNotice(null);
          importApplication(workspaceId)
            .then((result) => {
              if (run !== importRun.current) return;
              setImportNotice(
                applicationImportSuccessNotice(result.application.name, result.imported),
              );
              setApplicationsRevision((revision) => revision + 1);
            })
            .catch((error: unknown) => {
              if (run === importRun.current) setImportNotice(applicationImportErrorNotice(error));
            })
            .finally(() => {
              if (run === importRun.current) setImporting(false);
            });
        };

  // Read again when a generation ends, so a Home left open shows the profile it saved.
  const generating = profileGeneration !== null;
  useEffect(() => {
    if (generating) return;
    let active = true;
    void readHomeProfile(profileRef.current, workspaceId).then((loaded) => {
      if (!active) return;
      setProfile(loaded.status);
      setReviewedProfileId(loaded.status.kind === "reviewed" ? loaded.profileId : undefined);
    });
    return () => {
      active = false;
    };
  }, [workspaceId, generating]);

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: `applicationsRevision` re-reads the list after an import, archive or delete.
  useEffect(() => {
    if (listApplications === undefined) {
      setApplications({ status: "unavailable" });
      return;
    }
    // A Home returned to keeps showing its list while it is read again.
    let active = true;
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
  }, [workspaceId, listApplications, applicationsRevision]);

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
      disabledReason={disabledReason}
      profileGeneration={profileGeneration}
      runningApplicationId={runningApplicationId}
      {...(freshnessLine === undefined
        ? {}
        : {
            profileFreshness: (
              <ProfileFreshnessNote presentation={freshnessLine} onAction={onManageProfile} />
            ),
          })}
      {...(settings === undefined ? {} : { settings })}
      {...(onNewApplication === undefined ? {} : { onNewApplication })}
      {...(runImport === undefined ? {} : { onImportApplication: runImport })}
      importing={importing}
      importNotice={importNotice}
      {...(onArchiveApplication === undefined ? {} : { onArchiveApplication })}
      {...(onDeleteApplication === undefined ? {} : { onDeleteApplication })}
      busyApplicationId={busyApplicationId}
      applicationNotice={applicationNotice}
      onOpenApplication={onOpenApplication}
      onManageProfile={onManageProfile}
      onManageEvidence={onManageEvidence}
    />
  );
}
