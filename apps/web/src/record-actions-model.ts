import { t } from "@lingui/core/macro";
import { type ApiInput, ApiRequestError, type ApiSchemas, describeError } from "./api-client.js";
import { canManageMembers } from "./records-model.js";

type Me = ApiSchemas["Me"];

/**
 * Whether the caller exports and deletes records: the owner token, and an organisation's owners
 * and admins, the same people who assign members (ADR 0011, D7).
 */
export function canExportAndDelete(me: Me): boolean {
  return canManageMembers(me);
}

/** The request that downloads a record's complete archive, which tests and operators read. */
export function archiveRequest(
  workspaceId: string,
): ApiInput<"GET /v1/workspaces/{workspaceId}/archive"> {
  return { path: { workspaceId } };
}

/** The request that downloads a readable copy of a record (#3036). */
export function exportRequest(
  workspaceId: string,
): ApiInput<"GET /v1/workspaces/{workspaceId}/export"> {
  return { path: { workspaceId } };
}

/** The file a downloaded copy is saved under, as the API names it. */
export const exportFileName = "draftloop-data.zip";

/** The word a person types to confirm a deletion, in their language; never an internal id. */
export function deleteConfirmWord(): string {
  return t`DELETE`;
}

/**
 * The request that deletes a record, once the person typed the confirm word; otherwise what to tell
 * them. The API's own `confirm` stays the record's id, which the screen fills in itself.
 */
export function deleteRecordRequest(
  workspaceId: string,
  typed: string,
):
  | { readonly request: ApiInput<"DELETE /v1/workspaces/{workspaceId}"> }
  | { readonly problem: string } {
  const word = deleteConfirmWord();
  if (typed.trim().toLocaleUpperCase() !== word.toLocaleUpperCase())
    return { problem: t`Type ${word} to confirm.` };
  return { request: { path: { workspaceId }, body: { confirm: workspaceId } } };
}

/** What to say when the API refuses a deletion; a running record needs its run stopped first. */
export function deleteRefusal(error: unknown): string {
  if (error instanceof ApiRequestError && error.code === "run_active")
    return t`Stop the run first. A run in this job search is queued or running: pause it or stop it for good in its review, then try again.`;
  return describeError(error);
}

/** The list without a record the caller just deleted. */
export function withoutRecord(ids: readonly string[], recordId: string): string[] {
  return ids.filter((id) => id !== recordId);
}
