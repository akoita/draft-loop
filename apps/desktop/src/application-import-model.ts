/**
 * Wording for importing another workspace as an application (ADR 0010). Pure, so every state of
 * the Home action is testable without a DOM.
 */
import type { ApplicationImportCounts } from "./application-contract.js";

export type ApplicationImportNotice =
  | { readonly kind: "success"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

/** The host answers a cancelled folder picker with this code; it is not worth an error. */
const cancelledCode = "permission-denied";

export const applicationImportExplanation =
  "Used one workspace per job? Import it as an application with its job, briefs, runs and exports. The other workspace is not changed, and profiles are not merged.";

export const applicationImportFailureFallback =
  "The workspace could not be imported. Try again, or choose a different workspace.";

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function applicationImportCountsText(counts: ApplicationImportCounts): string {
  const parts = [
    plural(counts.runs, "run", "runs"),
    plural(counts.briefVersions, "brief version", "brief versions"),
    plural(counts.exports, "export", "exports"),
  ];
  const text = `Imported ${parts.join(", ")}.`;
  if (counts.skippedExports === 0) return text;
  const skipped =
    counts.skippedExports === 1
      ? "1 export was not imported because its file was missing."
      : `${counts.skippedExports} exports were not imported because their files were missing.`;
  return `${text} ${skipped}`;
}

export function applicationImportSuccessNotice(
  name: string,
  counts: ApplicationImportCounts,
): ApplicationImportNotice {
  return {
    kind: "success",
    message: `Imported "${name}" as an application. ${applicationImportCountsText(counts)}`,
  };
}

/**
 * The notice for a failed import, or `null` when the person only closed the folder picker. The
 * host words refusals ("not a DraftLoop workspace", "already imported") without any path, so they
 * are shown as written; anything else falls back to a fixed sentence.
 */
export function applicationImportErrorNotice(error: unknown): ApplicationImportNotice | null {
  const code = (error as { readonly code?: unknown } | null)?.code;
  if (code === cancelledCode) return null;
  const message = error instanceof Error ? error.message.trim() : "";
  return {
    kind: "error",
    message: message === "" || message.length > 300 ? applicationImportFailureFallback : message,
  };
}
