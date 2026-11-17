import { t } from "@lingui/core/macro";
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

/** The longest name a record can carry, as the API enforces it. */
export const recordNameMaxLength = 80;

/** The names people gave the listed records, by record id. */
export function recordNames(list: ApiSchemas["WorkspaceList"]): Map<string, string> {
  return new Map(
    list.workspaces.flatMap((workspace) =>
      workspace.name === undefined ? [] : [[workspace.id, workspace.name] as const],
    ),
  );
}

/** How a record reads on screen: its name, or its id when it has none. */
export function recordLabel(recordId: string, names: ReadonlyMap<string, string>): string {
  return names.get(recordId) ?? recordId;
}

/** A typed name as it is stored: runs of white space become one space, and the ends are cut. */
export function tidyRecordName(typed: string): string {
  return typed.replace(/\s+/gu, " ").trim();
}

/** Why a tidied name cannot name a new record, or `undefined` when it can. */
export function newRecordNameProblem(
  name: string,
  names: ReadonlyMap<string, string>,
): string | undefined {
  if (name.length === 0) return t`Give the new job search a name.`;
  if (name.length > recordNameMaxLength) return t`Use up to ${recordNameMaxLength} characters.`;
  const taken = [...names.values()].some((other) => other.toLowerCase() === name.toLowerCase());
  if (taken) return t`A job search has that name already. Choose it in the list.`;
  return undefined;
}

/**
 * A new record id made from its name: lower-case letters and digits joined by dashes, with a
 * number added while another record holds it. A name without Latin letters or digits gives
 * `record`.
 */
export function recordIdFromName(name: string, ids: readonly string[]): string {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48)
    .replace(/-+$/u, "");
  const base = slug.length === 0 ? "record" : slug;
  if (!ids.includes(base)) return base;
  for (let count = 2; ; count += 1) {
    const candidate = `${base}-${count}`;
    if (!ids.includes(candidate)) return candidate;
  }
}

/** Whether the caller assigns members to records: the owner token, and owners and admins. */
export function canManageMembers(me: Me): boolean {
  return me.kind === "owner" || me.role === "owner" || me.role === "admin";
}

/** What the screen says when the caller reaches no record yet. */
export function noRecordNotice(me: Me): string {
  return canManageMembers(me)
    ? t`Your team has no job search yet. Start the first one.`
    : t`No job search is shared with you yet. Start one, or ask an owner or admin of your team to share one with you.`;
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

/**
 * Whether the caller's plan holds one person and one job search, such as Free or Individual: the
 * screen then shows no job search picker and no access list. An organisation that already holds
 * more than one job search keeps them, so nobody loses one after a change of plan.
 */
export function isOnePersonPlan(me: Me, ids: readonly string[]): boolean {
  if (me.kind !== "member" || me.plan === undefined) return false;
  return me.plan.candidateRecords === 1 && me.plan.seats === 1 && ids.length <= 1;
}

/** Whether the plan lets more than one person sign in, so access to a job search can be shared. */
export function sharesAccess(me: Me): boolean {
  return me.kind === "owner" || me.plan === undefined || me.plan.seats !== 1;
}

/** How the account menu names the caller: the email, then the team on plans for several people. */
export function accountLabel(me: Me, onePerson: boolean): string {
  if (me.kind === "owner") return t`Owner`;
  const who = me.email ?? t`Signed in`;
  if (onePerson || me.organisationName === undefined) return who;
  return `${who} · ${me.organisationName}`;
}

/** The name a one-person plan's job search gets when the app sets it up on its own. */
export function firstJobSearchName(): string {
  return t`My job search`;
}
