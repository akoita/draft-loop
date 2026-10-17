import { join, resolve } from "node:path";

import {
  createOrchestrationEngine,
  createStorageRunStore,
  hasCompletedIndependentCritique,
} from "@draft-loop/orchestrator";
import {
  builtInRenderingTemplates,
  extensionForFormat,
  getRenderingTemplate,
  type OutputFormat,
  type PdfPrinter,
  type RenderedDocument,
  type RenderOptions,
  renderArtifact,
  renderedPrintedPdf,
  renderPrintHtml,
} from "@draft-loop/rendering";
import type { DraftArtifact } from "@draft-loop/schemas";
import type { BlobStoragePort, ClosableStoragePort, RunHistoryStorage } from "@draft-loop/storage";

import { CliUserError } from "./cli-user-error.js";
import { exportLengthWarningLine, parseExportFormat } from "./export-document.js";
import {
  assertExportRenderingQa,
  assertPrintedPdfRenderingQa,
  type ExportRenderingQaResult,
  exportTemplateRecord,
} from "./export-qa.js";
import { exactApprovedArtifactFailure } from "./export-readiness.js";
import { exportRecordId } from "./export-record.js";
import type { ApplicationIo } from "./index.js";
import type { WorkspaceConfig } from "./local.js";
import { noopAgents } from "./noop-agents.js";
import { timestamp } from "./response-execution.js";

export interface ExportRunDependencies {
  readonly readWorkspace: (root: string) => Promise<WorkspaceConfig>;
  readonly openStorage: (root: string) => Promise<RunHistoryStorage & ClosableStoragePort>;
  /** Where the rendered document is written, at the export path. */
  readonly exportBlobs: BlobStoragePort;
}

export interface ExportRunOptions {
  /** A built-in rendering template id (#1330); Classic when omitted. */
  readonly templateId?: string | undefined;
  /**
   * Prints a PDF through a browser engine (#1362). The desktop passes one; without it a PDF is
   * drawn by the built-in writer, as the CLI does.
   */
  readonly printPdf?: PdfPrinter | undefined;
}

/** The user-facing error for a template id that is not a built-in template. */
function assertKnownTemplate(templateId: string | undefined): void {
  if (templateId === undefined) return;
  try {
    getRenderingTemplate(templateId);
  } catch {
    const known = Object.keys(builtInRenderingTemplates).join(" or ");
    throw new CliUserError(`Unknown template: ${templateId}. Use ${known}.`);
  }
}

/**
 * Render and check an export. A PDF goes through the printer when there is one; otherwise, and for
 * every other format, the built-in renderer draws it. Either way QA fails closed before any write.
 */
async function renderChecked(
  artifact: DraftArtifact,
  format: OutputFormat,
  renderOptions: RenderOptions,
  printPdf: PdfPrinter | undefined,
): Promise<{ readonly rendered: RenderedDocument; readonly qa: ExportRenderingQaResult }> {
  if (format === "pdf" && printPdf !== undefined) {
    const printed = await printPdf(
      renderPrintHtml(artifact, { templateId: renderOptions.templateId }),
    );
    const rendered = renderedPrintedPdf(artifact, printed.pdf, renderOptions);
    return { rendered, qa: assertPrintedPdfRenderingQa(artifact, rendered, printed) };
  }
  const rendered = renderArtifact(artifact, format, renderOptions);
  return { rendered, qa: assertExportRenderingQa(artifact, rendered) };
}

/**
 * Render an approved run to a local document, record the export, and mark the run exported. The
 * chosen template is recorded on the export, and the length warning measures against its page
 * target; without a template the run's writing-policy target applies.
 */
export async function exportApprovedRun(
  dependencies: ExportRunDependencies,
  rootInput: string,
  runIdInput: string | undefined,
  outputPathInput: string | undefined,
  io: ApplicationIo,
  formatInput: string,
  options: ExportRunOptions = {},
): Promise<string> {
  const root = resolve(rootInput);
  const config = await dependencies.readWorkspace(root);
  const runId = runIdInput ?? config.latestRunId;
  if (runId === undefined) throw new CliUserError("No run is configured. Start a run first.");
  assertKnownTemplate(options.templateId);
  const storage = await dependencies.openStorage(root);
  try {
    const runStore = createStorageRunStore(storage);
    const snapshot = await runStore.loadRun(runId);
    if (snapshot === undefined) throw new CliUserError(`Run ${runId} was not found.`);
    if (snapshot.state !== "approved" && snapshot.state !== "exported") {
      throw new CliUserError("Only an approved run can be exported. Review and approve it first.");
    }
    if (!hasCompletedIndependentCritique(snapshot)) {
      throw new CliUserError("A completed independent critic review is required before export.");
    }
    if (snapshot.artifact === null) throw new CliUserError("The approved run has no artifact.");
    const readinessFailure = exactApprovedArtifactFailure(snapshot);
    if (readinessFailure !== null) throw new CliUserError(readinessFailure);
    const format = parseExportFormat(formatInput);
    if (format === undefined) throw new CliUserError(`Unsupported export format: ${formatInput}.`);
    const outputPath =
      outputPathInput === undefined
        ? join(root, "exports", `${runId}${extensionForFormat(format)}`)
        : resolve(root, outputPathInput);
    const renderOptions: RenderOptions = {
      requiredSections: config.requiredSections,
      ...(config.maxWords === undefined ? {} : { maxWords: config.maxWords }),
      ...(config.maxCharacters === undefined ? {} : { maxCharacters: config.maxCharacters }),
      allowUnbackedClaims: false,
      generatedAt: timestamp(),
      ...(options.templateId === undefined ? {} : { templateId: options.templateId }),
    };
    const { rendered, qa } = await renderChecked(
      snapshot.artifact,
      format,
      renderOptions,
      options.printPdf,
    );
    await dependencies.exportBlobs.put(outputPath, rendered.content);
    const outputChecksum = rendered.metadata.checksum;
    await storage.saveExport({
      id: exportRecordId(runId, outputChecksum, outputPath, rendered.metadata.generatedAt),
      workspaceId: config.id,
      runId,
      artifactId: snapshot.artifact.id,
      format,
      status: "completed",
      outputPath,
      outputChecksum,
      createdAt: rendered.metadata.generatedAt,
      payload: {
        format,
        approved: true,
        artifactVersion: rendered.metadata.artifactVersion,
        ...exportTemplateRecord(rendered),
        mimeType: rendered.mimeType,
        renderingQa: qa.report,
      },
    });
    const transitionEngine = createOrchestrationEngine({ ...noopAgents(), store: runStore });
    await transitionEngine.markExported(runId);
    io.write(
      `Exported approved artifact v${rendered.metadata.artifactVersion} as ${format} to ${outputPath} (sha256 ${outputChecksum})`,
    );
    const lengthWarning = await exportLengthWarningLine(storage, snapshot, qa.pageOverflow, {
      templateId: rendered.metadata.renderingTemplate.id,
      explicit: options.templateId !== undefined,
    });
    if (lengthWarning !== undefined) io.write(lengthWarning);
    return outputPath;
  } finally {
    await storage.close();
  }
}
