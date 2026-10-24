import type { ApiInput, ApiSchemas } from "./api-client.js";

type Me = ApiSchemas["Me"];
type OrganisationMember = ApiSchemas["OrganisationMember"];
type RecordMember = ApiSchemas["RecordMember"];

/** The API's rule for a workspace id, which names a candidate record. */
export const recordIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

/** The ids of the records the caller reaches, sorted and without repeats. */
export function recordIds(list: ApiSchemas["WorkspaceList"]): string[] {
  return [...new Set(list.workspaces.map((workspace) => workspace.id))].sort();
}

/** The list with one more record, such as one the caller just created. */
export function withRecord(ids: readonly string[], recordId: string): string[] {
  return [...new Set([...ids, recordId])].sort();
}

/**
 * The record the screen opens: the one this tab last chose, while the caller still reaches it,
 * or else the first one listed.
 */
export function currentRecordId(
  ids: readonly string[],
  remembered: string | undefined,
): string | undefined {
  if (remembered !== undefined && ids.includes(remembered)) return remembered;
  return ids[0];
}

/** Why a typed id cannot name a new record, or `undefined` when it can. */
export function newRecordIdProblem(recordId: string, ids: readonly string[]): string | undefined {
  if (recordId.length === 0) return "Give the new record an id.";
  if (!recordIdPattern.test(recordId))
    return "Use up to 128 letters, digits, dots, dashes or underscores, starting with a letter or digit.";
  if (ids.includes(recordId)) return "That record exists already. Choose it in the list.";
  return undefined;
}

/** Whether the caller assigns members to records: the owner token, and owners and admins. */
export function canManageMembers(me: Me): boolean {
  return me.kind === "owner" || me.role === "owner" || me.role === "admin";
}

/** What the screen says when the caller reaches no record yet. */
export function noRecordNotice(me: Me): string {
  return canManageMembers(me)
    ? "Your organisation has no candidate record yet. Create the first one."
    : "No candidate record is assigned to you yet. Create one, or ask an owner or admin of your organisation to assign you.";
}

/** The organisation's members not yet assigned to the record, by email. */
export function assignableMembers(
  organisation: readonly OrganisationMember[],
  assigned: readonly RecordMember[],
): OrganisationMember[] {
  const taken = new Set(assigned.map((member) => member.memberId));
  return organisation
    .filter((member) => !taken.has(member.memberId))
    .sort((a, b) => a.email.localeCompare(b.email));
}

/** How a member reads in the list, such as `ada@example.test · admin · invited`. */
export function memberLabel(member: OrganisationMember | RecordMember): string {
  return [member.email, member.role, ...(member.status === "invited" ? ["invited"] : [])].join(
    " · ",
  );
}

/** The request that assigns a member to a record. */
export function assignMemberRequest(
  workspaceId: string,
  memberId: string,
): ApiInput<"PUT /v1/workspaces/{workspaceId}/members/{memberId}"> {
  return { path: { workspaceId, memberId } };
}

/** The request that removes a member from a record. */
export function unassignMemberRequest(
  workspaceId: string,
  memberId: string,
): ApiInput<"DELETE /v1/workspaces/{workspaceId}/members/{memberId}"> {
  return { path: { workspaceId, memberId } };
}

/** The record this tab last chose, so a reload reopens it. */
export interface RecordMemory {
  read(): string | undefined;
  remember(recordId: string): void;
}

const storageKey = "draft-loop.record";

/**
 * Keeps the chosen record id in the tab's session storage: each tab can work on its own record.
 * The id is no secret; storage can be missing or refuse access, and the screen then opens the
 * first record listed.
 */
export function createRecordMemory(storage: () => Storage | undefined): RecordMemory {
  let memory: string | undefined;
  return {
    read() {
      try {
        const value = storage()?.getItem(storageKey);
        return typeof value === "string" && recordIdPattern.test(value) ? value : memory;
      } catch {
        return memory;
      }
    },
    remember(recordId) {
      memory = recordId;
      try {
        storage()?.setItem(storageKey, recordId);
      } catch {
        // Memory still holds it for this page.
      }
    },
  };
}

/** The record memory in a browser tab. */
export const recordMemory = createRecordMemory(() => globalThis.sessionStorage);
