import { randomUUID } from "node:crypto";
import {
  grantPostgresStorageAccess,
  migratePostgresStorage,
  openPostgresStorage,
  openPostgresTenancy,
  type PostgresStorage,
  type PostgresTenancy,
} from "./postgres-storage.js";
import { createSqlClient, type SqlClient } from "./sql-client.js";

/** The runtime role tests open stores as: no superuser, no BYPASSRLS, so RLS applies. */
const appRole = "draft_loop_test_app";
const appPassword = "draft_loop_test_app";

/** A migrated, throwaway schema; stores open in it as the runtime role, one tenant each. */
export interface TestSchema {
  readonly schema: string;
  /** A superuser client in the schema, for setup and for edits that bypass the storage. */
  readonly admin: SqlClient;
  readonly open: (tenantId: string) => Promise<PostgresStorage>;
  /** One pool, as the runtime role, that serves any tenant. */
  readonly openTenancy: (maxConnections?: number) => Promise<PostgresTenancy>;
  readonly drop: () => Promise<void>;
}

export function runtimeRoleUrl(url: string): string {
  const parsed = new URL(url);
  parsed.username = appRole;
  parsed.password = appPassword;
  return parsed.toString();
}

/** Creates the schema as `url`'s superuser, migrates it and grants the runtime role access. */
export async function createTestSchema(url: string, prefix = "conformance"): Promise<TestSchema> {
  const schema = `${prefix}_${randomUUID().replaceAll("-", "")}`;
  const admin = createSqlClient({ connectionString: url, schema, maxConnections: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.query(`DO $$
    BEGIN
      CREATE ROLE ${appRole} LOGIN PASSWORD '${appPassword}';
    EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
    END $$`);
  await migratePostgresStorage({ connectionString: url, schema });
  await grantPostgresStorageAccess({ connectionString: url, schema }, appRole);
  return {
    schema,
    admin,
    open: (tenantId) =>
      openPostgresStorage({ connectionString: runtimeRoleUrl(url), schema, tenantId }),
    openTenancy: (maxConnections) =>
      openPostgresTenancy({
        connectionString: runtimeRoleUrl(url),
        schema,
        ...(maxConnections === undefined ? {} : { maxConnections }),
      }),
    drop: async () => {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.close();
    },
  };
}

/** One tenant's store in a schema of its own, dropped again on close. */
export async function openIsolated(url: string): Promise<{
  readonly storage: PostgresStorage;
  readonly close: () => Promise<void>;
}> {
  const testSchema = await createTestSchema(url);
  const storage = await testSchema.open("tenant-a");
  return {
    storage,
    close: async () => {
      await storage.close();
      await testSchema.drop();
    },
  };
}
