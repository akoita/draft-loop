import { t } from "@lingui/core/macro";
import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";

import {
  type ApplicationJobSource,
  type ApplicationStepId,
  type ApplicationStepState,
  applicationJobStepNote,
  applicationStepIds,
  applicationStepStatusText,
} from "./application-steps-model.js";
import { OpenJobReplacement } from "./job-replacement.js";

export interface ApplicationStepsViewProps {
  readonly steps: readonly ApplicationStepState[];
  /** Each step's content: the controls that finish it, with at most one primary action. */
  readonly content: Readonly<Record<ApplicationStepId, ReactNode>>;
  /** The application's name, shown on the current step so a long page still says which one. */
  readonly applicationName?: string;
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
export function ApplicationStepsView({
  steps,
  content,
  applicationName,
}: ApplicationStepsViewProps) {
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
              {current && applicationName !== undefined ? (
                <p className="application-step-subject">{t`Application: ${applicationName}`}</p>
              ) : null}
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
        {ready ? t`Replace job description` : t`Add job description`}
      </button>
      <label className="url-input-label">
        <span>{t`Or provide a public URL`}</span>
        <input
          className="url-input"
          type="url"
          placeholder={t`https://…`}
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
          aria-label={t`Target job description URL`}
        />
      </label>
      <button
        className="button button-outline"
        type="button"
        disabled={onFetchUrl === undefined || url.trim() === ""}
        onClick={() => onFetchUrl?.()}
      >{t`Review and fetch job URL`}</button>
    </>
  );
}

export interface ApplicationJobStepProps {
  /** DOM id the start checklist scrolls to. */
  readonly id: string;
  readonly ready: boolean;
  /** An approved job page is already the source: the inputs then only replace it. */
  readonly source?: ApplicationJobSource;
  /** The job description inputs, folded once the job description is added. */
  readonly children: readonly [ReactNode, ReactNode];
}

/**
 * The job step: the job description inputs, then the requirements brief and its review. Once the
 * job description is set, the requirements come first and replacing the job folds below them, so
 * the step's next action is the first thing in it.
 */
export function ApplicationJobStep({
  id,
  ready,
  source = "document",
  children: [inputs, requirements],
}: ApplicationJobStepProps) {
  const sourceSet = ready || source === "approved-page";
  const [replacing, setReplacing] = useState(false);
  const replacement = useRef<HTMLDetailsElement>(null);
  const openReplacement = useCallback(() => {
    setReplacing(true);
    // After the inputs show, bring them into view and put the focus on their summary.
    requestAnimationFrame(() => {
      const summary = replacement.current?.querySelector("summary");
      summary?.scrollIntoView({ block: "nearest" });
      summary?.focus();
    });
  }, []);
  return (
    <div id={id} className="application-step-job">
      <p className="setup-note">{applicationJobStepNote(source, ready)}</p>
      {sourceSet ? (
        <>
          <OpenJobReplacement.Provider value={openReplacement}>
            {requirements}
          </OpenJobReplacement.Provider>
          <details
            ref={replacement}
            className="setup-details"
            open={replacing}
            onToggle={(event) => setReplacing(event.currentTarget.open)}
          >
            <summary>{t`Replace the job description`}</summary>
            {inputs}
          </details>
        </>
      ) : (
        <>
          <div className="application-job-inputs">{inputs}</div>
          {requirements}
        </>
      )}
    </div>
  );
}
