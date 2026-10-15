import {
  defaultLayoutProfileId,
  estimateDocumentLength,
  type LengthPageTarget,
  type OutputFormat,
  renderingLayoutProfiles,
} from "@draft-loop/rendering";
import type { DraftArtifact } from "@draft-loop/schemas";

/** Prefix of the io line an export writes when the estimated length clearly exceeds the target. */
export const exportLengthWarningPrefix = "Length warning: ";

/** `md` is accepted as the short spelling of `markdown`; anything unsupported returns undefined. */
export function parseExportFormat(input: string): OutputFormat | undefined {
  const normalized = input.trim().toLowerCase();
  if (normalized === "md") return "markdown";
  return normalized === "markdown" || normalized === "docx" || normalized === "pdf"
    ? normalized
    : undefined;
}

/** The part of storage the page-target lookup needs. */
export interface ContextSnapshotReader {
  getContextSnapshot(id: string): Promise<{ readonly payload: unknown } | undefined>;
}

/**
 * The page target the run's writing policy recorded, or undefined when it set none or the
 * context cannot be read. An export never fails because a length hint is unavailable.
 */
export async function readRunPageTarget(
  storage: ContextSnapshotReader,
  contextSnapshotId: string,
): Promise<LengthPageTarget | undefined> {
  try {
    const record = await storage.getContextSnapshot(contextSnapshotId);
    if (record === undefined) return undefined;
    // The snapshot was schema-validated when it was stored; read only the one field needed.
    const target = (
      record.payload as {
        readonly writingPolicy?: { readonly preferences?: { readonly pageTarget?: unknown } };
      }
    ).writingPolicy?.preferences?.pageTarget;
    return target === "one-page" || target === "two-page" ? target : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The io line an export writes when the estimated length clearly exceeds the writing policy's page
 * target, or undefined when it fits, there is no target, or there is no artifact.
 */
export async function exportLengthWarningLine(
  storage: ContextSnapshotReader,
  snapshot: { readonly contextSnapshotId: string; readonly artifact: DraftArtifact | null },
): Promise<string | undefined> {
  if (snapshot.artifact === null) return undefined;
  const pageTarget = await readRunPageTarget(storage, snapshot.contextSnapshotId);
  const estimate = estimateDocumentLength(
    snapshot.artifact,
    renderingLayoutProfiles[defaultLayoutProfileId],
    { pageTarget },
  );
  return estimate.warning === undefined
    ? undefined
    : `${exportLengthWarningPrefix}${estimate.warning}`;
}
