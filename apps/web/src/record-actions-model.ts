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

/** The request that downloads a record's archive. */
export function archiveRequest(
  workspaceId: string,
): ApiInput<"GET /v1/workspaces/{workspaceId}/archive"> {
  return { path: { workspaceId } };
}

/** The file a downloaded archive is saved under, as the API names it. */
export function archiveFileName(workspaceId: string): string {
  return `${workspaceId}-archive.zip`;
}

/**
 * The request that deletes a record, once the person typed its id back exactly; otherwise what to
 * tell them.
 */
export function deleteRecordRequest(
  workspaceId: string,
  typed: string,
):
  | { readonly request: ApiInput<"DELETE /v1/workspaces/{workspaceId}"> }
  | { readonly problem: string } {
  if (typed.trim() !== workspaceId)
    return { problem: `Type the record id, ${workspaceId}, exactly to delete it.` };
  return { request: { path: { workspaceId }, body: { confirm: workspaceId } } };
}

/** What to say when the API refuses a deletion; a running record needs its run stopped first. */
export function deleteRefusal(error: unknown): string {
  if (error instanceof ApiRequestError && error.code === "run_active")
    return "Stop the run first. A run on this record is queued or running: pause it or stop it for good in its review, then delete the record.";
  return describeError(error);
}

/** The list without a record the caller just deleted. */
export function withoutRecord(ids: readonly string[], recordId: string): string[] {
  return ids.filter((id) => id !== recordId);
}
