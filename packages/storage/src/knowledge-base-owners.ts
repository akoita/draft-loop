/**
 * Which candidate record owns each knowledge base (ADR 0011, D6). A candidate record is a
 * workspace in the organisation's tenant, named by the id the API uses for it; the caller checks
 * the workspace exists and that the caller reaches it. A base's owner is set once, when the base
 * is created in sign-in mode, and never changes; a base without one is tenant-wide.
 * The port acts within one tenant, which storage sets before every statement; this module holds
 * only the port, its records, its input rules and its errors.
 */

/** One knowledge base and the candidate record that owns it. */
export interface KnowledgeBaseOwnership {
  readonly knowledgeBaseId: string;
  readonly workspaceId: string;
  readonly recordedAt: string;
}

export interface KnowledgeBaseOwnershipInput {
  readonly knowledgeBaseId: string;
  readonly workspaceId: string;
}

export interface KnowledgeBaseOwners {
  /**
   * Records the base's owning record. Setting the same owner again returns the existing
   * ownership; another owner is refused, since a base never moves between records.
   */
  setOwner(input: KnowledgeBaseOwnershipInput): Promise<KnowledgeBaseOwnership>;
  /** The record that owns the base, or undefined for a tenant-wide or unknown base. */
  ownerOf(knowledgeBaseId: string): Promise<string | undefined>;
  /** The bases the records own, by id in ascending order. */
  basesOwnedBy(workspaceIds: readonly string[]): Promise<readonly string[]>;
  /**
   * Deletes a base that has no owner, no sources and is not the default, so a base created for a
   * record is not left unreachable when recording its owner failed. Returns whether it deleted
   * the base; an owned, populated or unknown base is left as it is.
   */
  removeUnowned(knowledgeBaseId: string): Promise<boolean>;
}

export type KnowledgeBaseOwnersErrorCode =
  /** A knowledge base or workspace id does not satisfy the port's rules. */
  | "invalid_input"
  /** The tenant has no knowledge base with that id. */
  | "knowledge_base_not_found"
  /** The base already belongs to another record. */
  | "owner_exists";

/**
 * Why the port refused a change. Its message is safe to show, and its code lets an adapter choose
 * the answer, such as 400 or 404.
 */
export class KnowledgeBaseOwnersError extends Error {
  readonly code: KnowledgeBaseOwnersErrorCode;

  constructor(code: KnowledgeBaseOwnersErrorCode, message: string) {
    super(message);
    this.name = "KnowledgeBaseOwnersError";
    this.code = code;
  }
}

const maximumKnowledgeBaseIdLength = 128;
const maximumWorkspaceIdLength = 256;

function requireId(value: string, maximumLength: number, label: string): string {
  if (value.length === 0 || value.length > maximumLength || value.trim() !== value) {
    throw new KnowledgeBaseOwnersError("invalid_input", `Invalid ${label} id.`);
  }
  return value;
}

export function requireOwnedKnowledgeBaseId(knowledgeBaseId: string): string {
  return requireId(knowledgeBaseId, maximumKnowledgeBaseIdLength, "knowledge base");
}

export function requireOwningRecordId(workspaceId: string): string {
  return requireId(workspaceId, maximumWorkspaceIdLength, "candidate record");
}
