import { describe, expect, it } from "vitest";
import { CreditLedgerError } from "./credit-ledger.js";
import { createSqlPool } from "./sql-client.js";
import { createTestSchema, runtimeRoleUrl } from "./test-schema.js";

/** Set by the Postgres CI job and by developers with a local server; skipped without it. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const assignedAt = "2026-10-01T08:30:00.000Z";

type TestSchema = Awaited<ReturnType<typeof createTestSchema>>;
type Tenancy = Awaited<ReturnType<TestSchema["openTenancy"]>>;

interface Context extends TestSchema {
  readonly tenancy: Tenancy;
  /** A second pool with its own connections, as a second API replica or worker would be. */
  readonly replica: Tenancy;
  readonly ledger: (tenant?: string) => ReturnType<Tenancy["forTenant"]>["creditLedger"];
  readonly plans: (tenant?: string) => ReturnType<Tenancy["forTenant"]>["organisationPlans"];
  /** The tenant's ledger rows, oldest first, as the superuser sees them. */
  readonly rows: (tenant?: string) => Promise<LedgerRow[]>;
}

interface LedgerRow {
  readonly sequence: number;
  readonly kind: string;
  readonly amount: number;
  readonly bucket: string;
  readonly run_id: string | null;
  readonly grant_sequence: number | null;
  readonly period_start: string | null;
}

async function withLedger(work: (context: Context) => Promise<void>): Promise<void> {
  const schema = await createTestSchema(connectionString ?? "", "credit_ledger");
  const tenancy = await schema.openTenancy();
  const replica = await schema.openTenancy();
  try {
    for (const tenant of ["org-north", "org-south"]) {
      await schema.admin.query("INSERT INTO organisations (id, name) VALUES ($1, $2)", [
        tenant,
        `Fictional organisation ${tenant}`,
      ]);
    }
    await work({
      ...schema,
      tenancy,
      replica,
      ledger: (tenant = "org-north") => tenancy.forTenant(tenant).creditLedger,
      plans: (tenant = "org-north") => tenancy.forTenant(tenant).organisationPlans,
      rows: async (tenant = "org-north") =>
        (
          await schema.admin.query(
            `SELECT sequence, kind, amount, bucket, run_id, grant_sequence,
                    to_char(period_start, 'YYYY-MM-DD') AS period_start
               FROM credit_ledger WHERE tenant_id = $1 ORDER BY sequence`,
            [tenant],
          )
        ).map((row) => ({
          sequence: Number(row.sequence),
          kind: String(row.kind),
          amount: Number(row.amount),
          bucket: String(row.bucket),
          run_id: row.run_id === null ? null : String(row.run_id),
          grant_sequence: row.grant_sequence === null ? null : Number(row.grant_sequence),
          period_start: row.period_start === null ? null : String(row.period_start),
        })),
    });
  } finally {
    await replica.close();
    await tenancy.close();
    await schema.drop();
  }
}

/** The balance computed independently of the store: every grant less what was reserved, plus refunds, less expiries. */
async function ledgerRemaining(context: Context, tenant = "org-north"): Promise<number> {
  const rows = await context.rows(tenant);
  const total = (kind: string) =>
    rows.filter((row) => row.kind === kind).reduce((sum, row) => sum + row.amount, 0);
  return total("grant") - total("reserve") + total("refund") - total("expire");
}

const kinds = (rows: readonly LedgerRow[]) => rows.map((row) => row.kind);

const assignPro = (context: Context, periodStart = "2026-10-01") =>
  context.plans().assignPlan({ planId: "pro", periodStart, assignedAt });

describe.runIf(connectionString !== undefined)("Postgres credit ledger", () => {
  it("has no allowance without a plan assignment, and grants still work", async () => {
    await withLedger(async (context) => {
      const ledger = context.ledger();
      const none = {
        periodStart: null,
        periodEnd: null,
        allowance: 0,
        allowanceUsed: 0,
        reserved: 0,
        grantsRemaining: 0,
        remaining: 0,
        unlimited: false,
      };
      await expect(ledger.balance("2026-10-10T00:00:00.000Z")).resolves.toEqual(none);
      const refused = await ledger.reserve({
        runId: "run-1",
        credits: 1,
        estimateVersion: 1,
        now: "2026-10-10T00:00:00.000Z",
      });
      expect(refused).toEqual({ refused: "insufficient", balance: none });
      await expect(ledger.reservationFor("run-1")).resolves.toBeUndefined();
      expect(await context.rows()).toEqual([]);

      const grant = await ledger.grant({
        credits: 3,
        reason: "goodwill",
        now: "2026-10-10T00:00:00.000Z",
      });
      expect(grant).toMatchObject({ credits: 3, reason: "goodwill" });
      await expect(ledger.balance("2026-10-11T00:00:00.000Z")).resolves.toMatchObject({
        grantsRemaining: 3,
        remaining: 3,
        allowance: 0,
      });
      const reserved = await ledger.reserve({
        runId: "run-1",
        credits: 2,
        estimateVersion: 1,
        now: "2026-10-11T00:00:00.000Z",
      });
      expect(reserved).toMatchObject({
        refused: null,
        created: true,
        reservation: { runId: "run-1", credits: 2, fromAllowance: 0, fromGrants: 2, state: "open" },
      });
    });
  });

  it("grants the plan's allowance once per period and reports the balance", async () => {
    await withLedger(async (context) => {
      await assignPro(context);
      const ledger = context.ledger();
      const expected = {
        periodStart: "2026-10-01",
        periodEnd: "2026-11-01",
        allowance: 8,
        allowanceUsed: 0,
        reserved: 0,
        grantsRemaining: 0,
        remaining: 8,
        unlimited: false,
      };
      await expect(ledger.balance("2026-10-10T00:00:00.000Z")).resolves.toEqual(expected);
      await expect(ledger.balance("2026-10-31T23:59:59.000Z")).resolves.toEqual(expected);
      expect(kinds(await context.rows())).toEqual(["grant"]);

      await ledger.reserve({
        runId: "run-1",
        credits: 3,
        estimateVersion: 1,
        now: "2026-10-12T00:00:00.000Z",
      });
      await ledger.reserve({
        runId: "run-2",
        credits: 2,
        estimateVersion: 1,
        now: "2026-10-13T00:00:00.000Z",
      });
      await ledger.settle({ runId: "run-1", now: "2026-10-12T01:00:00.000Z" });
      await expect(ledger.balance("2026-10-14T00:00:00.000Z")).resolves.toEqual({
        ...expected,
        allowanceUsed: 3,
        reserved: 2,
        remaining: 3,
      });
      expect(await ledgerRemaining(context)).toBe(3);
      expect(kinds(await context.rows())).toEqual(["grant", "reserve", "reserve", "settle"]);
    });
  });

  it("rolls the period exactly once, however many callers meet it, and skips unvisited periods", async () => {
    await withLedger(async (context) => {
      await assignPro(context);
      const ledger = context.ledger();
      await ledger.reserve({
        runId: "run-1",
        credits: 3,
        estimateVersion: 1,
        now: "2026-10-12T00:00:00.000Z",
      });
      await ledger.settle({ runId: "run-1", now: "2026-10-12T01:00:00.000Z" });

      // Five callers on two pools meet the new period at once.
      const november = "2026-11-02T00:00:00.000Z";
      const balances = await Promise.all([
        ledger.balance(november),
        context.replica.forTenant("org-north").creditLedger.balance(november),
        ledger.balance(november),
        context.replica.forTenant("org-north").creditLedger.balance(november),
        ledger.balance(november),
      ]);
      for (const balance of balances) {
        expect(balance).toMatchObject({
          periodStart: "2026-11-01",
          allowance: 8,
          allowanceUsed: 0,
          remaining: 8,
        });
      }
      let rows = await context.rows();
      expect(rows.filter((row) => row.kind === "grant")).toHaveLength(2);
      const expired = rows.filter((row) => row.kind === "expire");
      expect(expired).toEqual([expect.objectContaining({ amount: 5, bucket: "allowance" })]);

      // Four months pass without a call: only the period in force is granted.
      await expect(ledger.balance("2027-03-10T00:00:00.000Z")).resolves.toMatchObject({
        periodStart: "2027-03-01",
        periodEnd: "2027-04-01",
        allowance: 8,
        remaining: 8,
      });
      await ledger.balance("2027-03-11T00:00:00.000Z");
      rows = await context.rows();
      expect(rows.filter((row) => row.kind === "grant").map((row) => row.period_start)).toEqual([
        "2026-10-01",
        "2026-11-01",
        "2027-03-01",
      ]);
      expect(rows.filter((row) => row.kind === "expire").map((row) => row.amount)).toEqual([5, 8]);
      expect(await ledgerRemaining(context)).toBe(8);
    });
  });

  it("measures a three-month plan's period from its start", async () => {
    await withLedger(async (context) => {
      await context.plans().assignPlan({
        planId: "job-search-pass",
        periodStart: "2026-10-01",
        assignedAt,
      });
      const ledger = context.ledger();
      await expect(ledger.balance("2026-12-31T00:00:00.000Z")).resolves.toMatchObject({
        periodStart: "2026-10-01",
        periodEnd: "2027-01-01",
        allowance: 12,
      });
      await expect(ledger.balance("2027-01-01T00:00:00.000Z")).resolves.toMatchObject({
        periodStart: "2027-01-01",
        periodEnd: "2027-04-01",
        allowance: 12,
      });
    });
  });

  it("forfeits the old allowance when a reassigned plan starts a new period early", async () => {
    await withLedger(async (context) => {
      await assignPro(context);
      const ledger = context.ledger();
      await ledger.balance("2026-10-05T00:00:00.000Z");
      await context.plans().assignPlan({
        planId: "business",
        overrides: { creditsPerPeriod: 20 },
        periodStart: "2026-10-15",
        assignedAt: "2026-10-15T09:00:00.000Z",
      });
      await expect(ledger.balance("2026-10-16T00:00:00.000Z")).resolves.toMatchObject({
        periodStart: "2026-10-15",
        periodEnd: "2026-11-15",
        allowance: 20,
        remaining: 20,
      });
      expect(await ledgerRemaining(context)).toBe(20);

      // A period that has not begun yet grants nothing.
      await context.plans().assignPlan({
        planId: "team",
        seats: 2,
        periodStart: "2026-12-01",
        assignedAt: "2026-10-16T09:00:00.000Z",
      });
      await expect(ledger.balance("2026-10-20T00:00:00.000Z")).resolves.toMatchObject({
        periodStart: null,
        allowance: 0,
      });
    });
  });

  it("expires the allowance at period end and operator grants after twelve months", async () => {
    await withLedger(async (context) => {
      await assignPro(context);
      const ledger = context.ledger();
      await ledger.grant({ credits: 5, reason: "pilot", now: "2026-10-02T12:00:00.000Z" });

      const lastDay = await ledger.balance("2027-09-30T23:59:59.000Z");
      expect(lastDay).toMatchObject({ grantsRemaining: 5 });
      // The grant outlasts the allowance period that was current when it was made.
      await expect(ledger.balance("2026-11-15T00:00:00.000Z")).resolves.toMatchObject({
        periodStart: "2026-11-01",
        remaining: 13,
        grantsRemaining: 5,
      });
      const afterExpiry = await ledger.balance("2027-10-02T12:00:00.000Z");
      expect(afterExpiry).toMatchObject({ grantsRemaining: 0, allowance: 8, remaining: 8 });
      const rows = await context.rows();
      expect(rows.filter((row) => row.kind === "expire" && row.bucket === "grant")).toEqual([
        expect.objectContaining({ amount: 5 }),
      ]);
      expect(await ledgerRemaining(context)).toBe(8);

      // An operator grant made on a leap day lasts until the end of the next February.
      const leap = await ledger.grant({
        credits: 1,
        reason: "leap",
        now: "2028-02-29T10:00:00.000Z",
      });
      expect(leap.expiresAt).toBe("2029-02-28T10:00:00.000Z");
    });
  });

  it("spends the allowance first, then the grant that expires first", async () => {
    await withLedger(async (context) => {
      await assignPro(context);
      const ledger = context.ledger();
      const later = await ledger.grant({
        credits: 4,
        reason: "later",
        now: "2026-10-05T00:00:00.000Z",
      });
      const earlier = await ledger.grant({
        credits: 5,
        reason: "earlier",
        now: "2026-10-02T00:00:00.000Z",
      });
      expect(earlier.expiresAt < later.expiresAt).toBe(true);

      const first = await ledger.reserve({
        runId: "run-1",
        credits: 11,
        estimateVersion: 1,
        now: "2026-10-06T00:00:00.000Z",
      });
      expect(first).toMatchObject({
        reservation: { credits: 11, fromAllowance: 8, fromGrants: 3 },
      });
      const second = await ledger.reserve({
        runId: "run-2",
        credits: 4,
        estimateVersion: 1,
        now: "2026-10-06T00:00:00.000Z",
      });
      expect(second).toMatchObject({ reservation: { fromAllowance: 0, fromGrants: 4 } });

      const reserves = (await context.rows()).filter((row) => row.kind === "reserve");
      expect(
        reserves.map((row) => [row.run_id, row.bucket, row.amount, row.grant_sequence]),
      ).toEqual([
        ["run-1", "allowance", 8, expect.any(Number)],
        ["run-1", "grant", 3, earlier.sequence],
        ["run-2", "grant", 2, earlier.sequence],
        ["run-2", "grant", 2, later.sequence],
      ]);
      await expect(ledger.balance("2026-10-06T00:00:00.000Z")).resolves.toMatchObject({
        reserved: 15,
        remaining: 2,
        grantsRemaining: 2,
      });
      // One more credit than is left is refused and writes nothing.
      const before = (await context.rows()).length;
      await expect(
        ledger.reserve({
          runId: "run-3",
          credits: 3,
          estimateVersion: 1,
          now: "2026-10-06T00:00:00.000Z",
        }),
      ).resolves.toMatchObject({ refused: "insufficient", balance: { remaining: 2 } });
      expect((await context.rows()).length).toBe(before);
    });
  });

  it("serves two concurrent reservations that the balance covers only once with one winner", async () => {
    await withLedger(async (context) => {
      await assignPro(context);
      const north = context.ledger();
      const replica = context.replica.forTenant("org-north").creditLedger;
      const now = "2026-10-10T00:00:00.000Z";
      await north.balance(now);

      const results = await Promise.all([
        north.reserve({ runId: "run-a", credits: 5, estimateVersion: 1, now }),
        replica.reserve({ runId: "run-b", credits: 5, estimateVersion: 1, now }),
      ]);
      expect(results.map((result) => result.refused).sort()).toEqual(["insufficient", null]);
      expect(await ledgerRemaining(context)).toBe(3);
      const reserves = (await context.rows()).filter((row) => row.kind === "reserve");
      expect(reserves).toHaveLength(1);

      // Many contenders for 3 remaining credits, one credit each, across both pools.
      const many = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          (index % 2 === 0 ? north : replica).reserve({
            runId: `run-${index}`,
            credits: 1,
            estimateVersion: 1,
            now,
          }),
        ),
      );
      expect(many.filter((result) => result.refused === null)).toHaveLength(3);
      expect(many.filter((result) => result.refused === "insufficient")).toHaveLength(5);
      await expect(north.balance(now)).resolves.toMatchObject({ remaining: 0, reserved: 8 });
      expect(await ledgerRemaining(context)).toBe(0);
    });
  });

  it("checks the run caps under the same lock as the reservation", async () => {
    await withLedger(async (context) => {
      await context.plans().assignPlan({
        planId: "business",
        overrides: { creditsPerPeriod: 100 },
        periodStart: "2026-10-01",
        assignedAt,
      });
      const north = context.ledger();
      const replica = context.replica.forTenant("org-north").creditLedger;
      const now = "2026-10-10T10:00:00.000Z";

      const racing = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          (index % 2 === 0 ? north : replica).reserve({
            runId: `run-${index}`,
            credits: 1,
            estimateVersion: 1,
            now,
            caps: { maxConcurrent: 2 },
          }),
        ),
      );
      expect(racing.filter((result) => result.refused === null)).toHaveLength(2);
      const refused = racing.filter((result) => result.refused === "run_cap");
      expect(refused).toHaveLength(4);
      expect(refused[0]).toMatchObject({
        refused: "run_cap",
        cap: "concurrent",
        limit: 2,
        count: 2,
        balance: { remaining: 98 },
      });
      await expect(north.openReservationCount()).resolves.toBe(2);

      // A settled run leaves the runs in flight; a refused one was never recorded.
      const open = racing.flatMap((result) => (result.refused === null ? [result] : []));
      const settled = open[0]?.reservation.runId ?? "";
      await north.settle({ runId: settled, now });
      await expect(north.openReservationCount()).resolves.toBe(1);
      await expect(
        north.reserve({
          runId: "run-late",
          credits: 1,
          estimateVersion: 1,
          now,
          caps: { maxConcurrent: 2 },
        }),
      ).resolves.toMatchObject({ refused: null, created: true });

      // Runs per UTC day count every reservation made that day, whatever became of it.
      await north.refund({ runId: "run-late", now });
      await expect(north.reservationsSince("2026-10-10T00:00:00.000Z")).resolves.toBe(3);
      await expect(north.reservationsSince("2026-10-10T10:00:01.000Z")).resolves.toBe(0);
      await expect(
        north.reserve({
          runId: "run-day",
          credits: 1,
          estimateVersion: 1,
          now,
          caps: { maxPerDay: 3 },
        }),
      ).resolves.toMatchObject({ refused: "run_cap", cap: "per_day", limit: 3, count: 3 });
      await expect(
        north.reserve({
          runId: "run-next-day",
          credits: 1,
          estimateVersion: 1,
          now: "2026-10-11T00:00:00.000Z",
          caps: { maxPerDay: 3 },
        }),
      ).resolves.toMatchObject({ refused: null });
      // A cap of null is no cap, and a retry of a reserved run is never refused by a cap.
      await expect(
        north.reserve({
          runId: "run-day-2",
          credits: 1,
          estimateVersion: 1,
          now,
          caps: { maxConcurrent: null, maxPerDay: null },
        }),
      ).resolves.toMatchObject({ refused: null });
      await expect(
        north.reserve({
          runId: settled,
          credits: 1,
          estimateVersion: 1,
          now,
          caps: { maxConcurrent: 0, maxPerDay: 0 },
        }),
      ).resolves.toMatchObject({ refused: null, created: false });
    });
  });

  it("reserves, settles and refunds each run once", async () => {
    await withLedger(async (context) => {
      await assignPro(context);
      const ledger = context.ledger();
      const now = "2026-10-10T00:00:00.000Z";
      const input = { runId: "run-1", credits: 3, estimateVersion: 1, now };

      const created = await ledger.reserve(input);
      expect(created).toMatchObject({ refused: null, created: true });
      // A second reserve for the run returns the existing one, whatever it now asks.
      const again = await ledger.reserve({ ...input, credits: 7, estimateVersion: 2 });
      expect(again).toEqual({
        refused: null,
        created: false,
        reservation: created.refused === null ? created.reservation : undefined,
      });
      expect(kinds(await context.rows())).toEqual(["grant", "reserve"]);

      const settled = await ledger.settle({ runId: "run-1", now: "2026-10-10T00:05:00.000Z" });
      expect(settled).toMatchObject({
        changed: true,
        reservation: { state: "settled", closedAt: "2026-10-10T00:05:00.000Z", credits: 3 },
      });
      const settledAgain = await ledger.settle({ runId: "run-1", now: "2026-10-10T00:06:00.000Z" });
      expect(settledAgain).toEqual({ changed: false, reservation: settled.reservation });
      // A settled reservation cannot be refunded, and a retried reserve still returns it.
      await expect(ledger.refund({ runId: "run-1", now })).resolves.toEqual({
        changed: false,
        reservation: settled.reservation,
      });
      await expect(ledger.reserve(input)).resolves.toMatchObject({
        created: false,
        reservation: { state: "settled" },
      });
      expect(kinds(await context.rows())).toEqual(["grant", "reserve", "settle"]);

      await ledger.reserve({ ...input, runId: "run-2", credits: 2 });
      const refunded = await ledger.refund({ runId: "run-2", now });
      expect(refunded).toMatchObject({ changed: true, reservation: { state: "refunded" } });
      await expect(ledger.refund({ runId: "run-2", now })).resolves.toEqual({
        changed: false,
        reservation: refunded.reservation,
      });
      await expect(ledger.settle({ runId: "run-2", now })).resolves.toEqual({
        changed: false,
        reservation: refunded.reservation,
      });
      await expect(ledger.reservationFor("run-2")).resolves.toEqual(refunded.reservation);

      // An unknown run has nothing to settle or refund.
      await expect(ledger.settle({ runId: "run-unknown", now })).resolves.toEqual({
        changed: false,
        reservation: undefined,
      });
      await expect(ledger.refund({ runId: "run-unknown", now })).resolves.toEqual({
        changed: false,
        reservation: undefined,
      });
      await expect(ledger.reservationFor("run-unknown")).resolves.toBeUndefined();
      // Settled credits stay spent, refunded ones are back.
      await expect(ledger.balance(now)).resolves.toMatchObject({
        allowanceUsed: 3,
        reserved: 0,
        remaining: 5,
      });
      expect(await ledgerRemaining(context)).toBe(5);
    });
  });

  it("returns a refund to the buckets that the reservation drew on", async () => {
    await withLedger(async (context) => {
      await assignPro(context);
      const ledger = context.ledger();
      const now = "2026-10-10T00:00:00.000Z";
      await ledger.grant({ credits: 5, reason: "goodwill", now });
      await ledger.reserve({ runId: "run-1", credits: 10, estimateVersion: 1, now });
      await expect(ledger.balance(now)).resolves.toMatchObject({
        reserved: 10,
        remaining: 3,
        grantsRemaining: 3,
      });
      await ledger.refund({ runId: "run-1", now });
      await expect(ledger.balance(now)).resolves.toMatchObject({
        allowance: 8,
        allowanceUsed: 0,
        reserved: 0,
        remaining: 13,
        grantsRemaining: 5,
      });
      const refunds = (await context.rows()).filter((row) => row.kind === "refund");
      expect(refunds.map((row) => [row.bucket, row.amount])).toEqual([
        ["allowance", 8],
        ["grant", 2],
      ]);
    });
  });

  it("never brings back credits that expired while a reservation was open", async () => {
    await withLedger(async (context) => {
      await assignPro(context);
      const ledger = context.ledger();
      await ledger.grant({ credits: 5, reason: "pilot", now: "2026-10-02T00:00:00.000Z" });
      await ledger.reserve({
        runId: "run-1",
        credits: 10,
        estimateVersion: 1,
        now: "2026-10-31T12:00:00.000Z",
      });
      await ledger.reserve({
        runId: "run-2",
        credits: 2,
        estimateVersion: 1,
        now: "2026-10-31T12:00:00.000Z",
      });
      // The period ends while both runs are in flight; their holds outlast the roll, and only
      // the grant's hold counts against the new period.
      await expect(ledger.balance("2026-11-02T00:00:00.000Z")).resolves.toMatchObject({
        periodStart: "2026-11-01",
        allowance: 8,
        allowanceUsed: 0,
        reserved: 4,
        grantsRemaining: 1,
        remaining: 9,
      });
      await expect(ledger.reservationFor("run-1")).resolves.toMatchObject({
        state: "open",
        fromAllowance: 8,
        fromGrants: 2,
      });

      const refunded = await ledger.refund({ runId: "run-1", now: "2026-11-03T00:00:00.000Z" });
      expect(refunded).toMatchObject({ changed: true, reservation: { state: "refunded" } });
      // The grant's credits return; the October allowance's do not, and the new allowance is untouched.
      await expect(ledger.balance("2026-11-03T00:00:00.000Z")).resolves.toMatchObject({
        allowance: 8,
        reserved: 2,
        grantsRemaining: 3,
        remaining: 11,
      });
      expect(await ledgerRemaining(context)).toBe(11);
      await ledger.settle({ runId: "run-2", now: "2026-11-03T00:00:00.000Z" });

      const rows = await context.rows();
      const refundIndex = rows.findIndex((row) => row.kind === "refund");
      expect(rows.slice(refundIndex).map((row) => [row.kind, row.bucket, row.amount])).toEqual([
        ["refund", "allowance", 8],
        ["refund", "grant", 2],
        ["expire", "allowance", 8],
        ["settle", "grant", 2],
      ]);

      // A grant that expires while a run holds it is forfeited on refund as well.
      const south = context.ledger("org-south");
      await south.grant({ credits: 3, reason: "short", now: "2026-10-01T00:00:00.000Z" });
      await south.reserve({
        runId: "run-s",
        credits: 3,
        estimateVersion: 1,
        now: "2027-09-30T00:00:00.000Z",
      });
      await south.refund({ runId: "run-s", now: "2027-10-02T00:00:00.000Z" });
      await expect(south.balance("2027-10-02T00:00:00.000Z")).resolves.toMatchObject({
        grantsRemaining: 0,
        remaining: 0,
        reserved: 0,
      });
      expect((await context.rows("org-south")).map((row) => [row.kind, row.amount])).toEqual([
        ["grant", 3],
        ["reserve", 3],
        ["refund", 3],
        ["expire", 3],
      ]);
    });
  });

  it("records every reservation of an unlimited plan and refuses none", async () => {
    await withLedger(async (context) => {
      await context
        .plans()
        .assignPlan({ planId: "internal", periodStart: "2026-10-01", assignedAt });
      const ledger = context.ledger();
      const now = "2026-10-10T00:00:00.000Z";
      const empty = await ledger.balance(now);
      expect(empty).toEqual({
        periodStart: "2026-10-01",
        periodEnd: "2026-11-01",
        allowance: 0,
        allowanceUsed: 0,
        reserved: 0,
        grantsRemaining: 0,
        remaining: 0,
        unlimited: true,
      });
      await expect(
        ledger.reserve({ runId: "run-1", credits: 500, estimateVersion: 1, now }),
      ).resolves.toMatchObject({
        refused: null,
        created: true,
        reservation: { credits: 500, fromAllowance: 500, state: "open" },
      });
      await ledger.reserve({ runId: "run-2", credits: 2, estimateVersion: 1, now });
      await ledger.settle({ runId: "run-1", now });
      await ledger.refund({ runId: "run-2", now });
      await expect(ledger.balance(now)).resolves.toMatchObject({
        unlimited: true,
        allowanceUsed: 500,
        reserved: 0,
      });
      await expect(ledger.reservationFor("run-2")).resolves.toMatchObject({ state: "refunded" });
      // No allowance rows exist, only the recorded reservations.
      expect(kinds(await context.rows())).toEqual(["reserve", "reserve", "settle", "refund"]);
      expect((await context.rows()).every((row) => row.grant_sequence === null)).toBe(true);
      // Caps the caller passes still apply: they come from the plan's limits, not its credits.
      await expect(
        ledger.reserve({
          runId: "run-3",
          credits: 1,
          estimateVersion: 1,
          now,
          caps: { maxConcurrent: 0 },
        }),
      ).resolves.toMatchObject({ refused: "run_cap" });
    });
  });

  it("rejects malformed requests without writing", async () => {
    await withLedger(async (context) => {
      await assignPro(context);
      const ledger = context.ledger();
      const now = "2026-10-10T00:00:00.000Z";
      const refusals = [
        () => ledger.reserve({ runId: "run-1", credits: 0, estimateVersion: 1, now }),
        () => ledger.reserve({ runId: "run-1", credits: 1.5, estimateVersion: 1, now }),
        () => ledger.reserve({ runId: "run-1", credits: -1, estimateVersion: 1, now }),
        () => ledger.reserve({ runId: "", credits: 1, estimateVersion: 1, now }),
        () => ledger.reserve({ runId: "run-1", credits: 1, estimateVersion: 0, now }),
        () => ledger.reserve({ runId: "run-1", credits: 1, estimateVersion: 1, now: "tomorrow" }),
        () =>
          ledger.reserve({
            runId: "run-1",
            credits: 1,
            estimateVersion: 1,
            now,
            caps: { maxConcurrent: -1 },
          }),
        () => ledger.grant({ credits: 0, reason: "goodwill", now }),
        () => ledger.grant({ credits: 1, reason: "Free text with spaces", now }),
        () => ledger.grant({ credits: 1, reason: "", now }),
        () => ledger.grant({ credits: 1, reason: "x".repeat(65), now }),
        () => ledger.settle({ runId: "", now }),
        () => ledger.balance("not a time"),
      ];
      for (const refusal of refusals) {
        await expect(refusal()).rejects.toBeInstanceOf(CreditLedgerError);
        await expect(refusal()).rejects.toMatchObject({ code: "invalid_credit_request" });
      }
      expect(await context.rows()).toEqual([]);
      await expect(
        ledger.grant({ credits: 1, reason: "x".repeat(64), now }),
      ).resolves.toMatchObject({ credits: 1 });
      await expect(context.ledger("org-missing").balance(now)).rejects.toMatchObject({
        code: "organisation_not_found",
      });
    });
  });

  it("keeps each tenant's ledger to itself and refuses changes to it", async () => {
    await withLedger(async (context) => {
      await assignPro(context);
      await context
        .plans("org-south")
        .assignPlan({ planId: "individual", periodStart: "2026-10-01", assignedAt });
      const north = context.ledger();
      const south = context.ledger("org-south");
      const now = "2026-10-10T00:00:00.000Z";
      await north.reserve({ runId: "run-1", credits: 2, estimateVersion: 1, now });
      await south.balance(now);

      await expect(south.reservationFor("run-1")).resolves.toBeUndefined();
      await expect(south.settle({ runId: "run-1", now })).resolves.toEqual({
        changed: false,
        reservation: undefined,
      });
      await expect(south.openReservationCount()).resolves.toBe(0);
      await expect(south.balance(now)).resolves.toMatchObject({ allowance: 4, reserved: 0 });
      await expect(north.balance(now)).resolves.toMatchObject({ allowance: 8, reserved: 2 });
      // The same run id may exist in two organisations.
      await expect(
        south.reserve({ runId: "run-1", credits: 1, estimateVersion: 1, now }),
      ).resolves.toMatchObject({ created: true, reservation: { credits: 1 } });

      const pool = createSqlPool({
        connectionString: runtimeRoleUrl(connectionString ?? ""),
        schema: context.schema,
      });
      try {
        const session = pool.forTenant("org-south");
        await expect(
          session.query("SELECT 1 FROM credit_ledger WHERE tenant_id = 'org-north'"),
        ).resolves.toEqual([]);
        await expect(
          session.query(
            `INSERT INTO credit_ledger (tenant_id, kind, amount, bucket, reason, expires_at)
             VALUES ('org-north', 'grant', 100, 'grant', 'sneaky', now() + interval '1 day')`,
          ),
        ).rejects.toThrow(/row-level security/u);
        await expect(
          session.query("SELECT 1 FROM credit_balances WHERE tenant_id = 'org-north'"),
        ).resolves.toEqual([]);
        await expect(session.query("UPDATE credit_ledger SET amount = 1000")).rejects.toThrow(
          /permission denied/u,
        );
        await expect(session.query("DELETE FROM credit_ledger")).rejects.toThrow(
          /permission denied/u,
        );
        await expect(session.query("TRUNCATE credit_ledger")).rejects.toThrow(/permission denied/u);
      } finally {
        await pool.close();
      }
      // The owning role is refused too: the ledger is append-only.
      await expect(context.admin.query("UPDATE credit_ledger SET amount = 1000")).rejects.toThrow(
        /immutable/u,
      );
      await expect(context.admin.query("DELETE FROM credit_ledger")).rejects.toThrow(/immutable/u);
      // The table's checks hold the row shapes.
      await expect(
        context.admin.query(
          `INSERT INTO credit_ledger (tenant_id, kind, amount, bucket, run_id, grant_sequence, estimate_version)
           VALUES ('org-north', 'reserve', 1, 'grant', 'run-x', NULL, 1)`,
        ),
      ).rejects.toThrow(/check constraint/u);
      await expect(
        context.admin.query(
          `INSERT INTO credit_ledger (tenant_id, kind, amount, bucket, reason, expires_at)
           VALUES ('org-north', 'grant', 1, 'grant', 'Free text', now())`,
        ),
      ).rejects.toThrow(/check constraint/u);
      await expect(
        context.admin.query(
          `INSERT INTO credit_ledger (tenant_id, kind, amount, bucket, run_id, estimate_version, grant_sequence)
           SELECT 'org-north', 'reserve', 1, 'allowance', 'run-1', 1, grant_sequence
             FROM credit_ledger WHERE run_id = 'run-1' AND tenant_id = 'org-north'`,
        ),
      ).rejects.toThrow(/duplicate key/u);
    });
  });

  it("removes an erased organisation's ledger and keeps the others'", async () => {
    await withLedger(async (context) => {
      await assignPro(context);
      await context
        .plans("org-south")
        .assignPlan({ planId: "pro", periodStart: "2026-10-01", assignedAt });
      const now = "2026-10-10T00:00:00.000Z";
      for (const tenant of ["org-north", "org-south"]) {
        const ledger = context.ledger(tenant);
        await ledger.grant({ credits: 2, reason: "goodwill", now });
        await ledger.reserve({ runId: "run-1", credits: 3, estimateVersion: 1, now });
        await ledger.settle({ runId: "run-1", now });
      }
      const kept = await context.rows("org-south");
      expect(kept.length).toBeGreaterThan(0);

      const north = context.tenancy.forTenant("org-north");
      await north.organisationErasure.close();
      await expect(north.organisationErasure.eraseRemainder()).resolves.toMatchObject({
        rowsRemoved: expect.any(Number),
      });
      expect(await context.rows("org-north")).toEqual([]);
      await expect(
        context.admin.query("SELECT 1 FROM credit_balances WHERE tenant_id = 'org-north'"),
      ).resolves.toEqual([]);
      await expect(context.rows("org-south")).resolves.toEqual(kept);
      await expect(context.ledger("org-south").reservationFor("run-1")).resolves.toMatchObject({
        state: "settled",
      });
    });
  });
  it("lists the open reservations made before a time, oldest first, for one organisation", async () => {
    await withLedger(async (context) => {
      await context
        .plans("org-south")
        .assignPlan({ planId: "individual", periodStart: "2026-10-01", assignedAt });
      await context.plans().assignPlan({ planId: "pro", periodStart: "2026-10-01", assignedAt });
      const north = context.ledger();
      const reserve = (runId: string, now: string) =>
        north.reserve({ runId, credits: 1, estimateVersion: 1, now });
      await reserve("run-old", "2026-10-10T08:00:00.000Z");
      await reserve("run-settled", "2026-10-10T08:30:00.000Z");
      await reserve("run-refunded", "2026-10-10T08:45:00.000Z");
      await reserve("run-older", "2026-10-10T07:00:00.000Z");
      await reserve("run-recent", "2026-10-10T09:30:00.000Z");
      await north.settle({ runId: "run-settled", now: "2026-10-10T08:31:00.000Z" });
      await north.refund({ runId: "run-refunded", now: "2026-10-10T08:46:00.000Z" });
      await context.ledger("org-south").reserve({
        runId: "run-south",
        credits: 1,
        estimateVersion: 1,
        now: "2026-10-10T06:00:00Z",
      });

      const before = "2026-10-10T09:00:00.000Z";
      const stale = await north.openReservationsBefore({ reservedBefore: before, limit: 10 });
      expect(stale.map((reservation) => reservation.runId)).toEqual(["run-older", "run-old"]);
      expect(stale[0]).toMatchObject({ state: "open", credits: 1, estimateVersion: 1 });
      await expect(
        north.openReservationsBefore({ reservedBefore: before, limit: 1 }),
      ).resolves.toHaveLength(1);
      await expect(
        north.openReservationsBefore({ reservedBefore: "2026-10-10T07:00:00.000Z", limit: 10 }),
      ).resolves.toEqual([]);
      await expect(
        north.openReservationsBefore({ reservedBefore: before, limit: 0 }),
      ).rejects.toMatchObject({ code: "invalid_credit_request" });
    });
  });
});
