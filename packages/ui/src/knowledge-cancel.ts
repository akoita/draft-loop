/**
 * The fixed, untranslated message a host's cancelled file picker rejects with. It is a signal
 * between host and screen, never shown, so it stays in English in every screen language: the web
 * host translated it once, and a French screen then showed the cancel as an error.
 */
export const knowledgeFileImportCancelledMessage = "Candidate knowledge file import was cancelled.";

/**
 * A native folder or file dialog that the candidate dismissed reaches the renderer as a
 * `permission-denied` bridge error whose fixed message ends with "was cancelled.". That is a
 * deliberate choice, not a failure, so no error should be shown for it.
 */
export function isKnowledgeOperationCancelled(reason: unknown): boolean {
  if (typeof reason !== "object" || reason === null) return false;
  const { code, message } = reason as { readonly code?: unknown; readonly message?: unknown };
  return (
    code === "permission-denied" &&
    typeof message === "string" &&
    message.startsWith("Candidate knowledge ") &&
    message.endsWith(" was cancelled.")
  );
}
