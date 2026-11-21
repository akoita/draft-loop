import type { SqlClient, SqlRow } from "./sql-client.js";
import { requireTenantId } from "./sql-client.js";

/** The funnel's steps, as the reporting module names them (#2834). */
export type UsageFunnelStepName =
  | "signedIn"
  | "evidence"
  | "briefReviewed"
  | "draftFinished"
  | "approved"
  | "exported"
  | "prepared";

/** One organisation's first time at each step and its activity since a date: times only. */
export interface OrganisationMilestonesRow {
  readonly memberSignIns: readonly string[];
  readonly firsts: Readonly<Record<UsageFunnelStepName, string | null>>;
  readonly activity: readonly string[];
}

/**
 * Reads for the content-free usage funnel (#2834): which organisations exist, and each one's
 * milestones, read inside that organisation under row-level security. Every value is a time;
 * no name, address, text or id beyond the organisation's own leaves these reads.
 */
export interface UsageFunnelReads {
  /** Organisations that were ever active, at most `limit`. */
  readonly organisations: (limit: number) => Promise<readonly string[]>;
  /** One organisation's milestones, with sign-ins and activity since `since`. */
  readonly milestones: (organisationId: string, since: Date) => Promise<OrganisationMilestonesRow>;
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const time = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(time.getTime()) ? null : time.toISOString();
}

function isoList(value: unknown): readonly string[] {
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((each: unknown) => {
    const time = iso(each);
    return time === null ? [] : [time];
  });
}

// Times stored as text are ISO 8601; the casts keep the comparisons in time, not in text.
const milestonesSql = `
  SELECT
    (SELECT coalesce(json_agg(activated_at ORDER BY activated_at), '[]'::json)
       FROM organisation_members WHERE activated_at >= $1) AS sign_ins,
    (SELECT min(activated_at) FROM organisation_members) AS signed_in,
    (SELECT min(created_at::timestamptz) FROM candidate_knowledge_sources) AS evidence,
    (SELECT min(reviewed_at::timestamptz) FROM opportunity_brief_versions
       WHERE reviewed_at IS NOT NULL) AS brief_reviewed,
    (SELECT min(updated_at::timestamptz) FROM run_snapshots
       WHERE state = 'awaiting-approval') AS draft_finished,
    (SELECT min(updated_at::timestamptz) FROM run_snapshots
       WHERE approval = 'approved') AS approved,
    (SELECT min(created_at::timestamptz) FROM exports WHERE status = 'completed') AS exported,
    (SELECT min(created_at::timestamptz) FROM application_material_drafts) AS prepared,
    (SELECT coalesce(json_agg(DISTINCT date_trunc('day', at)), '[]'::json) FROM (
       SELECT updated_at::timestamptz AS at FROM run_snapshots
       UNION ALL SELECT created_at::timestamptz FROM decisions
       UNION ALL SELECT created_at::timestamptz FROM exports
       UNION ALL SELECT created_at::timestamptz FROM candidate_knowledge_sources
     ) AS events WHERE at >= $1) AS activity`;

function milestonesRecord(row: SqlRow | undefined): OrganisationMilestonesRow {
  return {
    memberSignIns: isoList(row?.sign_ins),
    firsts: {
      signedIn: iso(row?.signed_in),
      evidence: iso(row?.evidence),
      briefReviewed: iso(row?.brief_reviewed),
      draftFinished: iso(row?.draft_finished),
      approved: iso(row?.approved),
      exported: iso(row?.exported),
      prepared: iso(row?.prepared),
    },
    activity: isoList(row?.activity),
  };
}

export function createUsageFunnelReads(client: SqlClient): UsageFunnelReads {
  return {
    organisations: async (limit) => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
        throw new Error("A limit must be a whole number from 1 to 1000.");
      }
      const rows = await client.query(
        "SELECT organisation_id FROM organisation_activity ORDER BY organisation_id LIMIT $1",
        [limit],
      );
      return rows.map((row) => String(row.organisation_id));
    },
    milestones: async (organisationId, since) => {
      const tenantId = requireTenantId(organisationId);
      if (Number.isNaN(since.getTime())) throw new Error("A date must be valid.");
      return client.transaction(async (executor) => {
        await executor.query("SELECT set_config('draft_loop.tenant_id', $1, true)", [tenantId]);
        const [row] = await executor.query(milestonesSql, [since.toISOString()]);
        return milestonesRecord(row);
      });
    },
  };
}
