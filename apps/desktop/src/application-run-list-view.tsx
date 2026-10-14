import type { ApplicationRunRowView } from "./application-run-list.js";

/** The start time as a fixed UTC minute, so every reader sees the same order. */
export function runStartedLabel(startedAt: string): string {
  const time = Date.parse(startedAt);
  if (Number.isNaN(time)) return startedAt;
  return `${new Date(time).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function RunRow({ run }: { readonly run: ApplicationRunRowView }) {
  const models =
    run.authorModel === "" && run.criticModel === ""
      ? "models not recorded"
      : `${run.authorModel || "unknown"} → ${run.criticModel || "unknown"}`;
  return (
    <>
      <time dateTime={run.startedAt}>{runStartedLabel(run.startedAt)}</time>
      <span className="application-run-models">{models}</span>
      <span>round {run.round}</span>
      <span className="application-run-state">{run.state.replaceAll("-", " ")}</span>
      {run.score === undefined ? null : (
        <span className="numeric" title="Mean of the latest evaluation's readiness dimensions">
          mean score {run.score.toFixed(2)}
        </span>
      )}
      {run.latest ? <span className="application-run-latest">latest</span> : null}
    </>
  );
}

/**
 * The reviewed application's runs, newest first, read-only. One run reads as a single line;
 * nothing renders outside an application.
 */
export function ApplicationRunList({
  runs,
}: {
  readonly runs: readonly ApplicationRunRowView[] | null | undefined;
}) {
  if (runs === undefined || runs === null || runs.length === 0) return null;
  const [only] = runs;
  if (runs.length === 1 && only !== undefined) {
    return (
      <section className="panel application-runs" aria-label="application runs">
        <p className="application-run-row">
          <span className="label">Runs (1)</span>
          <RunRow run={only} />
        </p>
      </section>
    );
  }
  return (
    <section className="panel application-runs" aria-label="application runs">
      <h2>Runs ({runs.length})</h2>
      <ol className="application-run-list">
        {runs.map((run) => (
          <li
            key={run.runId}
            className="application-run-row"
            aria-current={run.latest ? "true" : undefined}
          >
            <RunRow run={run} />
          </li>
        ))}
      </ol>
    </section>
  );
}
