import type { AuditEvent, AuditEventInput } from "@draft-loop/storage";
import { createApplications } from "./applications.js";
import { appendAuditEventRow, createAuditEventReads, listAuditEventRows } from "./audit-trail.js";
import { createCandidateRecordAccess } from "./candidate-records.js";
import { createConsentLedger } from "./consent-ledger.js";
import { consentLedgerGrant } from "./consent-ledger-migration.js";
import { createIdempotencyKeys } from "./idempotency-keys.js";
import { createKnowledgeBaseOwners } from "./knowledge-base-owners.js";
import { createKnowledgeBaseRecords } from "./knowledge-bases.js";
import { createKnowledgeRunRecords } from "./knowledge-run-records.js";
import { createLexicalIndex } from "./lexical-index.js";
import { migratePostgres, postgresMigrations } from "./migrations.js";
import { createRecordArchiveRows } from "./record-archive.js";
import { createRunHistory } from "./run-history.js";
import { createRunState } from "./run-state.js";
import {
  createSqlClient,
  createSqlPool,
  requireSchemaName,
  requireTenantId,
  type SqlClientOptions,
  type SqlExecutor,
  type SqlSession,
} from "./sql-client.js";
import { tenantDirectoryGrant } from "./tenant-directory-migration.js";
import { createUsageReads } from "./usage.js";
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
      await executor.query(tenantDirectoryGrant(schema, role));
      await executor.query(consentLedgerGrant(schema, role));
    });
  } finally {
    await client.close();
  }
}

/**
 * Fails closed unless row-level security binds this connection and the schema is fully
 * migrated. A superuser or a BYPASSRLS role would see every tenant's rows.
 */
async function requireTenantSafeConnection(client: SqlExecutor): Promise<void> {
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

/** One tenant's storage ports over a session that sets the tenant in every transaction. */
function tenantStorage(client: SqlSession) {
  return {
    ...createWorkspaceRecords(client),
    ...createRunHistory(client),
    ...createVersionedRecords(client),
    ...createKnowledgeBaseRecords(client),
    ...createKnowledgeRunRecords(client),
    ...createRunState(client),
    ...createLexicalIndex(client),
    ...createUsageReads(client),
    ...createRecordArchiveRows(client),
    candidateKnowledgeVectorIndex: createVectorIndex(client),
    applications: createApplications(client),
    candidateRecords: createCandidateRecordAccess(client),
    idempotencyKeys: createIdempotencyKeys(client),
    knowledgeBaseOwners: createKnowledgeBaseOwners(client),
    workspaceSettings: createWorkspaceSettings(client),
    consentLedger: createConsentLedger(client),
    appendAuditEvent: (input: AuditEventInput): Promise<AuditEvent> =>
      client.transaction((executor) => appendAuditEventRow(executor, input)),
    listAuditEvents: (workspaceId: string): Promise<readonly AuditEvent[]> =>
      listAuditEventRows(client, workspaceId),
    auditEvents: createAuditEventReads(client),
  };
}

/** One tenant's storage ports, borrowed from a shared pool: they have no close. */
export type PostgresTenantStorage = ReturnType<typeof tenantStorage>;

/** One connection pool that hands out any tenant's storage ports on demand. */
export interface PostgresTenancy {
  /**
   * Returns the tenant's ports over the shared pool. Every transaction sets the tenant first,
   * so row-level security confines its reads and writes to that tenant's rows.
   */
  readonly forTenant: (tenantId: string) => PostgresTenantStorage;
  /** Closes the shared pool, and with it every tenant's ports. */
  readonly close: () => Promise<void>;
}

/**
 * Opens one pool that serves many tenants (ADR 0011, D3). The pool never opens more than its
 * maximum connections however many tenants it serves, since a tenant is set per transaction,
 * not per connection.
 */
export async function openPostgresTenancy(
  options: PostgresSchemaOptions,
): Promise<PostgresTenancy> {
  const pool = createSqlPool({
    connectionString: options.connectionString,
    ...(options.schema === undefined ? {} : { schema: options.schema }),
    ...(options.maxConnections === undefined ? {} : { maxConnections: options.maxConnections }),
  });
  try {
    await requireTenantSafeConnection(pool);
  } catch (error) {
    await pool.close();
    throw error;
  }
  return {
    forTenant: (tenantId) => tenantStorage(pool.forTenant(tenantId)),
    close: pool.close,
  };
}

/**
 * Opens one tenant's view of the Postgres storage ports over a pool of its own, which `close`
 * closes. Every transaction sets the tenant, so row-level security confines reads and writes to
 * that tenant's rows (ADR 0011, D3).
 */
export async function openPostgresStorage(options: PostgresStorageOptions) {
  const tenantId = requireTenantId(options.tenantId);
  const tenancy = await openPostgresTenancy(options);
  return { ...tenancy.forTenant(tenantId), close: tenancy.close };
}

export type PostgresStorage = Awaited<ReturnType<typeof openPostgresStorage>>;
