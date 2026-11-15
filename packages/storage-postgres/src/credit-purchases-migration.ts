import type { PostgresMigration } from "./migrations.js";

/**
 * Credit pack purchases (#2709): one row per completed checkout, under the tenant's row-level
 * security. A row holds provider ids, the pack, numbers and dates, no buyer detail: the payment
 * provider is the seller and keeps the buyer's record. The checkout id is the key that makes a
 * repeated completion event grant nothing. `grant_sequence` names the ledger grant the purchase
 * made. Organisation erasure removes the rows.
 */
export const creditPurchasesMigration: PostgresMigration = {
  version: 43,
  name: "credit pack purchases",
  sql: `
    CREATE TABLE credit_purchases (
      tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
        CHECK (length(tenant_id) BETWEEN 1 AND 128),
      checkout_id TEXT NOT NULL CHECK (checkout_id ~ '^[A-Za-z0-9_]{1,255}$'),
      event_id TEXT NOT NULL CHECK (event_id ~ '^[A-Za-z0-9_]{1,255}$'),
      pack_id TEXT NOT NULL CHECK (pack_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
      credits INTEGER NOT NULL CHECK (credits > 0),
      amount_total_cents BIGINT CHECK (amount_total_cents >= 0),
      currency TEXT CHECK (currency ~ '^[a-z]{3}$'),
      grant_sequence BIGINT NOT NULL,
      purchased_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (tenant_id, checkout_id)
    );
    ALTER TABLE credit_purchases ENABLE ROW LEVEL SECURITY;
    ALTER TABLE credit_purchases FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON credit_purchases
      USING (tenant_id = current_setting('draft_loop.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('draft_loop.tenant_id', true));
  `,
};
