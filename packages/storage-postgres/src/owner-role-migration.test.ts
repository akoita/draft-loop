import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { grantPostgresStorageAccess, migratePostgresStorage } from "./postgres-storage.js";
import { createSqlClient } from "./sql-client.js";

const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

// Cloud SQL migrates as a built-in user that is no superuser; the other suites migrate as one.
describe.runIf(connectionString !== undefined)(
  "migrating as a role that is not a superuser",
  () => {
    it("migrates, grants the runtime role and runs the erasure functions as the schema's owner", async () => {
      const url = connectionString ?? "";
      const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
      const owner = `draft_loop_test_owner_${suffix}`;
      const runtime = `draft_loop_test_runtime_${suffix}`;
      const schema = `owner_${suffix}`;
      const admin = createSqlClient({ connectionString: url, maxConnections: 1 });
      const ownerUrl = new URL(url);
      ownerUrl.username = owner;
      ownerUrl.password = owner;
      try {
        // The extension is the one step Cloud SQL's built-in user may take that a plain role may not.
        await admin.query("CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public");
        await admin.query(`CREATE ROLE ${owner} LOGIN NOSUPERUSER PASSWORD '${owner}'`);
        await admin.query(`CREATE ROLE ${runtime} NOLOGIN`);
        await admin.query(`CREATE SCHEMA ${schema} AUTHORIZATION ${owner}`);

        await migratePostgresStorage({ connectionString: ownerUrl.toString(), schema });
        await grantPostgresStorageAccess(
          { connectionString: ownerUrl.toString(), schema },
          runtime,
        );

        const client = createSqlClient({
          connectionString: ownerUrl.toString(),
          schema,
          maxConnections: 1,
        });
        try {
          const flags = await client.transaction(async (executor) => {
            await executor.query("SELECT set_config('draft_loop.tenant_id', 'tenant-none', true)");
            await executor.query(`SELECT ${schema}.erase_tenant_remainder()`);
            const [after] = await executor.query(
              "SELECT current_setting('draft_loop.erasure', true) AS erasure",
            );
            return after;
          });
          // The function restores the flag, so nothing after it passes the immutability trigger.
          expect(flags).toEqual({ erasure: "" });
        } finally {
          await client.close();
        }
      } finally {
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await admin.query(`DROP ROLE IF EXISTS ${runtime}`);
        await admin.query(`DROP ROLE IF EXISTS ${owner}`);
        await admin.close();
      }
    });
  },
);
