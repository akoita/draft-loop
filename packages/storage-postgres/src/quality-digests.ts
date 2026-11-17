import type { RunSpanAttributes, RunSpanName, RunSpanStatus } from "@draft-loop/domain/run-span";

import type { PostgresSchemaOptions } from "./postgres-storage.js";
import { createSqlPool, requireTenantId } from "./sql-client.js";

/** One run span as the quality sweep reads it: no workspace, no times, no parent. */
export interface QualitySweepSpan {
  readonly runId: string;
  readonly name: RunSpanName;
  readonly status: RunSpanStatus | null;
  readonly attributes: RunSpanAttributes;
}

/**
 * The daily quality digests (#2916) and the cross-organisation reads that build them. Spans are
 * read one organisation at a time, as that organisation, so row-level security still applies.
 */
export interface QualityDigests {
  /** Claims a day's digest; true for the one caller that inserted the day's row. */
  readonly claimDay: (day: string, now: Date) => Promise<boolean>;
  readonly save: (day: string, digest: Readonly<Record<string, unknown>>) => Promise<void>;
  /** Organisations a member used since `since`, at most `limit`. */
  readonly organisationsActiveSince: (since: Date, limit: number) => Promise<readonly string[]>;
  /** One organisation's spans that started in [from, to). */
  readonly spansBetween: (
    organisationId: string,
    from: Date,
    to: Date,
  ) => Promise<readonly QualitySweepSpan[]>;
  readonly close: () => Promise<void>;
}

const dayPattern = /^\d{4}-\d{2}-\d{2}$/u;

function requireDay(day: string): string {
  if (!dayPattern.test(day)) throw new Error("A digest day is YYYY-MM-DD.");
  return day;
}

/** Opens a small pool for the sweep; the caller closes it. */
export function createPostgresQualityDigests(options: PostgresSchemaOptions): QualityDigests {
  const pool = createSqlPool({ ...options, maxConnections: options.maxConnections ?? 1 });
  return {
    claimDay: async (day, now) => {
      const rows = await pool.query(
        `INSERT INTO quality_digests (day, claimed_at) VALUES ($1, $2)
         ON CONFLICT (day) DO NOTHING RETURNING day`,
        [requireDay(day), now.toISOString()],
      );
      return rows.length === 1;
    },
    save: async (day, digest) => {
      await pool.query("UPDATE quality_digests SET digest = $2::jsonb WHERE day = $1", [
        requireDay(day),
        JSON.stringify(digest),
      ]);
    },
    organisationsActiveSince: async (since, limit) => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
        throw new Error("A limit must be a whole number from 1 to 1000.");
      }
      const rows = await pool.query(
        `SELECT organisation_id FROM organisation_activity WHERE last_active_at >= $1
         ORDER BY organisation_id LIMIT $2`,
        [since.toISOString(), limit],
      );
      return rows.map((row) => String(row.organisation_id));
    },
    spansBetween: async (organisationId, from, to) => {
      const rows = await pool.forTenant(requireTenantId(organisationId)).query(
        `SELECT run_id, name, status, attributes FROM run_spans
            WHERE started_at >= $1 AND started_at < $2`,
        [from.toISOString(), to.toISOString()],
      );
      return rows.map((row) => ({
        runId: String(row.run_id),
        name: String(row.name) as RunSpanName,
        status: row.status === null ? null : (String(row.status) as RunSpanStatus),
        attributes: (typeof row.attributes === "string"
          ? JSON.parse(row.attributes)
          : row.attributes) as RunSpanAttributes,
      }));
    },
    close: () => pool.close(),
  };
}
