import {
  buildRenderingQaReport,
  inspectControlledDocument,
  type OutputFormat,
  type RenderedDocument,
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

/** A bounded-QA refusal worded for a person; it names no path and no content. */
export class ExportRenderingQaError extends CliUserError {
  constructor(format: string) {
    super(`The ${format.toUpperCase()} export failed rendering checks; no file was written.`);
    this.name = "ExportRenderingQaError";
  }
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
export function exportRenderingQaDecision(report: RenderingQaReport): ExportRenderingQaResult {
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
  throw new ExportRenderingQaError(report.rendered.format);
}

/**
 * Fail closed before an export output is written when bounded QA is missing or a check other than
 * page fit fails. A PDF that only runs long is returned with its overflow so the export can warn.
 */
export function assertExportRenderingQa(
  artifact: DraftArtifact,
  rendered: RenderedDocument,
): ExportRenderingQaResult {
  return exportRenderingQaDecision(buildExportRenderingQa(artifact, rendered));
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
