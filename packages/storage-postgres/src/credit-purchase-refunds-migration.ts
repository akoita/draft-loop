import type { PostgresMigration } from "./migrations.js";

/**
 * A refund on a credit pack purchase (#2710). The purchase row gains the time of the refund, the
 * provider's id of the event that reported it and the unspent credits that left the balance.
 * The ledger treats the purchase's grant as expired from `refunded_at`, so its unspent credits
 * are forfeited the way expired ones are and a balance never goes below zero.
 */
export const creditPurchaseRefundsMigration: PostgresMigration = {
  version: 45,
  name: "credit pack purchase refunds",
  sql: `
    ALTER TABLE credit_purchases
      ADD COLUMN refunded_at TIMESTAMPTZ,
      ADD COLUMN refund_event_id TEXT CHECK (refund_event_id ~ '^[A-Za-z0-9_]{1,255}$'),
      ADD COLUMN credits_taken_back INTEGER CHECK (credits_taken_back >= 0),
      ADD CONSTRAINT credit_purchases_refund_complete CHECK (
        (refunded_at IS NULL) = (refund_event_id IS NULL)
        AND (refunded_at IS NULL) = (credits_taken_back IS NULL)
      );
    CREATE INDEX credit_purchases_refunded_grant
      ON credit_purchases (tenant_id, grant_sequence) WHERE refunded_at IS NOT NULL;
  `,
};
