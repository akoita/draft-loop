import { randomUUID } from "node:crypto";
import type { SqliteStorage } from "@draft-loop/storage";
import {
  type ApplicationChosenRunRecord,
  maximumChosenRunReasonLength,
} from "@draft-loop/storage/application-store";
import { CliUserError } from "./cli-user-error.js";

/**
 * Keeping the better run's draft: an application can use one of its earlier runs for approval and
 * export instead of its newest. The choice is one row per application, replaced by a later
 * choice, and an audit event names it. Choosing never deletes or changes any run.
 */

/** The run an application uses instead of its newest, with the person's reason when they gave one. */
export type ApplicationChosenRun = ApplicationChosenRunRecord;

export interface ChooseApplicationRunCommand {
  readonly root: string;
  readonly applicationId: string;
  readonly runId: string;
  /** Why this run's draft is the better one, in the person's words; optional. */
  readonly reason?: string;
}

/** The audit event recorded with each choice. */
export const applicationRunChosenEventType = "application.run-chosen";

export { maximumChosenRunReasonLength };

/**
 * The reason as stored: trimmed, null when empty, refused when longer than the bound or holding
 * control characters other than line breaks and tabs.
 */
export function normalizeChosenRunReason(reason: string | undefined): string | null {
  const trimmed = reason?.trim() ?? "";
  if (trimmed === "") return null;
  if (trimmed.length > maximumChosenRunReasonLength) {
    throw new CliUserError(
      `The reason must be at most ${maximumChosenRunReasonLength} characters.`,
    );
  }
  const plain = [...trimmed].every(
    (character) =>
      character === "\n" || character === "\t" || (character >= " " && character !== "\u007f"),
  );
  if (!plain) {
    throw new CliUserError("The reason must be plain text.");
  }
  return trimmed;
}

/** The application's runs and the run snapshot reader the choice checks against. */
export interface ChooseRunContext {
  readonly storage: Pick<SqliteStorage, "applications">;
  readonly workspaceId: string;
  /** The application's own run ids. */
  readonly runIds: readonly string[];
  /** Whether the run has a draft artifact to approve and export. */
  readonly hasArtifact: (runId: string) => Promise<boolean>;
  readonly now: () => string;
}

/**
 * Records that the application uses this run's draft. The run must be one of the application's
 * own runs and have a draft; the reason is optional. Resolves with the recorded choice.
 */
export async function chooseApplicationRun(
  command: ChooseApplicationRunCommand,
  context: ChooseRunContext,
): Promise<ApplicationChosenRun> {
  const reason = normalizeChosenRunReason(command.reason);
  if (!context.runIds.includes(command.runId)) {
    throw new CliUserError("That run does not belong to this application.");
  }
  if (!(await context.hasArtifact(command.runId))) {
    throw new CliUserError("That run has no draft to use yet.");
  }
  const chosen: ApplicationChosenRun = {
    runId: command.runId,
    chosenAt: context.now(),
    reason,
  };
  // The choice and its audit event are written in one transaction.
  await context.storage.applications.setChosenRun(
    context.workspaceId,
    command.applicationId,
    chosen,
    {
      id: `application-run-chosen:${command.applicationId}:${randomUUID()}`,
      workspaceId: context.workspaceId,
      eventType: applicationRunChosenEventType,
      entityType: "application",
      entityId: command.applicationId,
      payload: { applicationId: command.applicationId, runId: command.runId, reason },
      createdAt: chosen.chosenAt,
    },
  );
  return chosen;
}

/** The audit event recorded when a new run clears the choice. */
export const applicationRunChoiceClearedEventType = "application.run-choice-cleared";

/**
 * A started run becomes the application's active run, so it clears any chosen run, with an audit
 * event naming the run that was chosen, in one transaction. Resolves with the cleared choice, or
 * `undefined` when there was none. The event id names the new run, so clearing again for the same
 * run appends nothing.
 */
export async function clearChosenRunForNewRun(
  storage: Pick<SqliteStorage, "applications">,
  workspaceId: string,
  applicationId: string,
  newRunId: string,
  now: () => string,
): Promise<ApplicationChosenRun | undefined> {
  return storage.applications.clearChosenRun(workspaceId, applicationId, (cleared) => ({
    id: `application-run-choice-cleared:${applicationId}:${newRunId}`,
    workspaceId,
    eventType: applicationRunChoiceClearedEventType,
    entityType: "application",
    entityId: applicationId,
    payload: { applicationId, runId: cleared.runId },
    createdAt: now(),
  }));
}

/** The stored choice when its run is still one of the application's runs, otherwise null. */
export function currentChosenRun(
  stored: ApplicationChosenRun | undefined,
  runIds: readonly string[],
): ApplicationChosenRun | null {
  return stored !== undefined && runIds.includes(stored.runId) ? stored : null;
}
