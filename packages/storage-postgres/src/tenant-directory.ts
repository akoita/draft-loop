import { randomUUID } from "node:crypto";
import {
  type CreatedOrganisation,
  type MemberRecord,
  type MemberRole,
  normalizeMemberEmail,
  type OrganisationRecord,
  requireMemberRole,
  requireOrganisationId,
  requireOrganisationName,
  type SignedInMember,
  type SignInIdentity,
  type TenantDirectory,
  TenantDirectoryError,
  verifiedSignInEmail,
} from "@draft-loop/storage/tenant-directory";
import type { PostgresSchemaOptions } from "./postgres-storage.js";
import { createSqlClient, type SqlClient, type SqlExecutor, type SqlRow } from "./sql-client.js";
import { tenantDirectoryMigration } from "./tenant-directory-migration.js";

/** The tenant directory on Postgres, with the pool it opened. */
export interface PostgresTenantDirectory extends TenantDirectory {
  readonly close: () => Promise<void>;
}

const memberColumns = "tenant_id, id, email, role, status, invited_at, activated_at, updated_at";

function timestamp(value: unknown): string {
  return (value instanceof Date ? value : new Date(String(value))).toISOString();
}

function memberRecord(row: SqlRow): MemberRecord {
  const record = {
    organisationId: String(row.tenant_id),
    memberId: String(row.id),
    email: String(row.email),
    role: requireMemberRole(String(row.role)),
    status: row.status === "active" ? ("active" as const) : ("invited" as const),
    invitedAt: timestamp(row.invited_at),
    updatedAt: timestamp(row.updated_at),
  };
  return row.activated_at === null || row.activated_at === undefined
    ? record
    : { ...record, activatedAt: timestamp(row.activated_at) };
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "23505";
}

function memberNotFound(): TenantDirectoryError {
  return new TenantDirectoryError("member_not_found", "The organisation has no such member.");
}

/**
 * Runs `work` as the organisation's tenant, after locking the organisation's row so membership
 * changes in one organisation apply one at a time and the owner check sees every owner.
 */
async function withOrganisation<Result>(
  client: SqlClient,
  organisationId: string,
  work: (executor: SqlExecutor) => Promise<Result>,
  lock = true,
): Promise<Result> {
  const tenantId = requireOrganisationId(organisationId);
  return client.transaction(async (executor) => {
    await executor.query("SELECT set_config('draft_loop.tenant_id', $1, true)", [tenantId]);
    const found = await executor.query(
      `SELECT 1 FROM organisations WHERE id = $1${lock ? " FOR UPDATE" : ""}`,
      [tenantId],
    );
    if (found.length === 0) {
      throw new TenantDirectoryError("organisation_not_found", "No such organisation.");
    }
    return work(executor);
  });
}

async function lockedMember(executor: SqlExecutor, memberId: string): Promise<MemberRecord> {
  const [row] = await executor.query(
    `SELECT ${memberColumns} FROM organisation_members WHERE id = $1 FOR UPDATE`,
    [memberId],
  );
  if (row === undefined) throw memberNotFound();
  return memberRecord(row);
}

/** Refuses a change that takes away the organisation's last owner, active or invited. */
async function requireAnotherOwner(executor: SqlExecutor, member: MemberRecord): Promise<void> {
  if (member.role !== "owner") return;
  const [row] = await executor.query(
    "SELECT count(*) AS owners FROM organisation_members WHERE role = 'owner' AND id <> $1",
    [member.memberId],
  );
  if (Number(row?.owners ?? 0) === 0) {
    throw new TenantDirectoryError("last_owner", "An organisation must keep at least one owner.");
  }
}

/**
 * Fails closed unless row-level security binds this connection: not a superuser, not a
 * BYPASSRLS role and not the directory's owner, whose policy reaches every tenant's members.
 */
async function requireDirectoryRuntimeRole(client: SqlClient): Promise<void> {
  const [role] = await client.query(
    `SELECT r.rolsuper, r.rolbypassrls,
            pg_has_role(current_user, t.tableowner, 'MEMBER') AS owns_directory
     FROM pg_roles r
     LEFT JOIN pg_tables t ON t.schemaname = current_schema() AND t.tablename = 'organisation_members'
     WHERE r.rolname = current_user`,
  );
  if (
    role === undefined ||
    role.rolsuper !== false ||
    role.rolbypassrls !== false ||
    role.owns_directory !== false
  ) {
    throw new Error("The tenant directory must run as a role that row-level security applies to");
  }
  const [migrated] = await client.query("SELECT max(version) AS version FROM schema_migrations");
  if (Number(migrated?.version) < tenantDirectoryMigration.version) {
    throw new Error("Postgres storage schema is not migrated to the tenant directory");
  }
}

/**
 * Opens the organisations and members directory as the runtime role (ADR 0011, D6). Member
 * changes run as the organisation's tenant under row-level security; only `resolveSignIn`
 * looks across tenants, through the migration's `resolve_member_sign_in` function.
 */
export async function createPostgresTenantDirectory(
  options: PostgresSchemaOptions,
): Promise<PostgresTenantDirectory> {
  const client = createSqlClient({ ...options, maxConnections: options.maxConnections ?? 4 });
  try {
    await requireDirectoryRuntimeRole(client);
  } catch (error) {
    await client.close();
    throw error;
  }

  const insertMember = async (
    executor: SqlExecutor,
    email: string,
    role: MemberRole,
  ): Promise<MemberRecord> => {
    const existing = await executor.query("SELECT 1 FROM organisation_members WHERE email = $1", [
      email,
    ]);
    if (existing.length > 0) {
      throw new TenantDirectoryError(
        "member_exists",
        "That email is already invited to, or a member of, the organisation.",
      );
    }
    const [row] = await executor.query(
      `INSERT INTO organisation_members (id, email, role, status)
       VALUES ($1, $2, $3, 'invited')
       RETURNING ${memberColumns}`,
      [randomUUID(), email, role],
    );
    if (row === undefined) throw new Error("The member was not recorded");
    return memberRecord(row);
  };

  return {
    resolveSignIn: async (identity: SignInIdentity): Promise<SignedInMember | undefined> => {
      if (identity.issuer.trim() === "" || identity.subject.trim() === "") {
        throw new TenantDirectoryError("invalid_input", "A sign-in needs an issuer and a subject.");
      }
      const [row] = await client.transaction((executor) =>
        executor.query(
          "SELECT organisation_id, member_id, member_role FROM resolve_member_sign_in($1, $2, $3)",
          [identity.issuer, identity.subject, verifiedSignInEmail(identity) ?? null],
        ),
      );
      if (row === undefined) return undefined;
      return {
        tenantId: String(row.organisation_id),
        memberId: String(row.member_id),
        role: requireMemberRole(String(row.member_role)),
      };
    },

    createOrganisation: async (input): Promise<CreatedOrganisation> => {
      const tenantId = requireOrganisationId(input.organisationId);
      const name = requireOrganisationName(input.name);
      const email = normalizeMemberEmail(input.firstOwnerEmail);
      return client.transaction(async (executor) => {
        await executor.query("SELECT set_config('draft_loop.tenant_id', $1, true)", [tenantId]);
        const [row] = await executor.query(
          `INSERT INTO organisations (id, name) VALUES ($1, $2)
           ON CONFLICT (id) DO NOTHING
           RETURNING id, name, created_at`,
          [tenantId, name],
        );
        if (row === undefined) {
          throw new TenantDirectoryError(
            "organisation_exists",
            "An organisation with that id already exists.",
          );
        }
        const organisation: OrganisationRecord = {
          organisationId: String(row.id),
          name: String(row.name),
          createdAt: timestamp(row.created_at),
        };
        return { organisation, firstOwner: await insertMember(executor, email, "owner") };
      });
    },

    listMembers: (organisationId) =>
      withOrganisation(
        client,
        organisationId,
        async (executor) =>
          (
            await executor.query(
              `SELECT ${memberColumns} FROM organisation_members ORDER BY invited_at, id`,
            )
          ).map(memberRecord),
        false,
      ),

    inviteMember: async (input) => {
      const email = normalizeMemberEmail(input.email);
      const role = requireMemberRole(input.role);
      try {
        return await withOrganisation(client, input.organisationId, (executor) =>
          insertMember(executor, email, role),
        );
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        throw new TenantDirectoryError(
          "member_exists",
          "That email is already invited to, or a member of, the organisation.",
        );
      }
    },

    changeRole: async (input) => {
      const role = requireMemberRole(input.role);
      return withOrganisation(client, input.organisationId, async (executor) => {
        const member = await lockedMember(executor, input.memberId);
        if (member.role === role) return member;
        if (role !== "owner") await requireAnotherOwner(executor, member);
        const [row] = await executor.query(
          `UPDATE organisation_members SET role = $2, updated_at = now() WHERE id = $1
           RETURNING ${memberColumns}`,
          [member.memberId, role],
        );
        if (row === undefined) throw memberNotFound();
        return memberRecord(row);
      });
    },

    removeMember: async (input) => {
      await withOrganisation(client, input.organisationId, async (executor) => {
        const member = await lockedMember(executor, input.memberId);
        await requireAnotherOwner(executor, member);
        await executor.query("DELETE FROM organisation_members WHERE id = $1", [member.memberId]);
      });
    },

    close: () => client.close(),
  };
}
