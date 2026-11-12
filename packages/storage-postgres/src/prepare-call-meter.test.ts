import { describe, expect, it } from "vitest";
import { createTestSchema } from "./test-schema.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const at = "2026-11-12T08:00:00.000Z";
const now = new Date(at);
const workspaceId = "record-1";

describe.runIf(connectionString !== undefined)("Postgres Prepare call meter", () => {
  const url = connectionString ?? "";

  it("counts Prepare calls only for an application whose run kept a credit", async () => {
    const schema = await createTestSchema(url, "prepare_call_meter");
    const tenancy = await schema.openTenancy();
    try {
      const admin = schema.admin;
      await admin.query(
        "INSERT INTO organisations (id, name) VALUES ('org-north', 'North'), ('org-south', 'South')",
      );
      const north = tenancy.forTenant("org-north");
      await north.organisationPlans.assignPlan({
        planId: "pro",
        periodStart: "2026-11-01",
        assignedAt: at,
      });
      await admin.query(
        "INSERT INTO workspaces (tenant_id, id, state, created_at, updated_at) VALUES ('org-north', $1, 'collecting', $2, $2)",
        [workspaceId, at],
      );
      for (const applicationId of ["application-paid", "application-refunded", "application-new"]) {
        await admin.query(
          `INSERT INTO applications (tenant_id, workspace_id, application_id, name, job_source_json, created_at, updated_at)
           VALUES ('org-north', $1, $2, 'Fictional role', '{}', $3, $3)`,
          [workspaceId, applicationId, at],
        );
      }
      for (const [runId, applicationId] of [
        ["run-paid", "application-paid"],
        ["run-refunded", "application-refunded"],
      ] as const) {
        await north.creditLedger.reserve({ runId, credits: 1, estimateVersion: 1, now });
        await admin.query(
          `INSERT INTO application_run_bindings (tenant_id, workspace_id, run_id, application_id, created_at)
           VALUES ('org-north', $1, $2, $3, $4)`,
          [workspaceId, runId, applicationId, at],
        );
      }
      await north.creditLedger.refund({ runId: "run-refunded", now });
      const meter = north.prepareCalls;
      const paid = { workspaceId, applicationId: "application-paid" };

      await expect(meter.take({ ...paid, limit: 2 })).resolves.toEqual({
        credited: true,
        allowed: true,
        used: 1,
      });
      await expect(meter.take({ ...paid, limit: 2 })).resolves.toMatchObject({ used: 2 });
      await expect(meter.take({ ...paid, limit: 2 })).resolves.toEqual({
        credited: true,
        allowed: false,
        used: 2,
      });
      for (const applicationId of ["application-refunded", "application-new"]) {
        await expect(meter.take({ workspaceId, applicationId, limit: 2 })).resolves.toEqual({
          credited: false,
        });
        await expect(meter.used({ workspaceId, applicationId })).resolves.toBe(0);
      }
      // Another tenant sees neither the credit nor the count.
      const south = tenancy.forTenant("org-south").prepareCalls;
      await expect(south.take({ ...paid, limit: 2 })).resolves.toEqual({ credited: false });
    } finally {
      await tenancy.close();
      await schema.drop();
    }
  });
});
