import {
  buildRenderingQaReport,
  inspectControlledDocument,
  type OutputFormat,
  type PrintedPdf,
  pdfPageCount,
  pdfUndrawableCharacters,
  type RenderedDocument,
  renderMarkdown,
  visibleContentSummary,
} from "@draft-loop/rendering";
import type { DraftArtifact, RenderingQaReport } from "@draft-loop/schemas";

import { CliUserError } from "./cli-user-error.js";

/**
 * Build the content-free QA record for a rendered export. PDF and DOCX use the
 * bounded byte inspector; DOCX retains its explicit OOXML visual-layout limit.
 */
export function buildExportRenderingQa(
  artifact: DraftArtifact,
  rendered: RenderedDocument,
): RenderingQaReport {
  const format = rendered.metadata.format as OutputFormat;
  return buildRenderingQaReport({
    artifact,
    rendered,
    createdAt: rendered.metadata.generatedAt,
    ...(format === "markdown" ? {} : { viewerObservation: inspectControlledDocument(rendered) }),
  });
}

/** What a refusal knows about its cause: check names and code points, never content. */
export interface ExportRenderingQaFailure {
  /** The failed checks, as `failedRenderingQaChecks` names them. */
  readonly failedChecks?: readonly string[];
  /** Characters the PDF cannot draw, as `U+XXXX` code points. */
  readonly undrawableCharacters?: readonly string[];
}

/**
 * A bounded-QA refusal worded for a person; it names no path and no content. It carries the
 * failed checks for the host's log, and names the characters a PDF cannot draw, the one cause a
 * person can act on (#1828).
 */
export class ExportRenderingQaError extends CliUserError {
  readonly format: string;
  readonly failedChecks: readonly string[];
  readonly undrawableCharacters: readonly string[];

  constructor(format: string, failure: ExportRenderingQaFailure = {}) {
    const undrawable = failure.undrawableCharacters ?? [];
    super(
      `The ${format.toUpperCase()} export failed rendering checks; no file was written.${
        undrawable.length === 0
          ? ""
          : ` The PDF cannot draw these characters: ${undrawable.join(", ")}.`
      }`,
    );
    this.name = "ExportRenderingQaError";
    this.format = format;
    this.failedChecks = failure.failedChecks ?? [];
    this.undrawableCharacters = undrawable;
  }
}

/**
 * The names of the checks a QA report failed, for a log line: which comparison missed, never the
 * text compared. An empty list means the report passed.
 */
export function failedRenderingQaChecks(report: RenderingQaReport): readonly string[] {
  if (report.passed) return [];
  const integrity = report.contentIntegrity;
  const observation = report.viewerObservation;
  const failed: string[] = [];
  if (!report.complete) failed.push("viewer-observation-missing");
  if (!integrity.visibleContentMatches) failed.push("visible-content");
  if (!integrity.sectionOrderMatches) failed.push("section-order");
  if (!integrity.blockOrderMatches) failed.push("block-order");
  if (report.activeContent.detected) failed.push("active-content");
  if (
    report.rendered.format === "pdf" &&
    (report.deterministicPageCount === null ||
      report.deterministicPageCount > report.targetPageCount)
  ) {
    failed.push("page-target");
  }
  if (observation !== null) {
    if (observation.renderedChecksum !== report.rendered.checksum) {
      failed.push("viewer-document-checksum");
    }
    if (
      observation.recoveredVisibleContentChecksum !== integrity.expectedVisibleContentChecksum ||
      observation.recoveredVisibleContentCount !== integrity.expectedVisibleContentCount
    ) {
      failed.push("viewer-visible-content");
    }
    if (observation.recoveredVisibleContentOrder !== "preserved") failed.push("viewer-order");
    if (observation.blankPageNumbers.length > 0) failed.push("blank-pages");
    if (observation.overflowPageNumbers.length > 0) failed.push("overflow-pages");
    if (observation.orphanSectionIds.length > 0) failed.push("orphan-sections");
    if (observation.clippedText) failed.push("clipped-text");
  }
  return failed.length === 0 ? ["unnamed"] : failed;
}

/** A PDF whose only failed check is page fit: it ran past the layout profile's page target. */
export interface ExportPageOverflow {
  readonly pageCount: number;
  readonly targetPageCount: number;
  /** The layout profile's short name, such as `standard` or `compact`. */
  readonly layoutName: string;
}

export interface ExportRenderingQaResult {
  readonly report: RenderingQaReport;
  /** Set when the report is not `passed` only because a PDF ran past its page target. */
  readonly pageOverflow?: ExportPageOverflow;
}

function contentChecksFailed(report: RenderingQaReport): boolean {
  const integrity = report.contentIntegrity;
  const observation = report.viewerObservation;
  if (
    !report.complete ||
    !integrity.visibleContentMatches ||
    !integrity.sectionOrderMatches ||
    !integrity.blockOrderMatches ||
    !integrity.duplicateContentPreserved ||
    !integrity.punctuationPreserved ||
    integrity.expectedVisibleContentChecksum !== integrity.recoveredVisibleContentChecksum ||
    integrity.expectedVisibleContentCount !== integrity.recoveredVisibleContentCount ||
    report.activeContent.detected
  ) {
    return true;
  }
  if (observation === null) return report.rendered.format !== "markdown";
  return (
    observation.renderedChecksum !== report.rendered.checksum ||
    observation.recoveredVisibleContentChecksum !== integrity.expectedVisibleContentChecksum ||
    observation.recoveredVisibleContentCount !== integrity.expectedVisibleContentCount ||
    observation.recoveredVisibleContentOrder !== "preserved" ||
    observation.blankPageNumbers.length > 0 ||
    observation.orphanSectionIds.length > 0 ||
    observation.clippedText
  );
}

/**
 * Decide whether a QA report allows an export. A report that did not pass still allows a PDF whose
 * only miss is page fit, derived from the report alone; any other miss throws.
 */
export function exportRenderingQaDecision(
  report: RenderingQaReport,
  failure: Pick<ExportRenderingQaFailure, "undrawableCharacters"> = {},
): ExportRenderingQaResult {
  if (report.passed) return { report };
  const pageCount = report.deterministicPageCount;
  if (
    !contentChecksFailed(report) &&
    report.rendered.format === "pdf" &&
    pageCount !== null &&
    pageCount > report.targetPageCount
  ) {
    return {
      report,
      pageOverflow: {
        pageCount,
        targetPageCount: report.targetPageCount,
        layoutName: report.rendered.layoutProfile.split("-")[0] ?? "standard",
      },
    };
  }
  throw new ExportRenderingQaError(report.rendered.format, {
    failedChecks: failedRenderingQaChecks(report),
    ...failure,
  });
}

/**
 * Fail closed before an export output is written when bounded QA is missing or a check other than
 * page fit fails. A PDF that only runs long is returned with its overflow so the export can warn.
 */
export function assertExportRenderingQa(
  artifact: DraftArtifact,
  rendered: RenderedDocument,
): ExportRenderingQaResult {
  const report = buildExportRenderingQa(artifact, rendered);
  // Only the built-in PDF writer has a fixed character set; a printed PDF draws what its fonts do.
  if (report.passed || rendered.metadata.format !== "pdf") return exportRenderingQaDecision(report);
  return exportRenderingQaDecision(report, {
    undrawableCharacters: pdfUndrawableCharacters(renderMarkdown(artifact)),
  });
}

/**
 * The template record of an export: the renderer version and the rendering template (id and version)
 * the document was drawn with. The QA report stays template-agnostic, so the export payload holds it.
 */
export function exportTemplateRecord(rendered: RenderedDocument) {
  return {
    templateVersion: rendered.metadata.templateVersion,
    renderingTemplate: rendered.metadata.renderingTemplate,
  };
}

/**
 * The QA record of a PDF a browser engine printed from print HTML (#1362). The engine's report of
 * the text it drew stands in for reading text back from the bytes, and is also the independent
 * viewer observation; the page count comes from the printed PDF itself. The browser flows text
 * rather than placing it, so it reports no clipped or overflowing lines.
 */
export function buildPrintedPdfRenderingQa(
  artifact: DraftArtifact,
  rendered: RenderedDocument,
  printed: PrintedPdf,
): RenderingQaReport {
  const pageCount = pdfPageCount(rendered.content);
  if (pageCount === null) {
    throw new ExportRenderingQaError("pdf", { failedChecks: ["page-count-unreadable"] });
  }
  const summary = visibleContentSummary(printed.units);
  return buildRenderingQaReport({
    artifact,
    rendered,
    createdAt: rendered.metadata.generatedAt,
    printedUnits: printed.units,
    viewerObservation: {
      renderedChecksum: rendered.metadata.checksum,
      viewerName: printed.viewerName,
      viewerVersion: printed.viewerVersion,
      recoveredVisibleContentChecksum: summary.checksum,
      recoveredVisibleContentCount: summary.count,
      recoveredVisibleContentOrder: "preserved",
      pageCount,
      blankPageNumbers: [],
      overflowPageNumbers: [],
      orphanSectionIds: [],
      clippedText: false,
    },
  });
}

/** `assertExportRenderingQa` for a printed PDF: fails closed on anything but running long. */
export function assertPrintedPdfRenderingQa(
  artifact: DraftArtifact,
  rendered: RenderedDocument,
  printed: PrintedPdf,
): ExportRenderingQaResult {
  return exportRenderingQaDecision(buildPrintedPdfRenderingQa(artifact, rendered, printed));
}
