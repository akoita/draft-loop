import { describe, expect, it } from "vitest";
import { seedRecord, seedTenant, tenantWideTables } from "./erasure-test-seed.js";
import { createSqlPool, type SqlClient } from "./sql-client.js";
import { createTestSchema, runtimeRoleUrl, type TestSchema } from "./test-schema.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

/** Every row of every table, as sorted JSON text per table. */
async function snapshot(admin: SqlClient, schema: string): Promise<Record<string, string[]>> {
  const tables = await admin.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename",
    [schema],
  );
  const rows: Record<string, string[]> = {};
  for (const { tablename } of tables) {
    const table = String(tablename);
    const found = await admin.query(`SELECT to_jsonb(t)::text AS row FROM ${table} t`);
    rows[table] = found.map((row) => String(row.row)).sort();
  }
  return rows;
}

describe.runIf(connectionString !== undefined)("Postgres candidate record erasure", () => {
  const url = connectionString ?? "";

  async function withSchema(work: (schema: TestSchema) => Promise<void>): Promise<void> {
    const schema = await createTestSchema(url, "record_erasure");
    try {
      await seedTenant(schema.admin, "org-north");
      await seedTenant(schema.admin, "org-south");
      await work(schema);
    } finally {
      await schema.drop();
    }
  }

  it("erases every row of a record and leaves other records and tenants as they were", async () => {
    await withSchema(async (schema) => {
      const { admin } = schema;
      await seedRecord(admin, "org-north", "record-kept");
      await seedRecord(admin, "org-south", "record-gone");
      const before = await snapshot(admin, schema.schema);
      await seedRecord(admin, "org-north", "record-gone");

      // The seed reaches every table a record can: a table added later must be erased too.
      const seeded = await snapshot(admin, schema.schema);
      const unseeded = Object.keys(seeded).filter(
        (table) => !tenantWideTables.has(table) && seeded[table]?.length === before[table]?.length,
      );
      expect(unseeded).toEqual([]);

      const tenancy = await schema.openTenancy();
      try {
        const north = tenancy.forTenant("org-north");
        const erasure = north.recordErasure;
        await expect(erasure.isClosed("record-gone")).resolves.toBe(false);
        const objectKeys = [
          "tenants/org-north/knowledge/knowledge/record-gone-version-1",
          "tenants/org-north/knowledge/knowledge/record-gone-version-2",
          "tenants/org-north/workspaces/record-gone/exports/record-gone-run.md",
        ];
        await expect(erasure.close("record-gone")).resolves.toEqual({
          state: "closed",
          resumed: false,
          objectKeys,
        });
        // Closed: gone from the listing at once, and a second call resumes the same erasure.
        await expect(erasure.isClosed("record-gone")).resolves.toBe(true);
        await expect(north.candidateRecords.listRecords()).resolves.toEqual(["record-kept"]);
        await expect(erasure.close("record-gone")).resolves.toEqual({
          state: "closed",
          resumed: true,
          objectKeys,
        });

        const removed = Object.values(seeded).reduce((sum, rows) => sum + rows.length, 0);
        const kept = Object.values(before).reduce((sum, rows) => sum + rows.length, 0);
        await expect(erasure.erase("record-gone")).resolves.toEqual({
          rowsRemoved: removed - kept + 1,
          objectKeys,
        });
        await expect(erasure.close("record-gone")).resolves.toEqual({ state: "missing" });
        await expect(erasure.isClosed("record-gone")).resolves.toBe(false);
        await expect(erasure.erase("record-gone")).rejects.toMatchObject({
          name: "RecordErasureError",
          code: "not_closed",
        });
      } finally {
        await tenancy.close();
      }
      expect(await snapshot(admin, schema.schema)).toEqual(before);
    });
  });

  it("refuses a record with an active run and one never closed", async () => {
    await withSchema(async (schema) => {
      await seedRecord(schema.admin, "org-north", "record-busy", { runState: "drafting" });
      await seedRecord(schema.admin, "org-north", "record-idle");
      const tenancy = await schema.openTenancy();
      try {
        const erasure = tenancy.forTenant("org-north").recordErasure;
        await expect(erasure.close("record-busy")).resolves.toEqual({ state: "run-active" });
        await expect(erasure.isClosed("record-busy")).resolves.toBe(false);
        await expect(erasure.erase("record-idle")).rejects.toMatchObject({ code: "not_closed" });
        await expect(erasure.close("record-never")).resolves.toEqual({ state: "missing" });
        // Another tenant's record is out of reach, even by the same id.
        const south = tenancy.forTenant("org-south").recordErasure;
        await expect(south.close("record-idle")).resolves.toEqual({ state: "missing" });
      } finally {
        await tenancy.close();
      }
    });
  });

  it("keeps the ledger, the audit chain and closing marks out of the runtime role's reach", async () => {
    await withSchema(async (schema) => {
      await seedRecord(schema.admin, "org-north", "record-1");
      const tenancy = await schema.openTenancy();
      const pool = createSqlPool({ connectionString: runtimeRoleUrl(url), schema: schema.schema });
      try {
        await tenancy.forTenant("org-north").recordErasure.close("record-1");
        const asTenant = pool.forTenant("org-north");
        for (const statement of [
          "DELETE FROM consent_events",
          "UPDATE consent_events SET note = 'changed'",
          "TRUNCATE consent_events",
          "DELETE FROM audit_events",
          "UPDATE audit_events SET event_type = 'changed'",
          "DELETE FROM candidate_record_erasures",
        ]) {
          await expect(asTenant.query(statement)).rejects.toThrow(/permission denied/u);
        }
        // The erasure setting alone opens nothing: only the function's owning role passes.
        await expect(
          asTenant.transaction(async (executor) => {
            await executor.query("SET LOCAL draft_loop.erasure = 'on'");
            await executor.query("DELETE FROM context_snapshots");
          }),
        ).rejects.toThrow(/immutable/u);
        // The owning role itself is refused outside the function.
        await expect(schema.admin.query("DELETE FROM context_snapshots")).rejects.toThrow(
          /immutable/u,
        );
        await expect(schema.admin.query("DELETE FROM consent_events")).rejects.toThrow(
          /immutable/u,
        );
        // Without a tenant the function erases nothing.
        await expect(pool.query("SELECT erase_candidate_record('record-1')")).rejects.toThrow(
          /tenant/u,
        );
      } finally {
        await pool.close();
        await tenancy.close();
      }
    });
  });
});
