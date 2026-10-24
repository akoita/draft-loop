import type { PostgresTenancy } from "@draft-loop/storage-postgres";

/**
 * Gives a test organisation the unlimited `internal` plan, so sign-in mode lets its runs start.
 * For tests that are not about plans; a test of the gate assigns the plan it needs itself.
 */
export async function assignInternalPlan(
  tenancy: PostgresTenancy,
  organisationId: string,
): Promise<void> {
  await tenancy.forTenant(organisationId).organisationPlans.assignPlan({
    planId: "internal",
    periodStart: "2026-01-01",
    assignedAt: "2026-01-01T00:00:00.000Z",
  });
}
