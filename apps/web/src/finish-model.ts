import type { ApiInput, ApiSchemas } from "./api-client.js";
import type { RunReview } from "./review-model.js";

export type RunExport = ApiSchemas["RunExport"];
export type ExportFormat =
  ApiInput<"POST /v1/workspaces/{workspaceId}/runs/{runId}/exports">["body"]["format"];

export const exportFormats: readonly { readonly id: ExportFormat; readonly label: string }[] = [
  { id: "docx", label: "Word (DOCX)" },
  { id: "pdf", label: "PDF" },
  { id: "markdown", label: "Markdown" },
];

/** The built-in templates; Modern is the owner's default. */
export const exportTemplates: readonly { readonly id: string; readonly label: string }[] = [
  { id: "modern", label: "Modern" },
  { id: "classic", label: "Classic" },
  { id: "compact", label: "Compact" },
];

export const defaultExportFormat: ExportFormat = "docx";
export const defaultTemplateId = "modern";

/** Whether approving the draft passes open readiness checks, which needs the owner's reason. */
export function approvalNeedsRationale(review: RunReview): boolean {
  const blockers = review.approvalCheck?.blockers.length ?? 0;
  return blockers > 0 || review.readiness?.ready === false;
}

type ApproveBody = ApiInput<"POST /v1/workspaces/{workspaceId}/runs/{runId}/approve">["body"];

/** The approve request, or why it cannot be sent. */
export function approveRequest(
  review: RunReview,
  rationale: string,
): { readonly body: ApproveBody } | { readonly problem: string } {
  const reason = rationale.trim();
  if (approvalNeedsRationale(review) && reason === "")
    return { problem: "Say why you approve the draft with its open checks." };
  return { body: reason === "" ? {} : { readinessOverrideRationale: reason } };
}

/** The export request; Markdown has no layout, so it takes no template. */
export function exportRequestBody(format: ExportFormat, templateId: string) {
  return format === "markdown" ? { format } : { format, templateId };
}

const extensions: Readonly<Record<string, string>> = {
  markdown: "md",
  docx: "docx",
  pdf: "pdf",
};

/** The file name a downloaded export is saved under. */
export function exportFileName(exported: RunExport): string {
  const day = exported.createdAt.slice(0, 10);
  return `cv-${day}-${exported.id}.${extensions[exported.format] ?? "bin"}`;
}

/** Whether the run's draft is approved, so it can be exported. */
export function canExport(review: RunReview): boolean {
  return review.run.state === "approved" || review.run.state === "exported";
}
