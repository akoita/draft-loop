import type { PostgresMigration } from "./migrations.js";

/**
 * Closing an organisation before it is erased (ADR 0011, D7): `closing_at` marks an organisation
 * whose deletion has begun, so the API refuses its members while the deletion runs. The runtime
 * role may set the mark once but never change or clear it, so a closing organisation never reopens;
 * `erase_tenant_remainder` deletes the row with it.
 */
export const organisationClosingMigration: PostgresMigration = {
  version: 19,
  name: "organisation closing mark",
  sql: `
    ALTER TABLE organisations ADD COLUMN closing_at TIMESTAMPTZ;

    CREATE FUNCTION keep_organisation_closing() RETURNS trigger
    LANGUAGE plpgsql AS $function$
    BEGIN
      IF OLD.closing_at IS NOT NULL AND NEW.closing_at IS DISTINCT FROM OLD.closing_at THEN
        RAISE EXCEPTION 'a closing organisation never reopens';
      END IF;
      RETURN NEW;
    END;
    $function$;
    CREATE TRIGGER organisations_closing_is_final
      BEFORE UPDATE ON organisations
      FOR EACH ROW EXECUTE FUNCTION keep_organisation_closing();
  `,
};
