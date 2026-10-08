import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";

import type { ApplicationSummaryView } from "./application-contract.js";
import {
  type CareerEvidenceCapabilities,
  type CareerEvidenceStatus,
  loadCareerEvidenceStatus,
} from "./career-evidence.js";
import {
  applicationActivityText,
  applicationRunText,
  applicationStatusLabel,
  applicationStatusTone,
  applicationsByActivity,
  emptyNewApplicationDraft,
  evidencePresentation,
  type HomeApplicationsState,
  type HomeProfileStatus,
  type HomeStatusPresentation,
  type HomeTone,
  loadHomeProfileStatus,
  type NewApplicationDraft,
  newApplicationProblem,
  onlyDefaultApplication,
  profileStatusPresentation,
} from "./home-model.js";
import { safeKnowledgeBaseDisplayName } from "./knowledge.js";
import type { DesktopApplicationCapabilities, DesktopProfileCapabilities } from "./native.js";

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
  presentation,
  headline,
  children,
  action,
}: {
  readonly id: string;
  readonly title: string;
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
      {headline === undefined ? null : <p className="home-card-headline">{headline}</p>}
      {children}
      <div className="home-card-actions">{action}</div>
    </section>
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
  /** Where the profile freshness (up to date or update available) will appear. */
  readonly profileFreshness?: ReactNode;
  /** The workspace-level settings: model pair, writing policy. */
  readonly settings?: ReactNode;
  /** Present when the host can create applications. */
  readonly onNewApplication?: () => void;
  readonly newApplicationButtonRef?: RefObject<HTMLButtonElement | null>;
  readonly onOpenApplication: (application: ApplicationSummaryView) => void;
  readonly onManageProfile: () => void;
  readonly onManageEvidence: () => void;
  /** The New application dialog, when open. */
  readonly dialog?: ReactNode;
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
  newApplicationButtonRef,
  onOpenApplication,
  onManageProfile,
  onManageEvidence,
  dialog,
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

          <div className="home-summary">
            <SummaryCard
              id="home-profile-title"
              title="Career profile"
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
            <SummaryCard
              id="home-evidence-title"
              title="Career evidence"
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
          </div>

          <section className="panel home-applications" aria-labelledby="home-applications-title">
            <div className="home-section-head">
              <h2 id="home-applications-title">Applications</h2>
              {onNewApplication === undefined ? null : (
                <button
                  ref={newApplicationButtonRef}
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
      {dialog}
    </div>
  );
}

// -- New application dialog -----------------------------------------------------------------

interface NewApplicationDialogProps {
  readonly draft: NewApplicationDraft;
  readonly busy: boolean;
  readonly errorMessage: string | null;
  readonly onDraftChange: (draft: NewApplicationDraft) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}

const focusableSelector =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A minimal start: a name and the pasted job text. The guided flow arrives with #1056. */
export function NewApplicationDialog({
  draft,
  busy,
  errorMessage,
  onDraftChange,
  onSubmit,
  onCancel,
}: NewApplicationDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // The review's keyboard shortcuts must not fire while this dialog is open.
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      if (!busy) onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
    const first = focusable[0];
    const last = focusable.at(-1);
    if (first === undefined || last === undefined) {
      event.preventDefault();
      dialog.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const problem = newApplicationProblem(draft);
  return (
    <div className="modal-backdrop">
      <section
        ref={dialogRef}
        className="modal-card new-application-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-application-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && problem === null) onSubmit();
          }}
        >
          <div className="modal-header">
            <div>
              <p className="eyebrow">Applications</p>
              <h2 id="new-application-title">New application</h2>
            </div>
          </div>
          <p className="modal-copy">
            Name the role and paste its job description. DraftLoop reuses your career profile and
            evidence, and keeps this application's drafts and exports together.
          </p>
          <label className="new-application-field">
            <span>Name</span>
            <input
              ref={nameRef}
              type="text"
              value={draft.name}
              maxLength={120}
              disabled={busy}
              placeholder="Company and role"
              onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
            />
          </label>
          <label className="new-application-field">
            <span>Job description</span>
            <textarea
              value={draft.jobText}
              rows={10}
              disabled={busy}
              placeholder="Paste the job description"
              onChange={(event) => onDraftChange({ ...draft, jobText: event.target.value })}
            />
          </label>
          {errorMessage === null ? null : (
            <p className="setup-blocker" role="alert">
              {errorMessage}
            </p>
          )}
          <div className="new-application-actions">
            <button
              className="button button-outline"
              type="button"
              disabled={busy}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              className="button button-primary"
              type="submit"
              disabled={busy || problem !== null}
              aria-describedby={problem === null ? undefined : "new-application-problem"}
            >
              {busy ? "Creating…" : "Create application"}
            </button>
          </div>
          {problem === null ? null : (
            <p className="subtle" id="new-application-problem">
              {problem}
            </p>
          )}
        </form>
      </section>
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
  readonly profileFreshness?: ReactNode;
  readonly settings?: ReactNode;
  readonly onOpenApplication: (application: ApplicationSummaryView) => void;
  readonly onManageProfile: () => void;
  readonly onManageEvidence: () => void;
}

function createFailureText(reason: unknown): string {
  return reason instanceof Error && reason.message.trim() !== ""
    ? reason.message
    : "The application could not be created.";
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
  profileFreshness,
  settings,
  onOpenApplication,
  onManageProfile,
  onManageEvidence,
}: HomeScreenProps) {
  const [profile, setProfile] = useState<HomeProfileStatus>({ kind: "loading" });
  const [evidence, setEvidence] = useState<CareerEvidenceStatus>({ kind: "loading" });
  const [applications, setApplications] = useState<HomeApplicationsState>({ status: "loading" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<NewApplicationDraft>(emptyNewApplicationDraft);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const newApplicationButtonRef = useRef<HTMLButtonElement>(null);
  const dialogWasOpen = useRef(false);
  const profileRef = useRef(profileCapabilities);
  profileRef.current = profileCapabilities;
  const evidenceRef = useRef(evidenceCapabilities);
  evidenceRef.current = evidenceCapabilities;
  const listApplications = applicationCapabilities.listApplications;
  const createApplication = applicationCapabilities.createApplication;

  useEffect(() => {
    let active = true;
    void loadHomeProfileStatus(profileRef.current, workspaceId).then((loaded) => {
      if (active) setProfile(loaded);
    });
    return () => {
      active = false;
    };
  }, [workspaceId]);

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

  // Focus returns to the button that opened the dialog when it closes without creating.
  useEffect(() => {
    if (dialogOpen) dialogWasOpen.current = true;
    else if (dialogWasOpen.current) {
      dialogWasOpen.current = false;
      newApplicationButtonRef.current?.focus();
    }
  }, [dialogOpen]);

  const submit = async () => {
    if (createApplication === undefined || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createApplication(workspaceId, draft.name.trim(), draft.jobText);
      setDialogOpen(false);
      setDraft(emptyNewApplicationDraft);
      onOpenApplication(created);
    } catch (reason: unknown) {
      setCreateError(createFailureText(reason));
    } finally {
      setCreating(false);
    }
  };

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
      {...(profileFreshness === undefined ? {} : { profileFreshness })}
      {...(settings === undefined ? {} : { settings })}
      {...(createApplication === undefined
        ? {}
        : {
            onNewApplication: () => {
              setCreateError(null);
              setDialogOpen(true);
            },
          })}
      newApplicationButtonRef={newApplicationButtonRef}
      onOpenApplication={onOpenApplication}
      onManageProfile={onManageProfile}
      onManageEvidence={onManageEvidence}
      dialog={
        dialogOpen ? (
          <NewApplicationDialog
            draft={draft}
            busy={creating}
            errorMessage={createError}
            onDraftChange={setDraft}
            onSubmit={() => void submit()}
            onCancel={() => setDialogOpen(false)}
          />
        ) : null
      }
    />
  );
}

// -- Profile and evidence screen -------------------------------------------------------------

/** The screen Manage profile and Manage evidence open: the existing panels, with a way back. */
export function ProfileScreen({
  workspaceTitle,
  workspaceNavigation,
  errorMessage,
  onHome,
  children,
}: {
  readonly workspaceTitle: ReactNode;
  readonly workspaceNavigation: ReactNode;
  readonly errorMessage: string | null;
  readonly onHome: () => void;
  readonly children: ReactNode;
}) {
  return (
    <div className="app-frame">
      <main className="app-shell app-shell-single">
        <div className="main-column">
          <header className="home-header">
            <div className="home-header-identity">
              <WorkspaceLocation current="Career profile and evidence" onHome={onHome} />
              {workspaceTitle}
            </div>
            <div className="home-header-actions">{workspaceNavigation}</div>
          </header>
          {errorMessage === null ? null : (
            <div className="error-banner" role="alert">
              <p>{errorMessage}</p>
            </div>
          )}
          <div className="home-profile-screen">{children}</div>
        </div>
      </main>
    </div>
  );
}
