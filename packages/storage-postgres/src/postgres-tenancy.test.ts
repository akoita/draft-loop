import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openPostgresTenancy } from "./postgres-storage.js";
import { createSqlPool } from "./sql-client.js";
import { createTestSchema, runtimeRoleUrl } from "./test-schema.js";

/** Set by the Postgres CI job and by developers with a local server; skipped without it. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const at = "2026-10-24T10:00:00.000Z";

describe.runIf(connectionString !== undefined)("Postgres tenancy", () => {
  const url = connectionString ?? "";

  it("keeps two tenants on one pool from reading or writing each other's rows", async () => {
    const { admin, openTenancy, drop } = await createTestSchema(url, "tenancy");
    const tenancy = await openTenancy();
    try {
      const tenantA = tenancy.forTenant("tenant-a");
      const tenantB = tenancy.forTenant("tenant-b");
      await tenantA.saveWorkspace({
        id: "workspace-1",
        state: "collecting",
        createdAt: at,
        updatedAt: at,
      });
      await tenantA.workspaceSettings.write("workspaces/one", "workspace.json", "a\n");
      await expect(tenantB.getWorkspace("workspace-1")).resolves.toBeUndefined();
      await expect(tenantB.listAuditEvents("workspace-1")).resolves.toEqual([]);
      await expect(
        tenantB.workspaceSettings.remove("workspaces/one", "workspace.json"),
      ).resolves.toBe(false);

      // The same ids in the other tenant are its own rows and leave the first tenant's untouched.
      await tenantB.saveWorkspace({
        id: "workspace-1",
        state: "drafting",
        createdAt: at,
        updatedAt: at,
      });
      await tenantB.workspaceSettings.write("workspaces/one", "workspace.json", "b\n");
      await expect(tenantA.getWorkspace("workspace-1")).resolves.toMatchObject({
        state: "collecting",
      });
      await expect(
        tenantA.workspaceSettings.read("workspaces/one", "workspace.json"),
      ).resolves.toBe("a\n");
      await expect(tenantA.auditEvents.verifyAuditChain("workspace-1")).resolves.toMatchObject({
        ok: true,
      });
      const [counts] = await admin.query(
        "SELECT count(*) FILTER (WHERE tenant_id = 'tenant-a') AS a, count(*) FILTER (WHERE tenant_id = 'tenant-b') AS b FROM workspaces",
      );
      expect(counts).toEqual({ a: "1", b: "1" });
    } finally {
      await tenancy.close();
      await drop();
    }
  });

  it("serves many tenants without growing the pool past its maximum", async () => {
    const { schema, admin, drop } = await createTestSchema(url, "tenancy_pool");
    // A unique application name lets the superuser count exactly this pool's connections.
    const applicationName = `tenancy_${randomUUID().replaceAll("-", "")}`;
    const runtimeUrl = new URL(runtimeRoleUrl(url));
    runtimeUrl.searchParams.set("application_name", applicationName);
    const tenancy = await openPostgresTenancy({
      connectionString: runtimeUrl.toString(),
      schema,
      maxConnections: 2,
    });
    try {
      const tenants = Array.from({ length: 20 }, (_, index) => `tenant-${index}`);
      await Promise.all(
        tenants.map(async (tenantId) => {
          const storage = tenancy.forTenant(tenantId);
          await storage.saveWorkspace({
            id: "workspace-1",
            state: "collecting",
            createdAt: at,
            updatedAt: at,
          });
          await storage.workspaceSettings.write("workspaces/one", "workspace.json", tenantId);
        }),
      );
      for (const tenantId of tenants) {
        const storage = tenancy.forTenant(tenantId);
        await expect(
          storage.workspaceSettings.read("workspaces/one", "workspace.json"),
        ).resolves.toBe(tenantId);
        await expect(storage.listAuditEvents("workspace-1")).resolves.toHaveLength(1);
      }
      const [connections] = await admin.query(
        "SELECT count(*) AS count FROM pg_stat_activity WHERE application_name = $1",
        [applicationName],
      );
      expect(Number(connections?.count)).toBeGreaterThan(0);
      expect(Number(connections?.count)).toBeLessThanOrEqual(2);
    } finally {
      await tenancy.close();
      await drop();
    }
  });

  it("sets each tenant per transaction and leaves no tenant on a reused connection", async () => {
    const { schema, drop } = await createTestSchema(url, "tenancy_session");
    const pool = createSqlPool({
      connectionString: runtimeRoleUrl(url),
      schema,
      maxConnections: 2,
    });
    try {
      const tenants = Array.from({ length: 20 }, (_, index) => `tenant-${index}`);
      const rows = await Promise.all(
        tenants.map(async (tenantId) => {
          const [row] = await pool
            .forTenant(tenantId)
            .query(
              "SELECT pg_backend_pid() AS pid, current_setting('draft_loop.tenant_id') AS tenant",
            );
          return { tenantId, row };
        }),
      );
      for (const { tenantId, row } of rows) expect(row?.tenant).toBe(tenantId);
      expect(new Set(rows.map(({ row }) => row?.pid)).size).toBeLessThanOrEqual(2);

      const [unscoped] = await pool.query(
        "SELECT coalesce(current_setting('draft_loop.tenant_id', true), '') AS tenant",
      );
      expect(unscoped?.tenant).toBe("");
      expect(() => pool.forTenant("not a tenant")).toThrow(/Invalid tenant id/u);
    } finally {
      await pool.close();
      await drop();
    }
  });

  it("refuses an invalid tenant id", async () => {
    const { openTenancy, drop } = await createTestSchema(url, "tenancy_invalid");
    const tenancy = await openTenancy(1);
    try {
      expect(() => tenancy.forTenant("")).toThrow(/Invalid tenant id/u);
      expect(() => tenancy.forTenant("tenant/../other")).toThrow(/Invalid tenant id/u);
    } finally {
      await tenancy.close();
      await drop();
    }
  });
});
