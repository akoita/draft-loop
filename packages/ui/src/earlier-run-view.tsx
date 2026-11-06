import { t } from "@lingui/core/macro";
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
      <section className="earlier-run-notice" role="status" aria-label={t`chosen earlier run`}>
        <p>
          <strong>{t`Using this earlier run's draft.`}</strong>{" "}
          {t`Approve and export it here; revisions are made on the latest run.`}
        </p>
        {onBackToLatest === undefined ? null : (
          <button
            className="button button-quiet"
            type="button"
            onClick={onBackToLatest}
          >{t`Open latest run`}</button>
        )}
      </section>
    );
  }
  return (
    <section className="earlier-run-notice" role="status" aria-label={t`earlier run`}>
      <p>
        <strong>{t`Viewing an earlier run.`}</strong> {t`Changes are made on the latest run.`}
      </p>
      {onBackToLatest === undefined ? null : (
        <button
          className="button button-primary"
          type="button"
          onClick={onBackToLatest}
        >{t`Back to latest run`}</button>
      )}
    </section>
  );
}
