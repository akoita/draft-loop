import type { PostgresMigration } from "./migrations.js";

/**
 * The public beta's invite codes (#2501): one row per single-use code, bound to one email.
 *
 * - Codes are stored as SHA-256 hashes; the plain code is shown once, when it is created.
 * - Rows belong to no tenant: an invite exists before its organisation does. The operator and
 *   the sign-up redemption read them across the deployment, so the policy is deployment-wide.
 *   They hold an email and ids only, never candidate material.
 * - A redeemed row names the organisation it created; the account cap counts redeemed rows.
 */
export const betaInvitesMigration: PostgresMigration = {
  version: 32,
  name: "beta invite codes",
  sql: `
    CREATE TABLE beta_invites (
      id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
      code_hash TEXT NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
      email TEXT NOT NULL
        CHECK (email = lower(btrim(email)) AND length(email) <= 320 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
      created_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      redeemed_at TIMESTAMPTZ,
      organisation_id TEXT CHECK (length(organisation_id) BETWEEN 1 AND 128),
      CHECK ((redeemed_at IS NULL) = (organisation_id IS NULL)),
      CHECK (revoked_at IS NULL OR redeemed_at IS NULL)
    );
    CREATE INDEX beta_invites_redeemed ON beta_invites (redeemed_at) WHERE redeemed_at IS NOT NULL;
    ALTER TABLE beta_invites ENABLE ROW LEVEL SECURITY;
    ALTER TABLE beta_invites FORCE ROW LEVEL SECURITY;
    CREATE POLICY deployment_wide ON beta_invites USING (true) WITH CHECK (true);
  `,
};
