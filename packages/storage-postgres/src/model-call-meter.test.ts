import { describe, expect, it } from "vitest";
import { createTestSchema } from "./test-schema.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const morning = new Date("2026-11-08T08:00:00.000Z");
const tomorrow = new Date("2026-11-09T00:00:01.000Z");

describe.runIf(connectionString !== undefined)("Postgres model call meter", () => {
  const url = connectionString ?? "";

  it("counts one tenant's calls per UTC day up to the limit, apart from another tenant", async () => {
    const schema = await createTestSchema(url, "model_call_meter");
    const tenancy = await schema.openTenancy();
    try {
      const north = tenancy.forTenant("org-north").modelCalls;
      const south = tenancy.forTenant("org-south").modelCalls;

      await expect(north.take({ limit: 2, now: morning })).resolves.toEqual({
        allowed: true,
        used: 1,
      });
      await expect(north.take({ limit: 2, now: morning })).resolves.toEqual({
        allowed: true,
        used: 2,
      });
      await expect(north.take({ limit: 2, now: morning })).resolves.toEqual({
        allowed: false,
        used: 2,
      });
      await expect(south.take({ limit: 2, now: morning })).resolves.toMatchObject({ used: 1 });
      await expect(north.take({ limit: 2, now: tomorrow })).resolves.toEqual({
        allowed: true,
        used: 1,
      });
      await expect(north.take({ limit: 0, now: tomorrow })).resolves.toEqual({
        allowed: false,
        used: 1,
      });

      // Erasing the organisation removes its counters and leaves the other tenant's.
      const erasure = tenancy.forTenant("org-north").organisationErasure;
      await erasure.eraseRemainder();
      await expect(north.used(morning)).resolves.toBe(0);
      await expect(south.used(morning)).resolves.toBe(1);
    } finally {
      await tenancy.close();
      await schema.drop();
    }
  });

  it("never passes the limit under concurrent takes", async () => {
    const schema = await createTestSchema(url, "model_call_meter");
    const tenancy = await schema.openTenancy();
    try {
      const meter = tenancy.forTenant("org-north").modelCalls;

      const results = await Promise.all(
        Array.from({ length: 8 }, () => meter.take({ limit: 3, now: morning })),
      );

      expect(results.filter((result) => result.allowed)).toHaveLength(3);
      await expect(meter.used(morning)).resolves.toBe(3);
    } finally {
      await tenancy.close();
      await schema.drop();
    }
  });
});
