/**
 * The **Steps** section of Run details (#2693): what the server executed for the run, read from
 * its trace. It is folded by default and absent for a run with no trace, a host that records none
 * or a trace that cannot be read: the run's review never depends on it.
 */
import { plural, t } from "@lingui/core/macro";
import { type JSX, useEffect, useState } from "react";
import { formatElapsedDuration } from "./elapsed-duration.js";
import { formatDateTime } from "./locale-format.js";
import { modelDisplayName } from "./model-profile-presentation.js";
import {
  type RunStepAdvance,
  type RunStepAttempt,
  type RunStepKind,
  runStepAdvances,
  runStepsEstimatedUsd,
} from "./run-steps-model.js";
import type { RunTraceSpanView } from "./run-trace-contract.js";

/** Reads one run's spans; Run details passes it only on a host that records traces. */
export type LoadRunTrace = (runId: string) => Promise<readonly RunTraceSpanView[]>;

function stepLabel(step: RunStepKind | null): string {
  switch (step) {
    case "author":
      return t`Author`;
    case "critic":
      return t`Critic`;
    case "revision":
      return t`Revision`;
    default:
      return t`Step`;
  }
}

/** An estimated cost: cents above one cent, a tenth of a cent below it. */
export function formatEstimatedUsd(usd: number): string {
  return usd > 0 && usd < 0.01 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`;
}

function AttemptRow({ entry }: { readonly entry: RunStepAttempt }): JSX.Element {
  const attemptNumber = entry.attempt ?? 1;
  return (
    <li className={entry.failed ? "run-step run-step-failed" : "run-step"}>
      <strong>{stepLabel(entry.step)}</strong>
      {entry.round === null ? null : <span>{t`round ${entry.round}`}</span>}
      {attemptNumber > 1 ? <span>{t`attempt ${attemptNumber}`}</span> : null}
      {entry.model === null ? null : <span>{modelDisplayName(entry.model)}</span>}
      <span className="numeric">
        {entry.durationMs === null ? t`not finished` : formatElapsedDuration(entry.durationMs)}
      </span>
      {entry.estimatedUsd === null ? null : (
        <span className="numeric">{t`about ${formatEstimatedUsd(entry.estimatedUsd)}`}</span>
      )}
      {entry.failed ? (
        <span className="run-step-error">
          {entry.errorType === null ? t`Failed` : t`Failed: ${entry.errorType}`}
        </span>
      ) : null}
    </li>
  );
}

/** The folded list itself; nothing for a trace with no model call. */
export function RunStepsList({
  advances,
}: {
  readonly advances: readonly RunStepAdvance[];
}): JSX.Element | null {
  if (advances.length === 0) return null;
  const attemptCount = advances.reduce((sum, advance) => sum + advance.attempts.length, 0);
  const total = runStepsEstimatedUsd(advances);
  const failed = advances.some((advance) => advance.failed);
  return (
    <details className="run-steps">
      <summary>
        <span className="run-steps-title">{t`Steps`}</span>{" "}
        <span className="run-steps-summary">
          {plural(attemptCount, { one: "# model call", other: "# model calls" })}
          {total === null ? null : ` · ${t`about ${formatEstimatedUsd(total)}`}`}
          {failed ? ` · ${t`one or more failed`}` : null}
        </span>
      </summary>
      <p className="setup-note">{t`What the server ran for this run. Costs are estimates. No draft or career material is recorded here.`}</p>
      <ol className="run-steps-advances">
        {advances.map((advance) => (
          <li key={advance.spanId}>
            <p className="run-steps-advance">
              <time dateTime={advance.startedAt}>
                {formatDateTime(advance.startedAt) ?? advance.startedAt}
              </time>
              {advance.durationMs === null ? null : (
                <span className="numeric"> · {formatElapsedDuration(advance.durationMs)}</span>
              )}
            </p>
            <ul>
              {advance.attempts.map((entry) => (
                <AttemptRow key={entry.spanId} entry={entry} />
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </details>
  );
}

/**
 * Loads the run's trace while Run details is open and shows its steps. A read that fails shows
 * nothing: the trace is extra detail, and the drawer's other facts stand without it.
 */
export function RunSteps({
  runId,
  active,
  load,
}: {
  readonly runId: string;
  /** True while the drawer is open on a run that is not executing. */
  readonly active: boolean;
  readonly load: LoadRunTrace;
}): JSX.Element | null {
  const [loaded, setLoaded] = useState<{
    readonly runId: string;
    readonly advances: readonly RunStepAdvance[];
  } | null>(null);
  useEffect(() => {
    if (!active) return;
    let current = true;
    load(runId).then(
      (spans) => {
        if (current) setLoaded({ runId, advances: runStepAdvances(spans) });
      },
      () => {
        if (current) setLoaded(null);
      },
    );
    return () => {
      current = false;
    };
  }, [active, runId, load]);
  if (loaded === null || loaded.runId !== runId) return null;
  return <RunStepsList advances={loaded.advances} />;
}
