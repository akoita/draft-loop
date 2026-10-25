import type { ApplicationSummaryView } from "@draft-loop/ui/application-contract";
import { type RefObject, useRef, useState } from "react";
import {
  emptyNewApplicationDraft,
  type NewApplicationDraft,
  type NewApplicationJobKind,
  newApplicationJobInput,
  newApplicationProblem,
} from "./new-application-model.js";
import { useModalFocusTrap } from "./review.js";

export interface NewApplicationFormViewProps {
  readonly draft: NewApplicationDraft;
  readonly busy: boolean;
  /** Why the host refused to create the application, shown in the form. */
  readonly errorMessage: string | null;
  readonly dialogRef?: RefObject<HTMLDivElement | null>;
  readonly onDraftChange: (draft: NewApplicationDraft) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}

/**
 * Home's New application form: a name and the job, pasted or a job page the person approves
 * fetching. Everything else happens on the application screen's three steps.
 */
export function NewApplicationFormView({
  draft,
  busy,
  errorMessage,
  dialogRef,
  onDraftChange,
  onSubmit,
  onCancel,
}: NewApplicationFormViewProps) {
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
    <div className="modal-backdrop">
      <div
        className="modal-card new-application-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-application-title"
        aria-describedby="new-application-copy"
        ref={dialogRef}
      >
        <form
          className="new-application-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && problem === null) onSubmit();
          }}
        >
          <h2 id="new-application-title">New application</h2>
          <p className="modal-copy" id="new-application-copy">
            Name the role and give its job posting. The application then opens on its three steps,
            starting with extracting and reviewing the requirements.
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
                rows={8}
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
              <label className="new-application-approval">
                <input
                  type="checkbox"
                  checked={draft.urlApproved}
                  disabled={busy}
                  onChange={(event) =>
                    onDraftChange({ ...draft, urlApproved: event.target.checked })
                  }
                />
                <span>
                  I approve DraftLoop fetching this page. It is read only when you extract
                  requirements on the application&apos;s first step, never before.
                </span>
              </label>
            </>
          )}
          {errorMessage === null ? null : (
            <p className="setup-blocker" role="alert">
              {errorMessage}
            </p>
          )}
          {problem === null ? null : (
            <p className="subtle" id="new-application-problem">
              {problem}
            </p>
          )}
          <div className="new-application-actions">
            <button className="button button-quiet" type="button" onClick={onCancel}>
              Cancel
            </button>
            <button
              className="button button-primary"
              type="submit"
              disabled={busy || problem !== null}
              {...(problem === null ? {} : { "aria-describedby": "new-application-problem" })}
            >
              {busy ? "Creating…" : "Create application"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export type CreateApplication = (
  name: string,
  job: string | { readonly url: string },
) => Promise<ApplicationSummaryView>;

export type NewApplicationSubmission =
  | { readonly kind: "invalid"; readonly problem: string }
  | { readonly kind: "created"; readonly application: ApplicationSummaryView }
  | { readonly kind: "failed"; readonly message: string };

/**
 * Creates the application from a valid draft: the trimmed name and the pasted text or approved
 * URL, as the application port takes them. An invalid draft calls nothing.
 */
export async function submitNewApplication(
  draft: NewApplicationDraft,
  createApplication: CreateApplication,
): Promise<NewApplicationSubmission> {
  const problem = newApplicationProblem(draft);
  if (problem !== null) return { kind: "invalid", problem };
  try {
    const application = await createApplication(draft.name.trim(), newApplicationJobInput(draft));
    return { kind: "created", application };
  } catch (reason: unknown) {
    return {
      kind: "failed",
      message:
        reason instanceof Error && reason.message.trim() !== ""
          ? reason.message
          : "The application could not be created.",
    };
  }
}

export interface NewApplicationDialogProps {
  /** The application port's create call, scoped to the open workspace. */
  readonly createApplication: CreateApplication;
  /** Opens the created application; the dialog closes itself first. */
  readonly onCreated: (application: ApplicationSummaryView) => void;
  readonly onClose: () => void;
}

/** The form as a modal: it traps the focus, Escape cancels, and a failure stays in the form. */
export function NewApplicationDialog({
  createApplication,
  onCreated,
  onClose,
}: NewApplicationDialogProps) {
  const [draft, setDraft] = useState<NewApplicationDraft>(emptyNewApplicationDraft);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const creatingRef = useRef(false);
  const close = () => {
    if (!creatingRef.current) onClose();
  };
  useModalFocusTrap(true, dialogRef, close);

  const create = async () => {
    if (creatingRef.current || newApplicationProblem(draft) !== null) return;
    creatingRef.current = true;
    setCreating(true);
    setError(null);
    const outcome = await submitNewApplication(draft, createApplication);
    creatingRef.current = false;
    if (outcome.kind === "created") {
      onClose();
      onCreated(outcome.application);
      return;
    }
    setError(outcome.kind === "failed" ? outcome.message : outcome.problem);
    setCreating(false);
  };

  return (
    <NewApplicationFormView
      draft={draft}
      busy={creating}
      errorMessage={error}
      dialogRef={dialogRef}
      onDraftChange={setDraft}
      onSubmit={() => void create()}
      onCancel={close}
    />
  );
}
