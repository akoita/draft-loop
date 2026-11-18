import type { PostgresMigration } from "./migrations.js";

/**
 * Waitlist sign-ups confirm their address (double opt-in): a new entry waits, unconfirmed, until
 * its person opens the emailed link.
 *
 * - `confirmed_at` defaults to now, so rows the previous release inserts stay listed as before,
 *   and existing rows count as confirmed on the day they joined: nobody reconfirms.
 * - `confirm_token_hash` is the SHA-256 of the link's token; the plain token is only in the email.
 * - `confirm_sent_at` and `confirm_sends` space and cap the emails one address receives.
 * - `locale` is the screen language at joining, so the emails speak it.
 */
export const waitlistConfirmationMigration: PostgresMigration = {
  version: 58,
  name: "waitlist confirmation",
  sql: `
    ALTER TABLE beta_waitlist ADD COLUMN confirmed_at TIMESTAMPTZ DEFAULT now();
    UPDATE beta_waitlist SET confirmed_at = joined_at;
    ALTER TABLE beta_waitlist ADD COLUMN confirm_token_hash TEXT UNIQUE
      CHECK (confirm_token_hash IS NULL OR confirm_token_hash ~ '^[0-9a-f]{64}$');
    ALTER TABLE beta_waitlist ADD COLUMN confirm_sent_at TIMESTAMPTZ;
    ALTER TABLE beta_waitlist ADD COLUMN confirm_sends INTEGER NOT NULL DEFAULT 0
      CHECK (confirm_sends >= 0);
    ALTER TABLE beta_waitlist ADD COLUMN locale TEXT CHECK (locale IS NULL OR locale IN ('en', 'fr'));
    CREATE INDEX beta_waitlist_unconfirmed ON beta_waitlist (confirm_sent_at)
      WHERE confirmed_at IS NULL;
  `,
};
