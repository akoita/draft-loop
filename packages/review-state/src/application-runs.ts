import type { ApplicationService, ApplicationView, RunModels } from "@draft-loop/application";

import {
  type ApplicationRunInput,
  type ApplicationRunRowView,
  markChosenRun,
  maximumApplicationRuns,
  meanReadinessScore,
  normalizeApplicationRuns,
  orderApplicationRuns,
} from "@draft-loop/ui/application-run-list";

const maximumModelLength = 200;
/** The most rows and model pairs each cache keeps; the oldest entries go first. */
export const maximumCachedApplicationRuns = 500;

function remember<Value>(cache: Map<string, Value>, key: string, value: Value): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > maximumCachedApplicationRuns) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export type ApplicationRunRowsReader = (
  root: string,
  application: Pick<ApplicationView, "runs"> & {
    readonly chosenRun?: { readonly runId: string } | null;
  },
  latestRunId: string | undefined,
) => Promise<readonly ApplicationRunRowView[] | null>;

/**
 * The review's run list for one application: each run's snapshot and recorded models, newest
 * first and capped at the bridge limit. Runs whose snapshot is gone are left out.
 *
 * Create one reader per host. A review action reloads the list, so a run's row is reused until
 * its summary's `updatedAt` changes, and its models, which never change, are read once.
 */
export function createApplicationRunRowsReader(
  service: Pick<ApplicationService, "status" | "readRunModels">,
): ApplicationRunRowsReader {
  const rows = new Map<string, ApplicationRunInput>();
  const models = new Map<string, RunModels>();

  async function modelsFor(root: string, runId: string): Promise<RunModels | undefined> {
    const key = `${root}:${runId}`;
    const cached = models.get(key);
    if (cached !== undefined) return cached;
    const read = await service.readRunModels?.({ root, runId });
    if (read !== undefined) remember(models, key, read);
    return read;
  }

  async function rowFor(
    root: string,
    runId: string,
    updatedAt: string,
    latest: boolean,
  ): Promise<ApplicationRunInput | undefined> {
    const key = `${root}:${runId}:${updatedAt}`;
    // The latest run may still be moving while its summary's `updatedAt` stands still, since
    // that projection is written only when a run comes back; read it fresh every time.
    const cached = latest ? undefined : rows.get(key);
    if (cached !== undefined) return cached;
    const snapshot = await service.status({ root, runId });
    if (snapshot === undefined) return undefined;
    const runModels = await modelsFor(root, runId);
    const score = meanReadinessScore(snapshot.latestEvaluation?.scoreVector);
    const row: ApplicationRunInput = {
      runId: snapshot.runId,
      startedAt: snapshot.startedAt,
      authorModel: (runModels?.author.modelId ?? "").slice(0, maximumModelLength),
      criticModel: (runModels?.critic.modelId ?? "").slice(0, maximumModelLength),
      ...(runModels?.author.effort === undefined ? {} : { authorEffort: runModels.author.effort }),
      ...(runModels?.critic.effort === undefined ? {} : { criticEffort: runModels.critic.effort }),
      round: snapshot.round,
      state: snapshot.state,
      ...(score === undefined ? {} : { score }),
    };
    if (!latest) remember(rows, key, row);
    return row;
  }

  return async (root, application, latestRunId) => {
    const updatedAt = new Map(application.runs.map((run) => [run.id, run.updatedAt]));
    // Order the summaries first so only the newest runs are read.
    const newest = orderApplicationRuns(
      application.runs.map((run) => ({
        runId: run.id,
        startedAt: run.startedAt,
        authorModel: "",
        criticModel: "",
        round: 0,
        state: run.state,
      })),
      latestRunId,
    ).slice(0, maximumApplicationRuns);
    const read: ApplicationRunInput[] = [];
    for (const summary of newest) {
      const row = await rowFor(
        root,
        summary.runId,
        updatedAt.get(summary.runId) ?? "",
        summary.latest,
      );
      if (row !== undefined) read.push(row);
    }
    return (
      normalizeApplicationRuns(
        markChosenRun(orderApplicationRuns(read, latestRunId), application.chosenRun?.runId),
      ) ?? null
    );
  };
}
