import type { RunSpanAttributes, RunSpanName, RunSpanStatus } from "@draft-loop/domain/run-span";

import {
  type CoverLetterUseRow,
  readCoverLetterChecks,
  readCoverLetterUse,
} from "./cover-letter-digest.js";
import type { PostgresSchemaOptions } from "./postgres-storage.js";
import { createSqlPool, requireTenantId } from "./sql-client.js";

/** One run span as the quality sweep reads it: no workspace, no times, no parent. */
export interface QualitySweepSpan {
  readonly runId: string;
  readonly name: RunSpanName;
  readonly status: RunSpanStatus | null;
  readonly attributes: RunSpanAttributes;
  /** Milliseconds from start to end; `null` while the span is open. */
  readonly durationMs?: number | null;
}

/**
 * The daily quality digests (#2916) and the cross-organisation reads that build them. Spans are
 * read one organisation at a time, as that organisation, so row-level security still applies.
 */
export interface QualityDigests {
  /** Claims a day's digest; true for the one caller that inserted the day's row. */
  readonly claimDay: (day: string, now: Date) => Promise<boolean>;
  readonly save: (day: string, digest: Readonly<Record<string, unknown>>) => Promise<void>;
  /** The saved digests of the days in [from, to], oldest first, for the weekly quality trend. */
  readonly digestsBetween: (
    from: string,
    to: string,
  ) => Promise<readonly { readonly day: string; readonly digest: Record<string, unknown> }[]>;
  /** Organisations a member used since `since`, at most `limit`. */
  readonly organisationsActiveSince: (since: Date, limit: number) => Promise<readonly string[]>;
  /** One organisation's spans that started in [from, to). */
  readonly spansBetween: (
    organisationId: string,
    from: Date,
    to: Date,
  ) => Promise<readonly QualitySweepSpan[]>;
  /**
   * One organisation's member outcomes in [from, to) (#3245): decided findings, completed exports,
   * refunds and stopped runs, each with its run id only, and the models of those runs' evaluations.
   */
  readonly outcomesBetween: (
    organisationId: string,
    from: Date,
    to: Date,
  ) => Promise<QualityOutcomeRows>;
  /** How many feedback notes (not support tickets) members sent in [from, to), everywhere. */
  readonly feedbackNotesBetween: (from: Date, to: Date) => Promise<number>;
  /** One organisation's cover letter kits, full drafts and edited letters in [from, to) (#3282). */
  readonly coverLetterUseBetween: (
    organisationId: string,
    from: Date,
    to: Date,
  ) => Promise<CoverLetterUseRow>;
  /** How many letters Check my letter checked in [from, to), everywhere (#3282). */
  readonly coverLetterChecksBetween: (from: Date, to: Date) => Promise<number>;
  /** Every insight in the ledger (#2917), at most 1,000. */
  readonly listInsights: () => Promise<readonly QualityInsightRow[]>;
  /** Inserts or replaces each insight, in one transaction. */
  readonly saveInsights: (insights: readonly QualityInsightRow[]) => Promise<void>;
  readonly close: () => Promise<void>;
}

/** One ledger row; the same shape as the application's `QualityInsight`. */
export type QualityOutcomeKind =
  | "finding-accepted"
  | "finding-rejected"
  | "exported"
  | "refunded"
  | "stopped";

export interface QualityOutcomeRows {
  readonly events: readonly { readonly runId: string; readonly kind: QualityOutcomeKind }[];
  readonly runPairs: readonly {
    readonly runId: string;
    readonly authorModel: string;
    readonly criticModel: string;
  }[];
}

const outcomeKinds = new Set<string>([
  "finding-accepted",
  "finding-rejected",
  "exported",
  "refunded",
  "stopped",
]);

// Times stored as text are ISO 8601; the casts compare them as times.
const outcomesSql = `
  SELECT run_id, CASE type WHEN 'accept-finding' THEN 'finding-accepted' ELSE 'finding-rejected' END AS kind
    FROM decisions WHERE type IN ('accept-finding', 'reject-finding')
     AND created_at::timestamptz >= $1 AND created_at::timestamptz < $2
  UNION ALL
  SELECT run_id, 'exported' FROM exports
   WHERE status = 'completed' AND created_at::timestamptz >= $1 AND created_at::timestamptz < $2
  UNION ALL
  SELECT run_id, 'refunded' FROM credit_ledger
   WHERE kind = 'refund' AND created_at >= $1 AND created_at < $2
  UNION ALL
  SELECT DISTINCT run_id, 'stopped' FROM run_snapshots
   WHERE state IN ('stopped', 'budget-exhausted')
     AND updated_at::timestamptz >= $1 AND updated_at::timestamptz < $2
  LIMIT 5000`;

const modelText = (value: unknown): string =>
  typeof value === "string" && value !== "" ? value.slice(0, 200) : "unknown";

export interface QualityInsightRow {
  readonly key: string;
  readonly firstSeen: string;
  readonly lastSeen: string;
  readonly daysSeen: number;
  readonly occurrences: number;
  readonly runIds: readonly string[];
  readonly status: "new" | "recurring" | "resolved" | "dismissed";
  readonly issue: number | null;
}

const dayPattern = /^\d{4}-\d{2}-\d{2}$/u;

/** A span's duration from its stored ISO times; `null` when open or unreadable. */
export function spanDurationMs(startedAt: unknown, endedAt: unknown): number | null {
  if (endedAt === null || endedAt === undefined) return null;
  const ms = Date.parse(String(endedAt)) - Date.parse(String(startedAt));
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

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
    digestsBetween: async (from, to) => {
      const rows = await pool.query(
        `SELECT day, digest FROM quality_digests
            WHERE day >= $1 AND day <= $2 AND digest IS NOT NULL ORDER BY day LIMIT 31`,
        [requireDay(from), requireDay(to)],
      );
      return rows.map((row) => ({
        day: String(row.day),
        digest: (typeof row.digest === "string" ? JSON.parse(row.digest) : row.digest) as Record<
          string,
          unknown
        >,
      }));
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
    outcomesBetween: async (organisationId, from, to) => {
      const tenant = pool.forTenant(requireTenantId(organisationId));
      const rows = await tenant.query(outcomesSql, [from.toISOString(), to.toISOString()]);
      const events = rows.flatMap((row) => {
        const kind = String(row.kind);
        return outcomeKinds.has(kind)
          ? [{ runId: String(row.run_id), kind: kind as QualityOutcomeKind }]
          : [];
      });
      const runIds = [...new Set(events.map((event) => event.runId))];
      if (runIds.length === 0) return { events, runPairs: [] };
      const spans = await tenant.query(
        `SELECT DISTINCT ON (run_id) run_id, attributes FROM run_spans
          WHERE name = 'evaluate_run' AND run_id = ANY($1::text[])
          ORDER BY run_id, started_at DESC`,
        [runIds],
      );
      return {
        events,
        runPairs: spans.map((row) => {
          const attributes = (
            typeof row.attributes === "string" ? JSON.parse(row.attributes) : row.attributes
          ) as Record<string, unknown>;
          return {
            runId: String(row.run_id),
            authorModel: modelText(attributes["draftloop.quality.author_model"]),
            criticModel: modelText(attributes["gen_ai.request.model"]),
          };
        }),
      };
    },
    feedbackNotesBetween: async (from, to) => {
      const [row] = await pool.query(
        `SELECT count(*) AS total FROM feedback_notes
          WHERE kind = 'note' AND sent_at >= $1 AND sent_at < $2`,
        [from.toISOString(), to.toISOString()],
      );
      return Number(row?.total ?? 0);
    },
    coverLetterUseBetween: (organisationId, from, to) =>
      readCoverLetterUse(pool.forTenant(requireTenantId(organisationId)), from, to),
    coverLetterChecksBetween: (from, to) => readCoverLetterChecks(pool, from, to),
    spansBetween: async (organisationId, from, to) => {
      const rows = await pool.forTenant(requireTenantId(organisationId)).query(
        `SELECT run_id, name, status, attributes, started_at, ended_at FROM run_spans
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
        durationMs: spanDurationMs(row.started_at, row.ended_at),
      }));
    },
    listInsights: async () => {
      const rows = await pool.query(
        `SELECT key, first_seen, last_seen, days_seen, occurrences, run_ids, status, issue
           FROM quality_insights ORDER BY key LIMIT 1000`,
      );
      return rows.map((row) => ({
        key: String(row.key),
        firstSeen: String(row.first_seen),
        lastSeen: String(row.last_seen),
        daysSeen: Number(row.days_seen),
        occurrences: Number(row.occurrences),
        runIds: (typeof row.run_ids === "string"
          ? JSON.parse(row.run_ids)
          : row.run_ids) as string[],
        status: String(row.status) as QualityInsightRow["status"],
        issue: row.issue === null ? null : Number(row.issue),
      }));
    },
    saveInsights: async (insights) => {
      await pool.transaction(async (executor) => {
        for (const insight of insights) {
          await executor.query(
            `INSERT INTO quality_insights
               (key, first_seen, last_seen, days_seen, occurrences, run_ids, status, issue)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
             ON CONFLICT (key) DO UPDATE SET
               first_seen = EXCLUDED.first_seen, last_seen = EXCLUDED.last_seen,
               days_seen = EXCLUDED.days_seen, occurrences = EXCLUDED.occurrences,
               run_ids = EXCLUDED.run_ids, status = EXCLUDED.status, issue = EXCLUDED.issue`,
            [
              insight.key,
              requireDay(insight.firstSeen),
              requireDay(insight.lastSeen),
              insight.daysSeen,
              insight.occurrences,
              JSON.stringify(insight.runIds.slice(0, 3)),
              insight.status,
              insight.issue,
            ],
          );
        }
      });
    },
    close: () => pool.close(),
  };
}
