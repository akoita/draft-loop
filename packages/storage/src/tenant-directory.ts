/**
 * The hosted service's directory of organisations and their members (ADR 0011, D6). An
 * organisation is the tenant: its id is the tenant id that scopes every stored row. This module
 * holds only the port, its records, its input rules and its errors; storage implements it.
 */

/** What a member may do in their organisation. Candidate and reviewer roles come later. */
export type MemberRole = "owner" | "admin" | "member";

export const memberRoles: readonly MemberRole[] = ["owner", "admin", "member"];

/** An invited member becomes active when they first sign in with the invited, verified email. */
export type MemberStatus = "invited" | "active";

/** Who signed in, as the identity provider's verified token states it. */
export interface SignInIdentity {
  readonly issuer: string;
  readonly subject: string;
  readonly email?: string;
  readonly emailVerified: boolean;
}

/** The one tenant and role a signed-in person acts with. */
export interface SignedInMember {
  readonly tenantId: string;
  readonly memberId: string;
  readonly role: MemberRole;
}

export interface OrganisationRecord {
  /** Also the tenant id. */
  readonly organisationId: string;
  readonly name: string;
  readonly createdAt: string;
}

export interface MemberRecord {
  readonly organisationId: string;
  readonly memberId: string;
  /** Trimmed and lower-cased. */
  readonly email: string;
  readonly role: MemberRole;
  readonly status: MemberStatus;
  readonly invitedAt: string;
  /** When the member first signed in; absent while invited. */
  readonly activatedAt?: string;
  readonly updatedAt: string;
}

export interface CreatedOrganisation {
  readonly organisation: OrganisationRecord;
  /** Invited as owner; active once they sign in with that verified email. */
  readonly firstOwner: MemberRecord;
}

export interface TenantDirectory {
  /**
   * Resolves a verified sign-in: an active member by (issuer, subject), else claims a pending
   * invite whose email matches a verified email. Undefined when neither.
   */
  resolveSignIn(identity: SignInIdentity): Promise<SignedInMember | undefined>;
  createOrganisation(input: {
    organisationId: string;
    name: string;
    firstOwnerEmail: string;
  }): Promise<CreatedOrganisation>;
  listMembers(organisationId: string): Promise<readonly MemberRecord[]>;
  inviteMember(input: {
    organisationId: string;
    email: string;
    role: MemberRole;
  }): Promise<MemberRecord>;
  /**
   * Gives a member a role. `actorRole` is the role of the member acting; the directory checks it
   * against the target in the same transaction as the change (see `requireManagerAuthority`).
   */
  changeRole(input: {
    organisationId: string;
    memberId: string;
    role: MemberRole;
    actorRole: MemberRole;
  }): Promise<MemberRecord>;
  /** Removes a member and returns the record removed, under the same authority check. */
  removeMember(input: {
    organisationId: string;
    memberId: string;
    actorRole: MemberRole;
  }): Promise<MemberRecord>;
}

export type TenantDirectoryErrorCode =
  /** An id, name, email or role does not satisfy the directory's rules. */
  | "invalid_input"
  /** An organisation with that id already exists. */
  | "organisation_exists"
  /** No organisation has that id. */
  | "organisation_not_found"
  /** The email is already invited to, or a member of, the organisation. */
  | "member_exists"
  /** The organisation has no member with that id. */
  | "member_not_found"
  /** The change would leave the organisation without an owner. */
  | "last_owner"
  /** The acting member's role does not allow the change. */
  | "forbidden";

/**
 * Why the directory refused a change. Its message is safe to show, and its code lets an adapter
 * choose the answer, such as 400, 404 or 409.
 */
export class TenantDirectoryError extends Error {
  readonly code: TenantDirectoryErrorCode;

  constructor(code: TenantDirectoryErrorCode, message: string) {
    super(message);
    this.name = "TenantDirectoryError";
    this.code = code;
  }
}

/**
 * Refuses a membership change the acting role may not make: only owners and admins manage
 * members, and only an owner grants, changes or removes the owner role. Storage calls it with
 * the target's role read under the row lock, so a promotion racing the change cannot slip past.
 * `grantedRole` is the role being given; leave it out when removing.
 */
export function requireManagerAuthority(
  actorRole: MemberRole,
  targetRole: MemberRole,
  grantedRole?: MemberRole,
): void {
  if (actorRole === "owner") return;
  if (actorRole !== "admin") {
    throw new TenantDirectoryError(
      "forbidden",
      "Only an organisation's owners and admins manage its members.",
    );
  }
  if (targetRole === "owner" || grantedRole === "owner") {
    throw new TenantDirectoryError(
      "forbidden",
      "Only an owner may grant, change or remove the owner role.",
    );
  }
}

/** The tenant id pattern storage enforces before a transaction acts for a tenant. */
const organisationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const emailPattern = /^[^\s@]+@[^\s@]+$/u;
const maximumEmailLength = 320;
const maximumNameLength = 200;

export function requireOrganisationId(organisationId: string): string {
  if (!organisationIdPattern.test(organisationId)) {
    throw new TenantDirectoryError("invalid_input", "Invalid organisation id.");
  }
  return organisationId;
}

/** Trims and lower-cases an email, so an invite and a sign-in compare equal. */
export function normalizeMemberEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (normalized.length > maximumEmailLength || !emailPattern.test(normalized)) {
    throw new TenantDirectoryError("invalid_input", "Invalid email address.");
  }
  return normalized;
}

export function requireMemberRole(role: string): MemberRole {
  if (!(memberRoles as readonly string[]).includes(role)) {
    throw new TenantDirectoryError("invalid_input", "Invalid member role.");
  }
  return role as MemberRole;
}

export function requireOrganisationName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > maximumNameLength) {
    throw new TenantDirectoryError("invalid_input", "Invalid organisation name.");
  }
  return trimmed;
}

/**
 * The email a sign-in may claim an invite with: only one the provider verified, normalized.
 * Undefined when the token carries no verified, well-formed email.
 */
export function verifiedSignInEmail(identity: SignInIdentity): string | undefined {
  if (!identity.emailVerified || identity.email === undefined) return undefined;
  try {
    return normalizeMemberEmail(identity.email);
  } catch {
    return undefined;
  }
}
