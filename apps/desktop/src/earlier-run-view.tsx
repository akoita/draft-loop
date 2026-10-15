import type { EarlierRunView } from "./earlier-run.js";

/**
 * Says the review shows an earlier run, read-only, and leads back to the latest run. Nothing
 * renders for the latest run.
 */
export function EarlierRunNotice({
  earlierRun,
  onBackToLatest,
}: {
  readonly earlierRun: EarlierRunView | null | undefined;
  readonly onBackToLatest?: (() => void) | undefined;
}) {
  if (earlierRun === undefined || earlierRun === null) return null;
  if (earlierRun.chosen === true) {
    return (
      <section className="earlier-run-notice" role="status" aria-label="chosen earlier run">
        <p>
          <strong>Using this earlier run's draft.</strong> Approve and export it here; revisions are
          made on the latest run.
        </p>
        {onBackToLatest === undefined ? null : (
          <button className="button button-quiet" type="button" onClick={onBackToLatest}>
            Open latest run
          </button>
        )}
      </section>
    );
  }
  return (
    <section className="earlier-run-notice" role="status" aria-label="earlier run">
      <p>
        <strong>Viewing an earlier run.</strong> Changes are made on the latest run.
      </p>
      {onBackToLatest === undefined ? null : (
        <button className="button button-primary" type="button" onClick={onBackToLatest}>
          Back to latest run
        </button>
      )}
    </section>
  );
}
