import type { ApplicationChosenRunView } from "./application-contract.js";

/** The run fields the ordering reads; every host's application record carries them. */
interface ApplicationRunTiming {
  readonly id: string;
  readonly startedAt: string;
}

/** The newest run, which the review opens on; null before the first run. */
export function newestApplicationRunId(runs: readonly ApplicationRunTiming[]): string | null {
  let newest: ApplicationRunTiming | undefined;
  for (const run of runs) {
    if (newest === undefined || Date.parse(run.startedAt) >= Date.parse(newest.startedAt)) {
      newest = run;
    }
  }
  return newest?.id ?? null;
}

/**
 * The chosen run with its number among the application's runs, oldest = 1, as the run switcher
 * numbers them; undefined when the application uses its newest run.
 */
export function chosenApplicationRun(
  runs: readonly ApplicationRunTiming[],
  chosenRunId: string | null | undefined,
): ApplicationChosenRunView | undefined {
  if (chosenRunId === null || chosenRunId === undefined) return undefined;
  const oldestFirst = [...runs].sort((left, right) => {
    const byTime = Date.parse(left.startedAt) - Date.parse(right.startedAt);
    if (byTime !== 0 && !Number.isNaN(byTime)) return byTime;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
  const index = oldestFirst.findIndex((run) => run.id === chosenRunId);
  return index < 0 ? undefined : { runId: chosenRunId, runNumber: index + 1 };
}
