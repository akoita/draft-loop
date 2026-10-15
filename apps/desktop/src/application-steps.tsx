import { type ReactNode, type RefObject, useEffect, useRef } from "react";

import {
  type ApplicationStepId,
  type ApplicationStepState,
  applicationStepIds,
  applicationStepStatusText,
} from "./application-steps-model.js";

export interface ApplicationStepsViewProps {
  readonly steps: readonly ApplicationStepState[];
  /** Each step's content: the controls that finish it, with at most one primary action. */
  readonly content: Readonly<Record<ApplicationStepId, ReactNode>>;
}

/**
 * Brings the current step into view and moves the focus to its heading when the steps open, so
 * an application resumes at its first unfinished step. It runs once per open, not on every
 * render: finishing a step later never moves the focus.
 */
export function useCurrentStepOnOpen(listRef: RefObject<HTMLOListElement | null>): void {
  useEffect(() => {
    focusCurrentStep(listRef.current);
  }, [listRef]);
}

/** Scrolls to the current step's heading and focuses it; false when no step is current. */
export function focusCurrentStep(list: Pick<ParentNode, "querySelector"> | null): boolean {
  const step = list?.querySelector<HTMLElement>('[aria-current="step"]') ?? null;
  const heading = step?.querySelector<HTMLElement>("h3") ?? null;
  if (step === null || heading === null) return false;
  // The whole step comes into view, its border included; the focus goes to its heading.
  step.scrollIntoView?.({ block: "start" });
  heading.focus({ preventScroll: true });
  return true;
}

/**
 * The application screen as three numbered steps, top to bottom. Each step states whether it is
 * done, the current step or blocked, and the current one carries `aria-current="step"`.
 */
export function ApplicationStepsView({ steps, content }: ApplicationStepsViewProps) {
  const listRef = useRef<HTMLOListElement | null>(null);
  useCurrentStepOnOpen(listRef);
  return (
    <ol className="application-steps" ref={listRef}>
      {steps.map((step) => {
        const id = applicationStepIds[step.id];
        const titleId = `${id}-title`;
        const current = step.status.kind === "current";
        return (
          <li
            key={step.id}
            id={id}
            className={`application-step application-step-${step.status.kind}`}
            aria-labelledby={titleId}
            {...(current ? { "aria-current": "step" as const } : {})}
          >
            <div className="application-step-head">
              <h3 id={titleId} {...(current ? { tabIndex: -1 } : {})}>
                <span className="application-step-number">{step.number}</span> {step.title}
              </h3>
              <p className="application-step-status">{applicationStepStatusText(step.status)}</p>
            </div>
            <div className="application-step-body">{content[step.id]}</div>
          </li>
        );
      })}
    </ol>
  );
}

export interface JobDescriptionInputsProps {
  readonly ready: boolean;
  readonly url: string;
  readonly onUrlChange: (url: string) => void;
  /** Opens the file picker; absent when the host cannot add files. */
  readonly onChooseFile?: () => void;
  /** Fetches the URL after review; absent when the host cannot add URLs. */
  readonly onFetchUrl?: () => void;
}

/** The ways to give the job description: a file, or a public URL fetched after review. */
export function JobDescriptionInputs({
  ready,
  url,
  onUrlChange,
  onChooseFile,
  onFetchUrl,
}: JobDescriptionInputsProps) {
  return (
    <>
      <button
        className="button button-quiet"
        type="button"
        disabled={onChooseFile === undefined}
        onClick={() => onChooseFile?.()}
      >
        {ready ? "Replace job description" : "Add job description"}
      </button>
      <label className="url-input-label">
        <span>Or provide a public URL</span>
        <input
          className="url-input"
          type="url"
          placeholder="https://…"
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
          aria-label="Target job description URL"
        />
      </label>
      <button
        className="button button-outline"
        type="button"
        disabled={onFetchUrl === undefined || url.trim() === ""}
        onClick={() => onFetchUrl?.()}
      >
        Review and fetch job URL
      </button>
    </>
  );
}

export interface ApplicationJobStepProps {
  /** DOM id the start checklist scrolls to. */
  readonly id: string;
  readonly ready: boolean;
  /** The job description inputs, folded once the job description is added. */
  readonly children: readonly [ReactNode, ReactNode];
}

/** The job step: the job description inputs, then the requirements brief and its review. */
export function ApplicationJobStep({
  id,
  ready,
  children: [inputs, requirements],
}: ApplicationJobStepProps) {
  return (
    <div id={id} className="application-step-job">
      <p className="setup-note">
        {ready
          ? "Job description added."
          : "Add the job description from a file or a public URL, then extract and review its requirements."}
      </p>
      {ready ? (
        <details className="setup-details">
          <summary>Replace the job description</summary>
          {inputs}
        </details>
      ) : (
        <div className="application-job-inputs">{inputs}</div>
      )}
      {requirements}
    </div>
  );
}

export interface OpportunityOverrideDisclosureProps {
  /** Whether the job has a reviewed brief; an override binds to one. */
  readonly reviewed: boolean;
  /** The override chosen for the next run, if any. */
  readonly pending: { readonly version: string; readonly checksumLabel: string } | null;
  readonly disabled: boolean;
  readonly onImport: () => void;
}

/**
 * The per-job writing policy override, folded under Advanced in the review step. The
 * workspace writing policy itself lives on Home.
 */
export function OpportunityOverrideDisclosure({
  reviewed,
  pending,
  disabled,
  onImport,
}: OpportunityOverrideDisclosureProps) {
  return (
    <details className="setup-details setup-advanced">
      <summary>Advanced: writing policy override for this job</summary>
      <p className="setup-note">
        Import a policy version for this reviewed job without changing the workspace policy.
      </p>
      <button
        className="button button-outline"
        type="button"
        disabled={disabled || !reviewed}
        onClick={onImport}
      >
        Import opportunity override
      </button>
      {reviewed ? null : (
        <span className="setup-retrieval-status">
          Review the requirements before importing an override.
        </span>
      )}
      {pending === null ? null : (
        <span className="setup-retrieval-status" role="status">
          Selected override {pending.version} ({pending.checksumLabel}).
        </span>
      )}
    </details>
  );
}
