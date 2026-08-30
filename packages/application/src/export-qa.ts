import {
  buildRenderingQaReport,
  inspectControlledDocument,
  type OutputFormat,
  type RenderedDocument,
} from "@draft-loop/rendering";
import type { DraftArtifact, RenderingQaReport } from "@draft-loop/schemas";

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

/** Fail closed before an export output is written when bounded QA is missing or fails. */
export function assertExportRenderingQa(
  artifact: DraftArtifact,
  rendered: RenderedDocument,
): RenderingQaReport {
  const report = buildExportRenderingQa(artifact, rendered);
  if (!report.complete || !report.passed) {
    throw new Error(
      `The ${rendered.metadata.format.toUpperCase()} export failed bounded rendering QA; no output was written.`,
    );
  }
  return report;
}
