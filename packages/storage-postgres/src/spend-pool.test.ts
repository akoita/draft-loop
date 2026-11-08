import { describe, expect, it } from "vitest";
import {
  readSpendPoolLimitUsd,
  type SpendPool,
  SpendPoolError,
  spendPoolMonth,
} from "./spend-pool.js";
import { createTestSchema } from "./test-schema.js";

/** Set by the Postgres CI job and by developers with a local server; skipped without it. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const november = new Date("2026-11-08T10:00:00.000Z");
const december = new Date("2026-12-01T00:00:00.000Z");

describe("spend pool month", () => {
  it("is the UTC month and refuses an invalid clock", () => {
    expect(spendPoolMonth(new Date("2026-11-30T23:59:59.999Z"))).toBe("2026-11");
    expect(spendPoolMonth(december)).toBe("2026-12");
    expect(() => spendPoolMonth(new Date("not a date"))).toThrow(SpendPoolError);
  });
});

describe("spend pool limit", () => {
  it("is unset without the variable and a positive amount with it", () => {
    expect(readSpendPoolLimitUsd({})).toBeUndefined();
    expect(readSpendPoolLimitUsd({ DRAFT_LOOP_SPEND_POOL_USD: " " })).toBeUndefined();
    expect(readSpendPoolLimitUsd({ DRAFT_LOOP_SPEND_POOL_USD: "40" })).toBe(40);
    for (const text of ["0", "-1", "forty", "Infinity", "2000000"]) {
      expect(() => readSpendPoolLimitUsd({ DRAFT_LOOP_SPEND_POOL_USD: text })).toThrow(
        SpendPoolError,
      );
    }
  });
});

describe.runIf(connectionString !== undefined)("Postgres spend pool", () => {
  async function withPool(
    work: (pools: {
      north: SpendPool;
      south: SpendPool;
      rows: () => Promise<readonly Record<string, unknown>[]>;
    }) => Promise<void>,
  ): Promise<void> {
    const schema = await createTestSchema(connectionString ?? "", "spend_pool");
    const tenancy = await schema.openTenancy();
    try {
      await work({
        north: tenancy.forTenant("org-north").spendPool,
        south: tenancy.forTenant("org-south").spendPool,
        rows: () =>
          schema.admin.query(
            "SELECT run_id, month, reserved_usd::float8 AS reserved, spent_usd::float8 AS spent FROM spend_pool_entries ORDER BY run_id",
          ),
      });
    } finally {
      await tenancy.close();
      await schema.drop();
    }
  }

  it("shares one ceiling across organisations and refuses the run that would pass it", async () => {
    await withPool(async ({ north, south, rows }) => {
      expect(await north.reserve({ runId: "run-a", usd: 1, limitUsd: 2.5, now: november })).toEqual(
        { refused: false, committedUsd: 1 },
      );
      expect(await south.reserve({ runId: "run-b", usd: 1, limitUsd: 2.5, now: november })).toEqual(
        { refused: false, committedUsd: 2 },
      );
      expect(await north.reserve({ runId: "run-c", usd: 1, limitUsd: 2.5, now: november })).toEqual(
        { refused: true, committedUsd: 2 },
      );
      expect((await rows()).map((row) => row.run_id)).toEqual(["run-a", "run-b"]);
    });
  });

  it("counts what a closed run cost instead of its reservation, once", async () => {
    await withPool(async ({ north, south, rows }) => {
      await north.reserve({ runId: "run-a", usd: 1, limitUsd: 2, now: november });
      await south.reserve({ runId: "run-b", usd: 1, limitUsd: 2, now: november });
      expect(await south.close({ runId: "run-b", usd: 0.25, now: november })).toBe(true);
      expect(await south.close({ runId: "run-b", usd: 0.75, now: november })).toBe(false);
      expect(await north.close({ runId: "run-unknown", usd: 0.5, now: november })).toBe(false);
      expect(await north.committed(november)).toBe(1.25);
      expect(
        await north.reserve({ runId: "run-c", usd: 0.75, limitUsd: 2, now: november }),
      ).toEqual({ refused: false, committedUsd: 2 });
      expect((await rows()).find((row) => row.run_id === "run-b")).toMatchObject({ spent: 0.25 });
    });
  });

  it("starts each UTC month empty and reserves a run once", async () => {
    await withPool(async ({ north }) => {
      await north.reserve({ runId: "run-a", usd: 2, limitUsd: 2, now: november });
      expect(await north.reserve({ runId: "run-a", usd: 2, limitUsd: 2, now: november })).toEqual({
        refused: false,
        committedUsd: 2,
      });
      expect(await north.reserve({ runId: "run-d", usd: 2, limitUsd: 2, now: december })).toEqual({
        refused: false,
        committedUsd: 2,
      });
      expect(await north.committed(november)).toBe(2);
    });
  });

  it("refuses amounts that are not positive and run ids out of range", async () => {
    await withPool(async ({ north }) => {
      await expect(
        north.reserve({ runId: "run-a", usd: 0, limitUsd: 2, now: november }),
      ).rejects.toThrow(SpendPoolError);
      await expect(
        north.reserve({ runId: "", usd: 1, limitUsd: 2, now: november }),
      ).rejects.toThrow(SpendPoolError);
      await expect(north.close({ runId: "run-a", usd: -1, now: november })).rejects.toThrow(
        SpendPoolError,
      );
    });
  });
});
