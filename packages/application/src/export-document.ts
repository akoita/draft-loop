import {
  estimateDocumentLength,
  getRenderingTemplate,
  type LengthPageTarget,
  type OutputFormat,
  profileFromTemplate,
} from "@draft-loop/rendering";
import type { DraftArtifact } from "@draft-loop/schemas";
import { cvHeaderPlaceholderSpans } from "@draft-loop/validation";

import type { ExportPageOverflow } from "./export-qa.js";

/** Prefix of the io line an export writes when the estimated length clearly exceeds the target. */
export const exportLengthWarningPrefix = "Length warning: ";

/**
 * The io line an export writes when the CV header still shows placeholders such as `[Your name]`
 * (#1878); undefined when it shows none. Review edits do not reach the exported file, so the
 * person fills the placeholders in the document itself.
 */
export function exportPlaceholderWarningLine(
  artifact: Pick<DraftArtifact, "sections">,
): string | undefined {
  const placeholders = new Set<string>();
  for (const section of artifact.sections) {
    if (section.kind !== "header") continue;
    for (const { text } of section.blocks) {
      for (const { start, end } of cvHeaderPlaceholderSpans(text))
        placeholders.add(text.slice(start, end));
    }
  }
  if (placeholders.size === 0) return undefined;
  return `Header warning: the CV header still shows ${[...placeholders].join(", ")}; replace ${placeholders.size === 1 ? "it" : "them"} with your details in the exported document before sending it.`;
}

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

/** The template an export uses when none is named (#1364): Compact for a one-page run, else Modern. */
export function defaultExportTemplateId(pageTarget: LengthPageTarget | undefined): string {
  return pageTarget === "one-page" ? "compact" : "modern";
}

/** The warning for a PDF that rendered past its page target, using the real page count. */
export function pageOverflowWarningLine(overflow: ExportPageOverflow): string {
  const { pageCount, targetPageCount, layoutName } = overflow;
  const pages = (count: number): string => `${count} page${count === 1 ? "" : "s"}`;
  return `${exportLengthWarningPrefix}The PDF runs to ${pages(pageCount)}; the ${layoutName} layout targets ${pages(targetPageCount)}.`;
}

/** The template an export was drawn with, and whether the person chose it. */
export interface ExportLengthTemplate {
  readonly templateId: string;
  /** True when the export named the template, so its page target replaces the policy's. */
  readonly explicit: boolean;
}

/**
 * The io line an export writes when the estimated length clearly exceeds the page target, or
 * undefined when it fits, there is no target, or there is no artifact. The estimate measures the
 * template's layout; the target is the chosen template's, otherwise the writing policy's. A PDF
 * that rendered past its page target gets the real page-count line instead, never both.
 */
export async function exportLengthWarningLine(
  storage: ContextSnapshotReader,
  snapshot: { readonly contextSnapshotId: string; readonly artifact: DraftArtifact | null },
  pageOverflow?: ExportPageOverflow,
  template: ExportLengthTemplate = { templateId: "modern", explicit: false },
): Promise<string | undefined> {
  if (pageOverflow !== undefined) return pageOverflowWarningLine(pageOverflow);
  if (snapshot.artifact === null) return undefined;
  const rendering = getRenderingTemplate(template.templateId);
  const pageTarget: LengthPageTarget | undefined = template.explicit
    ? rendering.page.targetPages === 1
      ? "one-page"
      : "two-page"
    : await readRunPageTarget(storage, snapshot.contextSnapshotId);
  const estimate = estimateDocumentLength(snapshot.artifact, profileFromTemplate(rendering), {
    pageTarget,
    ...(template.explicit ? { targetSource: `of the ${rendering.displayName} template` } : {}),
  });
  return estimate.warning === undefined
    ? undefined
    : `${exportLengthWarningPrefix}${estimate.warning}`;
}
