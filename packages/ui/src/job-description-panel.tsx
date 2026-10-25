/**
 * The Job tab of the review's work area: the job description the draft is written for, read-only.
 *
 * Once a run exists the job inputs are gone from the screen, so this is where the reviewer reads
 * the job beside the draft. The text is asked for the first time the tab is shown, and again when
 * the reviewer moves to another run, never while the tab stays hidden.
 */

import { type JSX, useEffect, useRef, useState } from "react";
import type { ApplicationJobResult } from "./application-job-contract.js";
import type { ReviewWorkPanelProps } from "./review-work-tabs.js";

type JobLoad =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly job: ApplicationJobResult };

/** Where the text on screen came from, in one line; null when there is nothing to attribute. */
export function jobOriginNote(job: ApplicationJobResult): string | null {
  switch (job.origin) {
    case "workspace-file":
      return "From the workspace's job file.";
    case "pasted-text":
      return "The text pasted when this application was created.";
    case "local-file":
      return "From the file chosen for this application, as it reads now.";
    case "url":
      return "From the job page approved for this application. Only the requirements extracted from it are kept, not the page text; the Coverage tab lists them.";
    case "unavailable":
      return null;
  }
}

export function JobDescriptionView({
  load,
  onRetry,
  tabPanel = null,
}: {
  readonly load: JobLoad;
  readonly onRetry: () => void;
  readonly tabPanel?: ReviewWorkPanelProps | null;
}): JSX.Element {
  return (
    <section className="panel job-panel" aria-label="job description" {...tabPanel}>
      <div className="section-heading compact">
        <div>
          <h2>Job description</h2>
          {load.kind === "ready" && jobOriginNote(load.job) !== null ? (
            <p className="job-origin-note">{jobOriginNote(load.job)}</p>
          ) : null}
        </div>
      </div>
      {load.kind === "loading" ? (
        <p className="job-status" role="status">
          Reading the job description…
        </p>
      ) : load.kind === "failed" ? (
        <p className="job-status" role="alert">
          The job description could not be read.{" "}
          <button className="button button-outline" type="button" onClick={onRetry}>
            Try again
          </button>
        </p>
      ) : load.job.origin === "unavailable" ? (
        <p className="job-status">
          This application's job description could not be read. Its file may have been moved or
          emptied.
        </p>
      ) : load.job.origin === "url" ? (
        <p className="job-url">{load.job.url}</p>
      ) : (
        <>
          <div className="job-text">{load.job.text}</div>
          {load.job.truncated ? (
            <p className="job-status">The job description is longer than shown here.</p>
          ) : null}
        </>
      )}
    </section>
  );
}

export function JobDescriptionPanel({
  readJob,
  reloadKey,
  tabPanel,
}: {
  readonly readJob: () => Promise<ApplicationJobResult>;
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
      tabPanel={tabPanel}
    />
  );
}
