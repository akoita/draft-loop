/**
 * What the screens say when a local model writes the CV (ADR 0011, D16): no local model has passed
 * DraftLoop's quality gate yet, so the run may go ahead but the person should expect more edits. A
 * local reviewer needs no warning, because the checks after each round still apply.
 */
export const localWriterWarning =
  "The writer is a local model. Local models have not passed DraftLoop's quality check yet, so expect the draft to need more edits.";

/** The warning for the writer's company, or `null` when the writer is not a local model. */
export function localWriterWarningFor(authorCompany: string): string | null {
  return authorCompany.trim().toLowerCase() === "local" ? localWriterWarning : null;
}

export function LocalWriterWarning({ authorCompany }: { readonly authorCompany: string }) {
  const warning = localWriterWarningFor(authorCompany);
  return warning === null ? null : (
    <p className="start-confirmation-warning" role="note">
      {warning}
    </p>
  );
}
