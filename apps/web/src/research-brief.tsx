import { t } from "@lingui/core/macro";
import { useEffect, useState } from "react";

import type { ApiClient } from "./api-client.js";
import { useRecordId } from "./record-context.js";
import {
  type ResearchBrief,
  type ResearchRunState,
  researchDisclosure,
  researchFindings,
  researchProblem,
  researchStateNote,
  researchSummary,
} from "./research-brief-model.js";

/**
 * Research in the Prepare panel (#2545): the candidate approves one run after reading what it
 * searches, who reads the results and its cap; the panel follows the run, then shows the newest
 * brief's findings with their dated sources, and offers to delete it.
 */

export interface ResearchBriefViewProps {
  /** The application's newest brief, or undefined before the first run. */
  readonly brief: ResearchBrief | undefined;
  readonly state: ResearchRunState | undefined;
  /** True while the approval is on screen. */
  readonly confirming: boolean;
  readonly busy: boolean;
  readonly problem: string | undefined;
  readonly onStart: () => void;
  readonly onApprove: () => void;
  readonly onCancel: () => void;
  readonly onDelete: () => void;
}

export function ResearchBriefView(props: ResearchBriefViewProps) {
  const { brief, state, confirming, busy } = props;
  const pending = state?.status === "pending";
  const note = researchStateNote(state);
  return (
    <section className="research-brief" aria-labelledby="research-heading">
      <h3 id="research-heading">{t`About the employer`}</h3>
      {brief === undefined && !pending ? (
        <p className="application-material-note">{t`Research the employer before you draft: recent, dated facts that a cover letter or interview answer can cite.`}</p>
      ) : null}
      {confirming ? (
        <div className="research-brief-approval">
          <p>{researchDisclosure()}</p>
          <div className="application-material-actions">
            <button
              type="button"
              className="button button-primary"
              disabled={busy}
              onClick={props.onApprove}
            >{t`Approve and research`}</button>
            <button
              type="button"
              className="button button-outline"
              disabled={busy}
              onClick={props.onCancel}
            >{t`Cancel`}</button>
          </div>
        </div>
      ) : (
        <div className="application-material-actions">
          <button
            type="button"
            className="button button-outline"
            disabled={busy || pending}
            onClick={props.onStart}
          >
            {brief === undefined ? t`Research this application` : t`Research again`}
          </button>
        </div>
      )}
      {note === undefined ? null : (
        <p className="application-material-note" role="status">
          {note}
        </p>
      )}
      {props.problem === undefined ? null : <p role="alert">{props.problem}</p>}
      {brief === undefined ? null : (
        <>
          {brief.findings.length === 0 ? (
            <p>{t`The sources said nothing useful about this employer.`}</p>
          ) : (
            <ul className="research-brief-findings">
              {researchFindings(brief).map((finding) => (
                <li key={finding.id}>
                  <p>{finding.text}</p>
                  <ul className="research-brief-sources" aria-label={t`Sources`}>
                    {finding.sources.map((source) => (
                      <li key={source.id}>
                        {source.url === undefined ? (
                          source.title
                        ) : (
                          <a href={source.url} target="_blank" rel="noreferrer noopener">
                            {source.title}
                          </a>
                        )}{" "}
                        <span className="research-brief-date">
                          {source.publishedOn === undefined ? t`undated` : source.publishedOn}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          <p className="application-material-note">{researchSummary(brief)}</p>
          <p className="application-material-note">{t`Web pages can be wrong or out of date. Check a fact at its source before you rely on it.`}</p>
          <div className="application-material-actions">
            <button
              type="button"
              className="button button-outline"
              disabled={busy}
              onClick={props.onDelete}
            >{t`Delete this research`}</button>
          </div>
        </>
      )}
    </section>
  );
}

export interface ResearchBriefSectionProps {
  readonly client: ApiClient;
  readonly applicationId: string;
}

/** How often the panel asks whether a run has ended. */
const researchPollMs = 3_000;

export function ResearchBriefSection({ client, applicationId }: ResearchBriefSectionProps) {
  const workspaceId = useRecordId();
  const path = { workspaceId, applicationId };
  const [brief, setBrief] = useState<ResearchBrief | undefined>(undefined);
  const [state, setState] = useState<ResearchRunState | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const loadNewest = async () => {
    const listed = await client
      .call("GET /v1/workspaces/{workspaceId}/applications/{applicationId}/research-briefs", {
        path,
      })
      .catch(() => undefined);
    setBrief(listed?.briefs[0]);
  };

  // The newest brief and the newest run, once; a server without research answers 404 and the
  // section stays offered, to explain itself on approval.
  // biome-ignore lint/correctness/useExhaustiveDependencies: loads once per application.
  useEffect(() => {
    let current = true;
    void loadNewest();
    client
      .call("GET /v1/workspaces/{workspaceId}/applications/{applicationId}/research", { path })
      .then(
        (run) => {
          if (current) setState(run);
        },
        () => undefined,
      );
    return () => {
      current = false;
    };
  }, [client, workspaceId, applicationId]);

  // A run in progress is polled until it ends; a saved brief then replaces the one on screen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: polls while the run is pending.
  useEffect(() => {
    if (state?.status !== "pending") return;
    let current = true;
    const timer = setTimeout(async () => {
      const run = await client
        .call("GET /v1/workspaces/{workspaceId}/applications/{applicationId}/research", { path })
        .catch(() => undefined);
      if (!current || run === undefined) return;
      if (run.status === "done" && run.outcome === "researched") await loadNewest();
      if (current) setState(run);
    }, researchPollMs);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [client, workspaceId, applicationId, state]);

  return (
    <ResearchBriefView
      brief={brief}
      state={state}
      confirming={confirming}
      busy={busy}
      problem={problem}
      onStart={() => {
        setProblem(undefined);
        setConfirming(true);
      }}
      onCancel={() => setConfirming(false)}
      onApprove={async () => {
        setBusy(true);
        setProblem(undefined);
        try {
          const run = await client.call(
            "POST /v1/workspaces/{workspaceId}/applications/{applicationId}/research",
            { path, body: { approved: true } },
          );
          setState(run);
          setConfirming(false);
        } catch (error) {
          setProblem(researchProblem(error));
        } finally {
          setBusy(false);
        }
      }}
      onDelete={async () => {
        if (brief === undefined) return;
        if (!globalThis.confirm?.(t`Delete this research for good?`)) return;
        setBusy(true);
        setProblem(undefined);
        try {
          await client.call(
            "DELETE /v1/workspaces/{workspaceId}/applications/{applicationId}/research-briefs/{briefId}",
            { path: { ...path, briefId: brief.id } },
          );
          setState(undefined);
          await loadNewest();
        } catch (error) {
          setProblem(researchProblem(error));
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}
