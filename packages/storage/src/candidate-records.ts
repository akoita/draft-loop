/**
 * Who in an organisation may work on which candidate record (ADR 0011, D6). A candidate record is
 * a workspace in the organisation's tenant, named by the id the API uses for it; the caller
 * checks the workspace exists. A member is one of its organisation's members.
 * The port acts within one tenant, which storage sets before every statement; this module holds
 * only the port, its records, its input rules and its errors.
 */

/** One member assigned to one candidate record. */
export interface CandidateRecordAssignment {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly assignedAt: string;
}

export interface CandidateRecordAssignmentInput {
  readonly workspaceId: string;
  readonly memberId: string;
}

export interface CandidateRecordAccess {
  /** Assigns the member to the record; assigning again returns the existing assignment. */
  assignMember(input: CandidateRecordAssignmentInput): Promise<CandidateRecordAssignment>;
  /** Removes the assignment. False when the member was not assigned to the record. */
  unassignMember(input: CandidateRecordAssignmentInput): Promise<boolean>;
  /** The record's members, oldest assignment first. */
  listRecordMembers(workspaceId: string): Promise<readonly CandidateRecordAssignment[]>;
  /** The records assigned to the member, oldest assignment first. */
  listMemberRecords(memberId: string): Promise<readonly CandidateRecordAssignment[]>;
  /** Every record of the tenant, assigned or not, by id in ascending order; none closed for erasure. */
  listRecords(): Promise<readonly string[]>;
}

export type CandidateRecordAccessErrorCode =
  /** A workspace or member id does not satisfy the port's rules. */
  | "invalid_input"
  /** The tenant's organisation has no member with that id. */
  | "member_not_found";

/**
 * Why the port refused a change or a read. Its message is safe to show, and its code lets an
 * adapter choose the answer, such as 400 or 404.
 */
export class CandidateRecordAccessError extends Error {
  readonly code: CandidateRecordAccessErrorCode;

  constructor(code: CandidateRecordAccessErrorCode, message: string) {
    super(message);
    this.name = "CandidateRecordAccessError";
    this.code = code;
  }
}

const maximumWorkspaceIdLength = 256;
const maximumMemberIdLength = 128;

function requireId(value: string, maximumLength: number, label: string): string {
  if (value.length === 0 || value.length > maximumLength || value.trim() !== value) {
    throw new CandidateRecordAccessError("invalid_input", `Invalid ${label} id.`);
  }
  return value;
}

export function requireCandidateRecordId(workspaceId: string): string {
  return requireId(workspaceId, maximumWorkspaceIdLength, "candidate record");
}

export function requireAssignedMemberId(memberId: string): string {
  return requireId(memberId, maximumMemberIdLength, "member");
}
