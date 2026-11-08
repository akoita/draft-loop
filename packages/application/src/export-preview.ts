import { CliUserError } from "./cli-user-error.js";
import { renderApprovedRun } from "./export-run.js";
import { readWorkspace } from "./local.js";
import { storageFactory } from "./local-storage-factory.js";
import { assertRunExportable } from "./run-exports.js";

/** What to preview: an approved run, the format and, optionally, the template to draw it with. */
export interface ExportPreviewCommand {
  readonly root: string;
  readonly runId: string;
  readonly format: string;
  readonly templateId?: string | undefined;
}

/** The document an export of the same choices would save, kept nowhere. */
export interface ExportPreview {
  readonly format: "docx" | "markdown" | "pdf";
  readonly mimeType: string;
  readonly content: Uint8Array;
  /** The template the document was drawn with: the chosen one or the run's page-target default. */
  readonly templateId: string;
  /** The page count of a PDF, or null for other formats. */
  readonly pageCount: number | null;
  /** The page count the template aims for. */
  readonly targetPageCount: number;
}

/**
 * Renders an approved run as its export would be, with the same checks and rendering QA, without
 * writing the document, recording an export or changing the run's state (#2497). The hosted
 * service draws PDFs with the built-in writer, as its exports do.
 */
export async function previewRunExport(command: ExportPreviewCommand): Promise<ExportPreview> {
  if (command.runId.length === 0) throw new CliUserError("A preview names its run.");
  await assertRunExportable({ root: command.root, runId: command.runId });
  const { format, rendered, qa } = await renderApprovedRun(
    { readWorkspace, openStorage: (root) => storageFactory().open(root) },
    command.root,
    command.runId,
    command.format,
    { templateId: command.templateId },
  );
  return {
    format,
    mimeType: rendered.mimeType,
    content: rendered.content,
    templateId: rendered.metadata.renderingTemplate.id,
    pageCount: qa.report.deterministicPageCount,
    targetPageCount: qa.report.targetPageCount,
  };
}
