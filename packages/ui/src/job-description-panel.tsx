import { t } from "@lingui/core/macro";
/**
 * The Job tab of the review's work area: the job description the draft is written for, read-only.
 *
 * Once a run exists the job inputs are gone from the screen, so this is where the reviewer reads
 * the job beside the draft. The text is asked for the first time the tab is shown, and again when
 * the reviewer moves to another run, never while the tab stays hidden.
 */

import { type JSX, useEffect, useRef, useState } from "react";
import type { ApplicationJobResult } from "./application-job-contract.js";
import { formatDate } from "./locale-format.js";
import type { ReviewWorkPanelProps } from "./review-work-tabs.js";

type JobLoad =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly job: ApplicationJobResult };

/** Where the text on screen came from, in one line; null when there is nothing to attribute. */
export function jobOriginNote(job: ApplicationJobResult): string | null {
  switch (job.origin) {
    case "workspace-file":
      return t`From the workspace's job file.`;
    case "pasted-text":
      return t`The text pasted when this application was created.`;
    case "local-file":
      return t`From the file chosen for this application, as it reads now.`;
    case "url": {
      if (job.text === null) {
        return t`From the job page approved for this application. No copy of the page was saved; the Coverage tab lists the requirements extracted from it.`;
      }
      const date = formatDate(job.savedAt ?? "") ?? "";
      if (job.copySource === "pasted") {
        return t`Pasted on ${date} as this job page's copy, so it stays readable after the page expires.`;
      }
      return t`Saved from the job page on ${date}, so it stays readable after the page expires.`;
    }
    case "unavailable":
      return null;
  }
}

/** Saves a copy of a job page that has none: read once more, or pasted by the person (#2593). */
export function JobCopyActions({
  save,
  initialPasting = false,
}: {
  readonly save: (text?: string) => Promise<void>;
  readonly initialPasting?: boolean;
}): JSX.Element {
  const [pasting, setPasting] = useState(initialPasting);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (value?: string) => {
    setBusy(true);
    setError(null);
    save(value).then(
      () => setBusy(false),
      (failure: unknown) => {
        setBusy(false);
        setError(
          failure instanceof Error && failure.message !== ""
            ? failure.message
            : t`The copy could not be saved.`,
        );
      },
    );
  };
  return (
    <div className="job-copy-actions">
      {pasting ? (
        <>
          <label className="job-copy-label" htmlFor="job-copy-text">
            {t`Paste the job description, as the page showed it`}
          </label>
          <textarea
            id="job-copy-text"
            className="job-copy-text"
            rows={8}
            value={text}
            disabled={busy}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="job-copy-buttons">
            <button
              className="button"
              type="button"
              disabled={busy || text.trim() === ""}
              onClick={() => run(text)}
            >{t`Save the description`}</button>
            <button
              className="button button-outline"
              type="button"
              disabled={busy}
              onClick={() => setPasting(false)}
            >{t`Cancel`}</button>
          </div>
        </>
      ) : (
        <div className="job-copy-buttons">
          <button
            className="button button-outline"
            type="button"
            disabled={busy}
            onClick={() => run()}
          >
            {busy ? t`Reading the job page…` : t`Save a copy now`}
          </button>
          <button
            className="button button-outline"
            type="button"
            disabled={busy}
            onClick={() => setPasting(true)}
          >{t`Paste the description`}</button>
        </div>
      )}
      {error === null ? null : (
        <p className="job-status" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** A job page's address, the copy saved when it was read, and its first copy when it differs. */
function SavedJobPage({
  job,
  saveCopy,
}: {
  readonly job: ApplicationJobResult;
  readonly saveCopy?: ((text?: string) => Promise<void>) | undefined;
}): JSX.Element {
  const { earlier } = job;
  const earlierDate = earlier === null ? "" : (formatDate(earlier.savedAt) ?? "");
  return (
    <>
      <p className="job-url">
        <a href={job.url ?? undefined} rel="noreferrer noopener" target="_blank">
          {job.url}
        </a>
      </p>
      {job.text !== null ? (
        <div className="job-text">{job.text}</div>
      ) : saveCopy === undefined ? null : (
        <JobCopyActions save={saveCopy} />
      )}
      {job.truncated ? (
        <p className="job-status">{t`The job description is longer than shown here.`}</p>
      ) : null}
      {earlier === null ? null : (
        <details className="job-earlier">
          <summary>{t`Earlier copy, saved on ${earlierDate}`}</summary>
          <div className="job-text">{earlier.text}</div>
        </details>
      )}
    </>
  );
}

export function JobDescriptionView({
  load,
  onRetry,
  onSaveCopy,
  tabPanel = null,
}: {
  readonly load: JobLoad;
  readonly onRetry: () => void;
  /** Saves a copy of a URL job's page that has none; absent where the host cannot. */
  readonly onSaveCopy?: (text?: string) => Promise<void>;
  readonly tabPanel?: ReviewWorkPanelProps | null;
}): JSX.Element {
  return (
    <section className="panel job-panel" aria-label={t`job description`} {...tabPanel}>
      <div className="section-heading compact">
        <div>
          <h2>{t`Job description`}</h2>
          {load.kind === "ready" && jobOriginNote(load.job) !== null ? (
            <p className="job-origin-note">{jobOriginNote(load.job)}</p>
          ) : null}
        </div>
      </div>
      {load.kind === "loading" ? (
        <p className="job-status" role="status">{t`Reading the job description…`}</p>
      ) : load.kind === "failed" ? (
        <p className="job-status" role="alert">
          {t`The job description could not be read.`}{" "}
          <button
            className="button button-outline"
            type="button"
            onClick={onRetry}
          >{t`Try again`}</button>
        </p>
      ) : load.job.origin === "unavailable" ? (
        <p className="job-status">{t`This application's job description could not be read. Its file may have been moved or emptied.`}</p>
      ) : load.job.origin === "url" ? (
        <SavedJobPage job={load.job} saveCopy={onSaveCopy} />
      ) : (
        <>
          <div className="job-text">{load.job.text}</div>
          {load.job.truncated ? (
            <p className="job-status">{t`The job description is longer than shown here.`}</p>
          ) : null}
        </>
      )}
    </section>
  );
}

export function JobDescriptionPanel({
  readJob,
  saveCopy,
  reloadKey,
  tabPanel,
}: {
  readonly readJob: () => Promise<ApplicationJobResult>;
  readonly saveCopy?: (text?: string) => Promise<ApplicationJobResult>;
  /** Changes when the review moves to another run, so the job is read again. */
  readonly reloadKey: string;
  readonly tabPanel: ReviewWorkPanelProps | null;
}): JSX.Element {
  const shown = tabPanel?.hidden !== true;
  const [load, setLoad] = useState<JobLoad>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  // The read the panel last started; a hidden tab or a re-render never starts another.
  const requested = useRef<string | null>(null);
  const target = `${reloadKey}#${attempt}`;
  // A new read function on each parent render must not restart the read.
  const read = useRef(readJob);
  read.current = readJob;

  useEffect(() => {
    if (!shown || requested.current === target) return;
    let cancelled = false;
    let settled = false;
    requested.current = target;
    setLoad({ kind: "loading" });
    read.current().then(
      (job) => {
        settled = true;
        if (!cancelled) setLoad({ kind: "ready", job });
      },
      () => {
        settled = true;
        if (!cancelled) setLoad({ kind: "failed" });
      },
    );
    return () => {
      cancelled = true;
      // A read cut short before it answered is started again when the tab is next shown.
      if (!settled) requested.current = null;
    };
  }, [shown, target]);

  return (
    <JobDescriptionView
      load={load}
      onRetry={() => setAttempt((value) => value + 1)}
      {...(saveCopy === undefined
        ? {}
        : {
            onSaveCopy: async (text?: string) => {
              const job = await saveCopy(text);
              setLoad({ kind: "ready", job });
            },
          })}
      tabPanel={tabPanel}
    />
  );
}
