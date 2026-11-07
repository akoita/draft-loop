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

/**
 * The ending the web host gives text pasted on the Career evidence card (#2417), so the file
 * list can tell it from an uploaded text file whatever its title or the screen's language.
 */
export const pastedSourceSuffix = ".pasted.txt";

/** Whether the file holds text the person pasted on screen rather than a file they uploaded. */
export function isPastedSource(source: Pick<KnowledgeSource, "displayName">): boolean {
  return source.displayName.endsWith(pastedSourceSuffix);
}

/** When the file was added, such as `Uploaded 3 Nov 2026, 14:12`, in the viewer's time zone. */
export function fileAddedLine(
  source: Pick<KnowledgeSource, "displayName" | "createdAt">,
  options: { readonly locale?: string; readonly timeZone?: string } = {},
): string | undefined {
  const when = formatDateTime(source.createdAt, options);
  if (when === undefined) return undefined;
  if (isInterviewSource(source)) return t`Created ${when}`;
  return isPastedSource(source) ? t`Added ${when}` : t`Uploaded ${when}`;
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
