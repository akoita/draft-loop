import { type ReactNode, useCallback, useEffect, useState } from "react";

import { type ApiClient, type ApiSchemas, describeError } from "./api-client.js";
import { readDefaultApplication } from "./applications.js";
import type { Brief } from "./brief-model.js";
import { ConsentStep } from "./consent.js";
import { describeActionError } from "./consent-model.js";
import { useRecordId } from "./record-context.js";
import {
  formatUsd,
  type Run,
  runControls,
  runError,
  runPollIntervalMs,
  runStatus,
  shouldPoll,
  startProblem,
  startRunBody,
  usageLimitWait,
} from "./run-model.js";
import { currentBriefId, currentRunId, screenMemory } from "./screen-memory.js";

export interface RunStepProps {
  readonly client: ApiClient;
  readonly brief: Brief | undefined;
  /** The workspace whose author and critic the transmission consent names. */
  readonly workspace?: ApiSchemas["Workspace"];
  /** Called with the run followed, so the review step can open it. */
  readonly onRun: (run: Run | undefined) => void;
  /** Opens the review once the run waits for it. */
  readonly onReview: () => void;
}

type Control = "pause" | "resume" | "stop";

/** Starts a run from the reviewed brief and follows it until it waits for review. */
export function RunStep({ client, brief: shownBrief, workspace, onRun, onReview }: RunStepProps) {
  const workspaceId = useRecordId();
  const [run, setRun] = useState<Run | undefined>(undefined);
  // The Job brief step may not have been opened since the page loaded; read the brief then.
  const [readBrief, setReadBrief] = useState<Brief | undefined>(undefined);
  const brief = shownBrief ?? readBrief;
  const [loaded, setLoaded] = useState(false);
  const [messages, setMessages] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);

  const follow = useCallback(
    (next: Run | undefined) => {
      if (next !== undefined) screenMemory.rememberRun(next.runId);
      setRun(next);
      onRun(next);
    },
    [onRun],
  );

  useEffect(() => {
    let current = true;
    (async () => {
      try {
        const application = await readDefaultApplication(client, workspaceId);
        const remembered = screenMemory.read();
        const runId = currentRunId(application, remembered);
        const briefId = currentBriefId(application, remembered);
        if (briefId !== undefined) {
          const opportunity = await client.call(
            "GET /v1/workspaces/{workspaceId}/opportunities/{briefId}",
            { path: { workspaceId, briefId } },
          );
          if (current) setReadBrief(opportunity.brief);
        }
        const latest =
          runId === undefined
            ? undefined
            : await client.call("GET /v1/workspaces/{workspaceId}/runs/{runId}", {
                path: { workspaceId, runId },
              });
        if (current) follow(latest);
      } catch (error) {
        if (current) setMessages([describeError(error)]);
      } finally {
        if (current) setLoaded(true);
      }
    })();
    return () => {
      current = false;
    };
  }, [client, follow, workspaceId]);

  // Read an active run every few seconds; stop once it waits for review or ends.
  useEffect(() => {
    if (run === undefined || !shouldPoll(run)) return;
    const timer = setTimeout(() => {
      client
        .call("GET /v1/workspaces/{workspaceId}/runs/{runId}", {
          path: { workspaceId, runId: run.runId },
        })
        .then(follow, (error: unknown) => setMessages([describeError(error)]));
    }, runPollIntervalMs);
    return () => clearTimeout(timer);
  }, [client, run, follow, workspaceId]);

  async function act(action: () => Promise<Run>) {
    setBusy(true);
    try {
      follow(await action());
      setMessages([]);
    } catch (error) {
      setMessages([describeActionError(error)]);
    } finally {
      setBusy(false);
    }
  }

  const start = () => {
    const problem = startProblem(brief);
    if (problem !== undefined || brief === undefined) {
      setMessages([problem ?? ""]);
      return;
    }
    void act(() =>
      client.call("POST /v1/workspaces/{workspaceId}/runs", {
        path: { workspaceId },
        header: { "idempotency-key": crypto.randomUUID() },
        body: startRunBody(brief),
      }),
    );
  };

  const control = (which: Control) => {
    if (run === undefined) return;
    const path = { workspaceId, runId: run.runId };
    void act(() => {
      switch (which) {
        case "pause":
          return client.call("POST /v1/workspaces/{workspaceId}/runs/{runId}/pause", { path });
        case "stop":
          return client.call("POST /v1/workspaces/{workspaceId}/runs/{runId}/stop", { path });
        case "resume":
          return client.call("POST /v1/workspaces/{workspaceId}/runs/{runId}/resume", {
            path,
            header: { "idempotency-key": crypto.randomUUID() },
          });
      }
    });
  };

  if (!loaded) return <p role="status">Reading your runs…</p>;
  return (
    <RunPanel
      run={run}
      startProblem={startProblem(brief)}
      messages={messages}
      busy={busy}
      onStart={start}
      onControl={control}
      onReview={onReview}
      consent={<ConsentStep client={client} kind="provider-transmission" workspace={workspace} />}
    />
  );
}

export interface RunPanelProps {
  readonly run: Run | undefined;
  /** Why a new run cannot start yet, if it cannot. */
  readonly startProblem: string | undefined;
  readonly messages: readonly string[];
  readonly busy: boolean;
  readonly onStart: () => void;
  readonly onControl: (control: Control) => void;
  readonly onReview: () => void;
  /** The transmission consent, asked before the first run. */
  readonly consent?: ReactNode;
}

export function RunPanel({
  run,
  startProblem: problem,
  messages,
  busy,
  onStart,
  onControl,
  onReview,
  consent,
}: RunPanelProps) {
  const controls = run === undefined ? undefined : runControls(run);
  const canStartAnother = run === undefined || !shouldPoll(run);
  const wait = run === undefined ? undefined : usageLimitWait(run);
  const error = run === undefined ? undefined : runError(run);

  return (
    <section className="panel">
      <h2>Run</h2>
      {run === undefined ? (
        <p>No run yet. A run drafts your CV for the reviewed brief, then the critic reviews it.</p>
      ) : (
        <>
          <p className="run-status" role="status">
            {runStatus(run)}
          </p>
          <dl className="facts">
            <dt>Round</dt>
            <dd>{run.round}</dd>
            <dt>Findings</dt>
            <dd>{run.findingCount}</dd>
            <dt>Estimated cost</dt>
            <dd>{formatUsd(run.totalCostUsd)}</dd>
            <dt>Model routes</dt>
            <dd>
              {run.routes.length === 0
                ? "No model call yet"
                : run.routes
                    .map((item) =>
                      item.fallback === undefined
                        ? `${item.step}: ${item.route}`
                        : `${item.step}: ${item.route} (fallback from ${item.fallback.from})`,
                    )
                    .join(", ")}
            </dd>
          </dl>
          {wait === undefined ? null : <p className="notice">{wait}</p>}
          {error === undefined ? null : <p className="problem">{error}</p>}
        </>
      )}
      {consent}
      {messages.map((message) => (
        <p key={message} className="problem" role="alert">
          {message}
        </p>
      ))}
      <div className="actions">
        {run?.state === "awaiting-approval" ? (
          <button type="button" onClick={onReview}>
            Review the draft
          </button>
        ) : null}
        {controls?.pause ? (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => onControl("pause")}
          >
            Pause
          </button>
        ) : null}
        {controls?.resume ? (
          <button type="button" disabled={busy} onClick={() => onControl("resume")}>
            Resume
          </button>
        ) : null}
        {controls?.stop ? (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => onControl("stop")}
          >
            Stop for good
          </button>
        ) : null}
        {canStartAnother ? (
          <button
            type="button"
            className={run === undefined ? undefined : "secondary"}
            disabled={busy || problem !== undefined}
            onClick={onStart}
          >
            {run === undefined ? "Start a run" : "Start another run"}
          </button>
        ) : null}
      </div>
      {canStartAnother && problem !== undefined ? <p className="muted">{problem}</p> : null}
    </section>
  );
}
