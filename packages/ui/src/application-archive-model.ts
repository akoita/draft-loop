/**
 * Wording and rules for archiving, restoring and deleting applications on Home. Pure, so every
 * state of the card actions is testable without a DOM.
 */
import type { ApplicationSummaryView } from "./application-contract.js";
import type { ApplicationImportNotice } from "./application-import-model.js";

export type ApplicationAction = "archive" | "restore" | "delete";

/** Same shape as the import notice, so Home shows both the same way. */
export type ApplicationActionNotice = ApplicationImportNotice;

export const applicationDeleteExplanation =
  "Only applications without runs, briefs or exports can be deleted. Archiving keeps everything and can be undone.";

const failureFallbacks: Readonly<Record<ApplicationAction, string>> = {
  archive: "The application could not be archived. Try again.",
  restore: "The application could not be restored. Try again.",
  delete: "The application could not be deleted. Try again, or archive it instead.",
};

/**
 * Only a created application that holds nothing can be deleted. The default application is the
 * workspace's own job, and runs and briefs are kept as history, so those are archived instead.
 */
export function canDeleteApplication(application: ApplicationSummaryView): boolean {
  return (
    !application.isDefault &&
    application.runCount === 0 &&
    application.briefCount === 0 &&
    application.exportCount === 0
  );
}

export function partitionApplications(applications: readonly ApplicationSummaryView[]): {
  readonly active: readonly ApplicationSummaryView[];
  readonly archived: readonly ApplicationSummaryView[];
} {
  return {
    active: applications.filter((application) => application.archivedAt === null),
    archived: applications.filter((application) => application.archivedAt !== null),
  };
}

export function applicationDeleteConfirmation(name: string): string {
  return `Delete "${name}"? This cannot be undone.`;
}

export function applicationActionSuccessNotice(
  name: string,
  action: ApplicationAction,
): ApplicationActionNotice {
  const message =
    action === "archive"
      ? `Archived "${name}". Show archived applications to restore it.`
      : action === "restore"
        ? `Restored "${name}".`
        : `Deleted "${name}".`;
  return { kind: "success", message };
}

/**
 * The host words refusals ("can only be archived", "was not found") without any path, so they are
 * shown as written; anything else falls back to a fixed sentence.
 */
export function applicationActionErrorNotice(
  error: unknown,
  action: ApplicationAction,
): ApplicationActionNotice {
  const message = error instanceof Error ? error.message.trim() : "";
  return {
    kind: "error",
    message: message === "" || message.length > 300 ? failureFallbacks[action] : message,
  };
}
