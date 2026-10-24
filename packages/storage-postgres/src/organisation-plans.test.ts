import { type EntitlementOverrides, resolveEntitlements } from "@draft-loop/schemas/entitlements";
import { describe, expect, it } from "vitest";
import { PlanAssignmentError } from "./organisation-plans.js";
import { createSqlPool } from "./sql-client.js";
import { createTestSchema, runtimeRoleUrl } from "./test-schema.js";

/** Set by the Postgres CI job and by developers with a local server; skipped without it. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const assignedAt = "2026-10-01T08:30:00.000Z";

async function withTenancy(
  work: (
    context: Awaited<ReturnType<typeof createTestSchema>> & {
      readonly tenancy: Awaited<
        ReturnType<Awaited<ReturnType<typeof createTestSchema>>["openTenancy"]>
      >;
    },
  ) => Promise<void>,
): Promise<void> {
  const schema = await createTestSchema(connectionString ?? "", "organisation_plans");
  const tenancy = await schema.openTenancy();
  try {
    for (const tenant of ["org-north", "org-south"]) {
      await schema.admin.query("INSERT INTO organisations (id, name) VALUES ($1, $2)", [
        tenant,
        `Fictional organisation ${tenant}`,
      ]);
    }
    await work({ ...schema, tenancy });
  } finally {
    await tenancy.close();
    await schema.drop();
  }
}

describe.runIf(connectionString !== undefined)("Postgres organisation plans", () => {
  it("has no assignment until the operator assigns one, then resolves its entitlements", async () => {
    await withTenancy(async ({ tenancy }) => {
      const plans = tenancy.forTenant("org-north").organisationPlans;
      await expect(plans.currentPlanAssignment()).resolves.toBeUndefined();
      await expect(plans.currentEntitlements()).resolves.toBeUndefined();
      await expect(plans.planAssignmentHistory()).resolves.toEqual([]);

      const stored = await plans.assignPlan({
        planId: "pro",
        periodStart: "2026-10-01",
        assignedAt,
      });
      expect(stored).toEqual({
        planId: "pro",
        catalogVersion: 1,
        overrides: {},
        seats: null,
        periodStart: "2026-10-01",
        assignedAt,
      });
      await expect(plans.currentPlanAssignment()).resolves.toEqual(stored);
      await expect(plans.currentEntitlements()).resolves.toEqual(resolveEntitlements("pro"));
    });
  });

  it("reassigns, keeps every assignment in order and scales a seat-priced plan by its seats", async () => {
    await withTenancy(async ({ tenancy }) => {
      const plans = tenancy.forTenant("org-north").organisationPlans;
      const first = await plans.assignPlan({
        planId: "individual",
        periodStart: "2026-09-15",
        assignedAt: "2026-09-15T09:00:00.000Z",
      });
      const second = await plans.assignPlan({
        planId: "team",
        seats: 3,
        periodStart: "2026-10-01",
        assignedAt,
      });
      const third = await plans.assignPlan({
        planId: "business",
        overrides: { creditsPerPeriod: 500 },
        periodStart: "2026-10-20",
        assignedAt: "2026-10-20T12:00:00.000Z",
      });

      await expect(plans.currentPlanAssignment()).resolves.toEqual(third);
      await expect(plans.planAssignmentHistory()).resolves.toEqual([first, second, third]);
      expect(second).toMatchObject({ planId: "team", seats: 3 });
      await expect(plans.currentEntitlements()).resolves.toMatchObject({ creditsPerPeriod: 500 });

      await plans.assignPlan({ planId: "team", seats: 4, periodStart: "2026-10-21", assignedAt });
      const entitlements = await plans.currentEntitlements();
      expect(entitlements?.seats).toBe(4);
      await expect(plans.planAssignmentHistory()).resolves.toHaveLength(4);
    });
  });

  it("round-trips overrides and refuses invalid ones, seats, plans and dates", async () => {
    await withTenancy(async ({ tenancy }) => {
      const plans = tenancy.forTenant("org-north").organisationPlans;
      const overrides: EntitlementOverrides = {
        creditsPerPeriod: null,
        modelTiers: ["economy", "premium"],
        features: { sso: true, byok: false },
        runsPerDay: 20,
      };
      const stored = await plans.assignPlan({
        planId: "business",
        overrides,
        periodStart: "2026-10-01",
        assignedAt,
      });
      expect(stored.overrides).toEqual(overrides);
      await expect(plans.currentPlanAssignment()).resolves.toEqual(stored);
      await expect(plans.currentEntitlements()).resolves.toMatchObject({
        creditsPerPeriod: null,
        runsPerDay: 20,
        features: { sso: true, byok: false },
      });

      const refused = [
        { planId: "pro", overrides: { unknownLimit: 1 } },
        { planId: "pro", overrides: { runsPerDay: -1 } },
        { planId: "pro", overrides: { modelTiers: [] } },
        { planId: "free" },
        { planId: "team" },
        { planId: "team", seats: 0 },
        { planId: "pro", periodStart: "2026-02-30" },
        { planId: "pro", periodStart: "2026-10-01T00:00:00Z" },
        { planId: "pro", assignedAt: "not a time" },
      ];
      for (const input of refused) {
        await expect(
          plans.assignPlan({ periodStart: "2026-10-01", assignedAt, ...input } as never),
        ).rejects.toMatchObject({ name: "PlanAssignmentError", code: "invalid_plan_assignment" });
      }
      await expect(
        plans.assignPlan({ planId: "pro", periodStart: "x", assignedAt }),
      ).rejects.toBeInstanceOf(PlanAssignmentError);
      // Nothing refused reached the current row or the history.
      await expect(plans.currentPlanAssignment()).resolves.toEqual(stored);
      await expect(plans.planAssignmentHistory()).resolves.toEqual([stored]);
    });
  });

  it("refuses to read a stored assignment that no longer parses", async () => {
    await withTenancy(async ({ tenancy, admin }) => {
      await admin.query(
        `INSERT INTO organisation_plans (tenant_id, plan_id, catalog_version, overrides, period_start, assigned_at)
         VALUES ('org-north', 'pro', 1, '{"runsPerDay": -4}', '2026-10-01', $1)`,
        [assignedAt],
      );
      await expect(
        tenancy.forTenant("org-north").organisationPlans.currentPlanAssignment(),
      ).rejects.toMatchObject({ code: "stored_plan_invalid" });
    });
  });

  it("never shows or changes another tenant's assignment, and refuses an unknown organisation", async () => {
    await withTenancy(async ({ tenancy, admin, schema }) => {
      const north = tenancy.forTenant("org-north").organisationPlans;
      const south = tenancy.forTenant("org-south").organisationPlans;
      await north.assignPlan({ planId: "pro", periodStart: "2026-10-01", assignedAt });
      await expect(south.currentPlanAssignment()).resolves.toBeUndefined();
      await expect(south.planAssignmentHistory()).resolves.toEqual([]);

      const other = await south.assignPlan({
        planId: "job-search-pass",
        periodStart: "2026-10-05",
        assignedAt,
      });
      await expect(north.currentPlanAssignment()).resolves.toMatchObject({ planId: "pro" });
      await expect(south.currentPlanAssignment()).resolves.toEqual(other);

      // Row-level security binds even a statement that names the other tenant.
      const pool = createSqlPool({
        connectionString: runtimeRoleUrl(connectionString ?? ""),
        schema,
      });
      try {
        const session = pool.forTenant("org-south");
        await expect(
          session.query("SELECT 1 FROM organisation_plans WHERE tenant_id = 'org-north'"),
        ).resolves.toEqual([]);
        await expect(
          session.query(
            `INSERT INTO organisation_plans (tenant_id, plan_id, catalog_version, period_start, assigned_at)
             VALUES ('org-north', 'internal', 1, '2026-10-01', now())`,
          ),
        ).rejects.toThrow(/row-level security/u);
        await expect(
          session.query("UPDATE organisation_plan_history SET plan_id = 'internal'"),
        ).rejects.toThrow(/permission denied/u);
        await expect(session.query("DELETE FROM organisation_plan_history")).rejects.toThrow(
          /permission denied/u,
        );
      } finally {
        await pool.close();
      }
      // The owning role is refused too: the history is append-only.
      await expect(admin.query("DELETE FROM organisation_plan_history")).rejects.toThrow(
        /immutable/u,
      );

      await expect(
        tenancy
          .forTenant("org-missing")
          .organisationPlans.assignPlan({ planId: "pro", periodStart: "2026-10-01", assignedAt }),
      ).rejects.toMatchObject({ code: "organisation_not_found" });
    });
  });

  it("removes an erased organisation's assignment and history and keeps the others", async () => {
    await withTenancy(async ({ tenancy }) => {
      const north = tenancy.forTenant("org-north");
      const south = tenancy.forTenant("org-south");
      await north.organisationPlans.assignPlan({
        planId: "pro",
        periodStart: "2026-10-01",
        assignedAt,
      });
      await north.organisationPlans.assignPlan({
        planId: "team",
        seats: 2,
        periodStart: "2026-10-02",
        assignedAt,
      });
      const kept = await south.organisationPlans.assignPlan({
        planId: "pro",
        periodStart: "2026-10-01",
        assignedAt,
      });

      await north.organisationErasure.close();
      // Two plan rows, the current one and two history rows, then the organisation row itself.
      await expect(north.organisationErasure.eraseRemainder()).resolves.toMatchObject({
        rowsRemoved: expect.any(Number),
      });
      await expect(north.organisationPlans.currentPlanAssignment()).resolves.toBeUndefined();
      await expect(north.organisationPlans.planAssignmentHistory()).resolves.toEqual([]);
      await expect(south.organisationPlans.currentPlanAssignment()).resolves.toEqual(kept);
      await expect(south.organisationPlans.planAssignmentHistory()).resolves.toEqual([kept]);
    });
  });
});
