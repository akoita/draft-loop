import type { PostgresMigration } from "./migrations.js";

/**
 * Organisations and their members (ADR 0011, D6): the cross-tenant directory that resolves a
 * sign-in to its tenant.
 *
 * - Both tables use row-level security like every other table, so the runtime role reads and
 *   changes only the members of the tenant its transaction sets.
 * - Resolving a sign-in is the one cross-tenant read. It goes through
 *   `resolve_member_sign_in`, a `SECURITY DEFINER` function owned by the migrating role, with a
 *   fixed search path and schema-qualified names. Only that owner has a policy over every
 *   member row, and the runtime role may only execute the function.
 * - A member's identity (issuer, subject) is unique across the service: a person belongs to one
 *   organisation in this phase.
 */
export const tenantDirectoryMigration: PostgresMigration = {
  version: 13,
  name: "organisations and their members",
  sql: `
    CREATE TABLE organisations (
      id TEXT PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200 AND name = btrim(name)),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE organisations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE organisations FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON organisations
      USING (id = current_setting('draft_loop.tenant_id', true))
      WITH CHECK (id = current_setting('draft_loop.tenant_id', true));

    -- An invited member has no identity yet; signing in with the invited, verified email binds
    -- the issuer and subject and makes the member active. Removing a member deletes the row.
    CREATE TABLE organisation_members (
      tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
        REFERENCES organisations (id) ON DELETE CASCADE,
      id TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 128),
      email TEXT NOT NULL
        CHECK (email = lower(btrim(email)) AND length(email) <= 320 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
      role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
      status TEXT NOT NULL CHECK (status IN ('invited', 'active')),
      issuer TEXT CHECK (length(issuer) BETWEEN 1 AND 2048),
      subject TEXT CHECK (length(subject) BETWEEN 1 AND 1024),
      invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      activated_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, id),
      UNIQUE (tenant_id, email),
      CHECK (
        (status = 'invited' AND issuer IS NULL AND subject IS NULL AND activated_at IS NULL)
        OR (status = 'active' AND issuer IS NOT NULL AND subject IS NOT NULL
          AND activated_at IS NOT NULL)
      )
    );
    CREATE UNIQUE INDEX organisation_members_identity
      ON organisation_members (issuer, subject) WHERE status = 'active';
    CREATE INDEX organisation_members_pending_email
      ON organisation_members (email, invited_at) WHERE status = 'invited';
    ALTER TABLE organisation_members ENABLE ROW LEVEL SECURITY;
    ALTER TABLE organisation_members FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON organisation_members
      USING (tenant_id = current_setting('draft_loop.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('draft_loop.tenant_id', true));

    DO $migration$
    BEGIN
      -- The migrating role owns the sign-in function, which reads across tenants as that role.
      EXECUTE format(
        'CREATE POLICY sign_in_resolution ON organisation_members TO %I USING (true) WITH CHECK (true)',
        current_user
      );
      -- An active member by identity, else the oldest pending invite for the verified email,
      -- claimed in one statement. A concurrent first sign-in by the same person loses the claim
      -- or the identity's unique index, and then finds the member the other one bound.
      EXECUTE format($template$
        CREATE FUNCTION %1$I.resolve_member_sign_in(
          sign_in_issuer TEXT, sign_in_subject TEXT, verified_email TEXT
        ) RETURNS TABLE (organisation_id TEXT, member_id TEXT, member_role TEXT)
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = %1$I, pg_temp
        AS $function$
        DECLARE
          claimed_tenant TEXT;
          claimed_id TEXT;
          claimed_role TEXT;
        BEGIN
          IF coalesce(sign_in_issuer, '') = '' OR coalesce(sign_in_subject, '') = '' THEN
            RETURN;
          END IF;
          RETURN QUERY SELECT m.tenant_id, m.id, m.role FROM %1$I.organisation_members m
            WHERE m.status = 'active' AND m.issuer = sign_in_issuer AND m.subject = sign_in_subject;
          IF FOUND THEN
            RETURN;
          END IF;
          IF coalesce(verified_email, '') = '' OR verified_email <> lower(btrim(verified_email)) THEN
            RETURN;
          END IF;
          BEGIN
            UPDATE %1$I.organisation_members m
              SET status = 'active', issuer = sign_in_issuer, subject = sign_in_subject,
                  activated_at = now(), updated_at = now()
              WHERE m.status = 'invited'
                AND (m.tenant_id, m.id) = (
                  SELECT i.tenant_id, i.id FROM %1$I.organisation_members i
                  WHERE i.status = 'invited' AND i.email = verified_email
                  ORDER BY i.invited_at, i.tenant_id, i.id
                  LIMIT 1
                )
              RETURNING m.tenant_id, m.id, m.role INTO claimed_tenant, claimed_id, claimed_role;
          EXCEPTION WHEN unique_violation THEN
            claimed_tenant := NULL;
          END;
          IF claimed_tenant IS NOT NULL THEN
            RETURN QUERY SELECT claimed_tenant, claimed_id, claimed_role;
            RETURN;
          END IF;
          RETURN QUERY SELECT m.tenant_id, m.id, m.role FROM %1$I.organisation_members m
            WHERE m.status = 'active' AND m.issuer = sign_in_issuer AND m.subject = sign_in_subject;
        END;
        $function$
      $template$, current_schema());
      EXECUTE format(
        'REVOKE ALL ON FUNCTION %I.resolve_member_sign_in(TEXT, TEXT, TEXT) FROM PUBLIC',
        current_schema()
      );
    END
    $migration$;
  `,
};

/** Lets the runtime role resolve sign-ins through the directory's one cross-tenant function. */
export function tenantDirectoryGrant(schema: string, role: string): string {
  return `GRANT EXECUTE ON FUNCTION ${schema}.resolve_member_sign_in(TEXT, TEXT, TEXT) TO ${role}`;
}
