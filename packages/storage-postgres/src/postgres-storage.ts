import type { AuditEvent, AuditEventInput } from "@draft-loop/storage";
import { createApplications } from "./applications.js";
import { appendAuditEventRow, createAuditEventReads, listAuditEventRows } from "./audit-trail.js";
import { createKnowledgeBaseRecords } from "./knowledge-bases.js";
import { createKnowledgeRunRecords } from "./knowledge-run-records.js";
import { createLexicalIndex } from "./lexical-index.js";
import { migratePostgres, postgresMigrations } from "./migrations.js";
import { createRunHistory } from "./run-history.js";
import {
  createSqlClient,
  requireSchemaName,
  type SqlClient,
  type SqlClientOptions,
} from "./sql-client.js";
import { createVectorIndex } from "./vector-index.js";
import { createVersionedRecords } from "./versioned-records.js";
import { createWorkspaceRecords } from "./workspace-records.js";
import { createWorkspaceSettings } from "./workspace-settings.js";

/** Where the storage lives, without a tenant: what migrations and grants act on. */
export type PostgresSchemaOptions = Omit<SqlClientOptions, "tenantId">;

/** One tenant's view of the storage. */
export interface PostgresStorageOptions extends PostgresSchemaOptions {
  readonly tenantId: string;
}

/**
 * Applies pending migrations, as a role that owns the schema and may create the `vector`
 * extension. The service runs this before it opens any tenant's store.
 */
export async function migratePostgresStorage(
  options: PostgresSchemaOptions,
): Promise<readonly number[]> {
  const client = createSqlClient(options);
  try {
    return await migratePostgres(client);
  } finally {
    await client.close();
  }
}

const rolePattern = /^[a-z_][a-z0-9_]{0,62}$/u;

/** Lets the service's runtime role read and write the storage tables, and nothing more. */
export async function grantPostgresStorageAccess(
  options: PostgresSchemaOptions,
  role: string,
): Promise<void> {
  if (!rolePattern.test(role)) throw new Error(`Invalid Postgres role name: ${role}`);
  const schema = requireSchemaName(options.schema ?? "public");
  const client = createSqlClient(options);
  try {
    await client.transaction(async (executor) => {
      await executor.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
      await executor.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`,
      );
      await executor.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${role}`);
    });
  } finally {
    await client.close();
  }
}

/**
 * Fails closed unless row-level security binds this connection and the schema is fully
 * migrated. A superuser or a BYPASSRLS role would see every tenant's rows.
 */
async function requireTenantSafeConnection(client: SqlClient): Promise<void> {
  const [role] = await client.query(
    "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
  );
  if (role === undefined || role.rolsuper !== false || role.rolbypassrls !== false) {
    throw new Error("Postgres storage must run as a role that row-level security applies to");
  }
  const [migrated] = await client.query("SELECT max(version) AS version FROM schema_migrations");
  const latest = Math.max(...postgresMigrations.map((migration) => migration.version));
  if (Number(migrated?.version) !== latest) {
    throw new Error("Postgres storage schema is not migrated to the current version");
  }
}

/**
 * Opens one tenant's view of the Postgres storage ports. Every transaction sets the tenant, so
 * row-level security confines reads and writes to that tenant's rows (ADR 0011, D3).
 */
export async function openPostgresStorage(options: PostgresStorageOptions) {
  const client = createSqlClient(options);
  try {
    await requireTenantSafeConnection(client);
  } catch (error) {
    await client.close();
    throw error;
  }
  return {
    ...createWorkspaceRecords(client),
    ...createRunHistory(client),
    ...createVersionedRecords(client),
    ...createKnowledgeBaseRecords(client),
    ...createKnowledgeRunRecords(client),
    ...createLexicalIndex(client),
    candidateKnowledgeVectorIndex: createVectorIndex(client),
    applications: createApplications(client),
    workspaceSettings: createWorkspaceSettings(client),
    appendAuditEvent: (input: AuditEventInput): Promise<AuditEvent> =>
      client.transaction((executor) => appendAuditEventRow(executor, input)),
    listAuditEvents: (workspaceId: string): Promise<readonly AuditEvent[]> =>
      listAuditEventRows(client, workspaceId),
    auditEvents: createAuditEventReads(client),
    close: () => client.close(),
  };
}

export type PostgresStorage = Awaited<ReturnType<typeof openPostgresStorage>>;
