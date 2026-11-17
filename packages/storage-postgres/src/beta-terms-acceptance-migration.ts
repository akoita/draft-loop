import type { PostgresMigration } from "./migrations.js";

/**
 * The terms version a beta sign-up accepted (#2462), on the invite it redeemed: the same
 * transaction creates the account, so an account never exists without its accepted version.
 * Nullable, because invites redeemed before this migration accepted no recorded version.
 */
export const betaTermsAcceptanceMigration: PostgresMigration = {
  version: 55,
  name: "beta terms acceptance",
  sql: `
    ALTER TABLE beta_invites ADD COLUMN terms_version TEXT
      CHECK (terms_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
    ALTER TABLE beta_invites ADD CONSTRAINT beta_invites_terms_redeemed
      CHECK (terms_version IS NULL OR redeemed_at IS NOT NULL);
  `,
};
