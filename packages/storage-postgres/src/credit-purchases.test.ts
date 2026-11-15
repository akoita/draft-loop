import { describe, expect, it } from "vitest";
import { createTestSchema } from "./test-schema.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const now = new Date("2026-11-15T08:00:00.000Z");
const purchase = {
  checkoutId: "cs_test_fictional1",
  eventId: "evt_fictional1",
  packId: "pack-5",
  credits: 5,
  validMonths: 12,
  amountTotalCents: 2200,
  currency: "eur",
  now,
};

describe.runIf(connectionString !== undefined)("Postgres credit purchases", () => {
  const url = connectionString ?? "";

  it("grants a purchase's credits once, apart from another organisation", async () => {
    const schema = await createTestSchema(url, "credit_purchases");
    const tenancy = await schema.openTenancy();
    try {
      await schema.admin.query(
        "INSERT INTO organisations (id, name) VALUES ('org-north', 'North'), ('org-south', 'South')",
      );
      const north = tenancy.forTenant("org-north");
      const south = tenancy.forTenant("org-south");

      const first = await north.creditPurchases.record(purchase);
      expect(first).toMatchObject({
        created: true,
        purchase: {
          checkoutId: "cs_test_fictional1",
          packId: "pack-5",
          credits: 5,
          amountTotalCents: 2200,
          currency: "eur",
          purchasedAt: now.toISOString(),
        },
      });
      await expect(north.creditLedger.balance(now)).resolves.toMatchObject({
        grantsRemaining: 5,
        remaining: 5,
      });

      // The same checkout again, as a repeated or racing event, grants nothing.
      const repeats = await Promise.all(
        Array.from({ length: 4 }, (_, index) =>
          north.creditPurchases.record({ ...purchase, eventId: `evt_repeat${index}` }),
        ),
      );
      expect(repeats.map((repeat) => repeat.created)).toEqual([false, false, false, false]);
      expect(repeats[0]?.purchase).toEqual(first.purchase);
      await expect(north.creditLedger.balance(now)).resolves.toMatchObject({ grantsRemaining: 5 });

      // The credits expire with the pack's validity.
      const afterExpiry = new Date("2027-11-15T08:00:01.000Z");
      await expect(north.creditLedger.balance(afterExpiry)).resolves.toMatchObject({
        grantsRemaining: 0,
      });

      await expect(south.creditPurchases.get(purchase.checkoutId)).resolves.toBeUndefined();
      await expect(south.creditLedger.balance(now)).resolves.toMatchObject({ grantsRemaining: 0 });
    } finally {
      await tenancy.close();
      await schema.drop();
    }
  });

  it("takes a refunded purchase's unspent credits back, once, and never below zero", async () => {
    const schema = await createTestSchema(url, "credit_purchases");
    const tenancy = await schema.openTenancy();
    try {
      await schema.admin.query(
        "INSERT INTO organisations (id, name) VALUES ('org-north', 'North')",
      );
      const { creditPurchases, creditLedger } = tenancy.forTenant("org-north");
      await creditPurchases.record(purchase);
      await creditPurchases.record({
        ...purchase,
        checkoutId: "cs_test_fictional2",
        eventId: "evt_fictional2",
        packId: "pack-1",
        credits: 1,
      });
      const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
      const run = (runId: string, minutes: number) =>
        creditLedger.reserve({ runId, credits: 1, estimateVersion: 1, now: at(minutes) });
      // One credit of the pack of 5 is spent and one is held by a run that is still open.
      await run("run-spent", 1);
      await creditLedger.settle({ runId: "run-spent", now: at(2) });
      await run("run-open", 3);
      await expect(creditLedger.balance(at(4))).resolves.toMatchObject({ remaining: 4 });

      const refund = { checkoutId: purchase.checkoutId, eventId: "evt_refund1", now: at(5) };
      const refunded = await creditPurchases.refund(refund);
      expect(refunded).toMatchObject({
        outcome: "refunded",
        purchase: { refundedAt: at(5).toISOString(), creditsTakenBack: 3 },
      });
      // Only the other purchase's credit is left; the spent credit stays spent.
      await expect(creditLedger.balance(at(6))).resolves.toMatchObject({
        grantsRemaining: 1,
        remaining: 1,
      });

      const repeated = await creditPurchases.refund({ ...refund, eventId: "evt_refund2" });
      expect(repeated).toMatchObject({
        outcome: "already_refunded",
        purchase: { refundedAt: at(5).toISOString(), creditsTakenBack: 3 },
      });

      // The open run gives its credit back: it belongs to the refunded purchase and is forfeited.
      await creditLedger.refund({ runId: "run-open", now: at(7) });
      await expect(creditLedger.balance(at(8))).resolves.toMatchObject({
        grantsRemaining: 1,
        remaining: 1,
      });
      await expect(creditPurchases.get(purchase.checkoutId)).resolves.toMatchObject({
        refundedAt: at(5).toISOString(),
      });
      await expect(
        creditPurchases.refund({ ...refund, checkoutId: "cs_test_unknown" }),
      ).resolves.toEqual({ outcome: "not_found" });
    } finally {
      await tenancy.close();
      await schema.drop();
    }
  });

  it("refuses an unknown organisation and a malformed purchase, storing nothing", async () => {
    const schema = await createTestSchema(url, "credit_purchases");
    const tenancy = await schema.openTenancy();
    try {
      const ghost = tenancy.forTenant("org-ghost").creditPurchases;
      await expect(ghost.record(purchase)).rejects.toMatchObject({
        code: "organisation_not_found",
      });
      await expect(ghost.get(purchase.checkoutId)).resolves.toBeUndefined();
      await expect(ghost.record({ ...purchase, credits: 0 })).rejects.toMatchObject({
        code: "invalid_purchase",
      });
      await expect(ghost.record({ ...purchase, checkoutId: "cs test" })).rejects.toMatchObject({
        code: "invalid_purchase",
      });
    } finally {
      await tenancy.close();
      await schema.drop();
    }
  });
});
