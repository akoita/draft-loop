import { formatDateTime } from "@draft-loop/ui/locale-format";
import { t } from "@lingui/core/macro";

import type { ApiClient, ApiSchemas } from "./api-client.js";
import type { ScreeningStatus } from "./screening-model.js";

type KnowledgeSource = ApiSchemas["KnowledgeSource"];

/** The name the career interview gives each topic's evidence file. */
const interviewSourceName = /^career-interview-.+-\d+\.md$/u;

/** Whether the file was written by the career interview rather than uploaded. */
export function isInterviewSource(source: Pick<KnowledgeSource, "displayName">): boolean {
  return interviewSourceName.test(source.displayName);
}

/** When the file was added, such as `Uploaded 3 Nov 2026, 14:12`, in the viewer's time zone. */
export function fileAddedLine(
  source: Pick<KnowledgeSource, "displayName" | "createdAt">,
  options: { readonly locale?: string; readonly timeZone?: string } = {},
): string | undefined {
  const when = formatDateTime(source.createdAt, options);
  if (when === undefined) return undefined;
  return isInterviewSource(source) ? t`Created ${when}` : t`Uploaded ${when}`;
}

/**
 * Whether the screen offers the file's download: always to owners and admins, who may inspect a
 * quarantined file before releasing it, and otherwise only while it is not quarantined. The API
 * enforces the same rule.
 */
export function downloadOffered(status: ScreeningStatus | undefined, canRelease: boolean): boolean {
  return canRelease || status?.quarantined !== true;
}

/** Reads the file's stored bytes for the person to save. */
export async function downloadSourceFile(
  client: ApiClient,
  source: Pick<KnowledgeSource, "knowledgeBaseId" | "id">,
): Promise<Blob> {
  return client.call("GET /v1/knowledge-bases/{knowledgeBaseId}/sources/{sourceId}/file", {
    path: { knowledgeBaseId: source.knowledgeBaseId, sourceId: source.id },
  });
}
