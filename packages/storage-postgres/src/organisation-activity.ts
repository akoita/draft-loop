import type { SqlSession } from "./sql-client.js";

/** How often one organisation's activity is written at most. */
export const organisationActivityIntervalMs = 60 * 60 * 1000;

export interface OrganisationActivityRow {
  readonly organisationId: string;
  /** ISO 8601 timestamps. */
  readonly lastActiveAt: string;
  readonly warnedAt: string | null;
}

/**
 * When each organisation was last active (#2538). Content-free: an organisation id and two
 * timestamps, read across the deployment by the retention job.
 */
export interface OrganisationActivity {
  /**
   * Records activity at `now`, unless the organisation's last write is within the interval. A
   * write also clears a pending inactivity warning. Resolves whether a row was written.
   */
  readonly touch: (organisationId: string, now: Date) => Promise<boolean>;
  /** The organisation's row, if it was ever active. */
  readonly read: (organisationId: string) => Promise<OrganisationActivityRow | undefined>;
  /** Organisations last active before `cutoff`, oldest first. */
  readonly inactiveSince: (
    cutoff: Date,
    limit: number,
  ) => Promise<readonly OrganisationActivityRow[]>;
  /** Records that the organisation's owners were warned at `now`. */
  readonly markWarned: (organisationId: string, now: Date) => Promise<void>;
}

export class OrganisationActivityError extends Error {
  override readonly name = "OrganisationActivityError";
}

function requireOrganisationId(organisationId: string): void {
  if (organisationId.length === 0 || organisationId.length > 128) {
    throw new OrganisationActivityError("An organisation id must have 1 to 128 characters.");
  }
}

function requireDate(now: Date): void {
  if (Number.isNaN(now.getTime())) {
    throw new OrganisationActivityError("An activity clock must be a valid date.");
  }
}

function iso(value: unknown): string {
  return (value instanceof Date ? value : new Date(String(value))).toISOString();
}

function activityRow(row: Record<string, unknown>): OrganisationActivityRow {
  return {
    organisationId: String(row.organisation_id),
    lastActiveAt: iso(row.last_active_at),
    warnedAt: row.warned_at === null || row.warned_at === undefined ? null : iso(row.warned_at),
  };
}

const columns = "organisation_id, last_active_at, warned_at";

export function createOrganisationActivity(client: SqlSession): OrganisationActivity {
  return {
    touch: async (organisationId, now) => {
      requireOrganisationId(organisationId);
      requireDate(now);
      const rows = await client.query(
        `INSERT INTO organisation_activity (organisation_id, last_active_at) VALUES ($1, $2)
         ON CONFLICT (organisation_id) DO UPDATE
           SET last_active_at = EXCLUDED.last_active_at, warned_at = NULL
           WHERE organisation_activity.last_active_at <= EXCLUDED.last_active_at - $3 * interval '1 millisecond'
         RETURNING organisation_id`,
        [organisationId, now.toISOString(), organisationActivityIntervalMs],
      );
      return rows.length > 0;
    },

    read: async (organisationId) => {
      requireOrganisationId(organisationId);
      const [row] = await client.query(
        `SELECT ${columns} FROM organisation_activity WHERE organisation_id = $1`,
        [organisationId],
      );
      return row === undefined ? undefined : activityRow(row);
    },

    inactiveSince: async (cutoff, limit) => {
      requireDate(cutoff);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
        throw new OrganisationActivityError("A limit must be a whole number from 1 to 1000.");
      }
      const rows = await client.query(
        `SELECT ${columns} FROM organisation_activity WHERE last_active_at < $1
         ORDER BY last_active_at, organisation_id LIMIT $2`,
        [cutoff.toISOString(), limit],
      );
      return rows.map(activityRow);
    },

    markWarned: async (organisationId, now) => {
      requireOrganisationId(organisationId);
      requireDate(now);
      await client.query(
        "UPDATE organisation_activity SET warned_at = $2 WHERE organisation_id = $1",
        [organisationId, now.toISOString()],
      );
    },
  };
}
