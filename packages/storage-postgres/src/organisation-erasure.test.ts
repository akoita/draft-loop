import { describe, expect, it } from "vitest";
import { seedRecord, seedTenant } from "./erasure-test-seed.js";
import { createSqlPool, type SqlClient } from "./sql-client.js";
import { createTestSchema, runtimeRoleUrl } from "./test-schema.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

/** One tenant's rows in every table, as sorted JSON text per table; none is an empty list. */
async function tenantRows(
  admin: SqlClient,
  schema: string,
  tenant: string,
): Promise<Record<string, string[]>> {
  const tables = await admin.query(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = $1 AND (column_name = 'tenant_id'
       OR (table_name = 'organisations' AND column_name = 'id'))
     ORDER BY table_name`,
    [schema],
  );
  const rows: Record<string, string[]> = {};
  for (const { table_name: table, column_name: column } of tables) {
    const found = await admin.query(
      `SELECT to_jsonb(t)::text AS row FROM ${String(table)} t WHERE ${String(column)} = $1`,
      [tenant],
    );
    if (found.length > 0) rows[String(table)] = found.map((row) => String(row.row)).sort();
  }
  return rows;
}

describe.runIf(connectionString !== undefined)("Postgres organisation erasure", () => {
  const url = connectionString ?? "";

  it("leaves nothing of the tenant after its records and remainder, and the other tenant whole", async () => {
    const schema = await createTestSchema(url, "organisation_erasure");
    const tenancy = await schema.openTenancy();
    try {
      for (const tenant of ["org-north", "org-south"]) {
        await seedTenant(schema.admin, tenant);
        await seedRecord(schema.admin, tenant, "record-1");
      }
      await seedRecord(schema.admin, "org-north", "record-2");
      const south = await tenantRows(schema.admin, schema.schema, "org-south");
      const north = tenancy.forTenant("org-north");

      await expect(north.organisationErasure.isClosing()).resolves.toBe(false);
      await expect(north.organisationErasure.close()).resolves.toEqual({
        state: "closing",
        resumed: false,
      });
      await expect(north.organisationErasure.close()).resolves.toEqual({
        state: "closing",
        resumed: true,
      });
      await expect(north.organisationErasure.isClosing()).resolves.toBe(true);
      await expect(tenancy.forTenant("org-south").organisationErasure.isClosing()).resolves.toBe(
        false,
      );
      // A record closed by an interrupted erasure is still listed, so it is finished too.
      await north.recordErasure.close("record-2");
      await expect(north.organisationErasure.listRecords()).resolves.toEqual([
        "record-1",
        "record-2",
      ]);
      for (const id of await north.organisationErasure.listRecords()) {
        await north.recordErasure.close(id);
        await north.recordErasure.erase(id);
      }
      const remainder = await tenantRows(schema.admin, schema.schema, "org-north");
      expect(Object.keys(remainder)).toEqual([
        "candidate_knowledge_bases",
        "candidate_knowledge_source_versions",
        "candidate_knowledge_sources",
        "candidate_knowledge_stores",
        "content_screening_results",
        "credit_balances",
        "credit_ledger",
        "idempotency_keys",
        "organisation_members",
        "organisation_plan_history",
        "organisation_plans",
        "organisations",
      ]);
      const removed = Object.values(remainder).reduce((sum, rows) => sum + rows.length, 0);
      await expect(north.organisationErasure.eraseRemainder()).resolves.toEqual({
        rowsRemoved: removed,
      });

      expect(await tenantRows(schema.admin, schema.schema, "org-north")).toEqual({});
      expect(await tenantRows(schema.admin, schema.schema, "org-south")).toEqual(south);
      await expect(north.organisationErasure.isClosing()).resolves.toBe(false);
      await expect(north.organisationErasure.close()).resolves.toEqual({ state: "missing" });
      await expect(north.organisationErasure.listRecords()).resolves.toEqual([]);
      await expect(north.organisationErasure.eraseRemainder()).resolves.toEqual({
        rowsRemoved: 0,
      });
    } finally {
      await tenancy.close();
      await schema.drop();
    }
  });

  it("reports an active run anywhere in the tenant and erases nothing without a tenant", async () => {
    const schema = await createTestSchema(url, "organisation_erasure");
    const tenancy = await schema.openTenancy();
    const pool = createSqlPool({ connectionString: runtimeRoleUrl(url), schema: schema.schema });
    try {
      await seedTenant(schema.admin, "org-north");
      await seedTenant(schema.admin, "org-south");
      await seedRecord(schema.admin, "org-north", "record-1", { runState: "reviewing" });
      // An active run keeps the organisation open; another tenant's close is unaffected.
      await expect(tenancy.forTenant("org-north").organisationErasure.close()).resolves.toEqual({
        state: "run-active",
      });
      await expect(tenancy.forTenant("org-north").organisationErasure.isClosing()).resolves.toBe(
        false,
      );
      await expect(tenancy.forTenant("org-south").organisationErasure.close()).resolves.toEqual({
        state: "closing",
        resumed: false,
      });
      // The mark is final: not even the table's owner clears it.
      await expect(
        schema.admin.query("UPDATE organisations SET closing_at = NULL WHERE id = 'org-south'"),
      ).rejects.toThrow(/never reopens/u);
      await expect(pool.query("SELECT erase_tenant_remainder()")).rejects.toThrow(/tenant/u);
      // The function is the runtime role's only way past the trigger.
      await expect(
        pool.forTenant("org-north").query("DELETE FROM candidate_knowledge_sources"),
      ).rejects.toThrow(/immutable/u);
    } finally {
      await pool.close();
      await tenancy.close();
      await schema.drop();
    }
  });
});
