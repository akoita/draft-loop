import {
  type CandidateRecordAccess,
  CandidateRecordAccessError,
  type CandidateRecordAssignment,
  requireAssignedMemberId,
  requireCandidateRecordId,
} from "@draft-loop/storage/candidate-records";
import type { SqlExecutor, SqlRow, SqlSession } from "./sql-client.js";

const assignmentColumns = "workspace_id, member_id, assigned_at";

function assignment(row: SqlRow): CandidateRecordAssignment {
  const assignedAt =
    row.assigned_at instanceof Date ? row.assigned_at : new Date(String(row.assigned_at));
  return {
    workspaceId: String(row.workspace_id),
    memberId: String(row.member_id),
    assignedAt: assignedAt.toISOString(),
  };
}

function memberNotFound(): CandidateRecordAccessError {
  return new CandidateRecordAccessError("member_not_found", "The organisation has no such member.");
}

async function requireMember(executor: SqlExecutor, memberId: string): Promise<void> {
  const found = await executor.query("SELECT 1 FROM organisation_members WHERE id = $1", [
    memberId,
  ]);
  if (found.length === 0) throw memberNotFound();
}

/** Maps the member foreign key the insert lost to a concurrent removal onto the port's refusal. */
function foreignKeyRefusal(error: unknown): CandidateRecordAccessError | undefined {
  const failure = error as { code?: unknown; constraint?: unknown } | null;
  if (failure?.code !== "23503") return undefined;
  if (failure.constraint === "candidate_record_assignments_member") return memberNotFound();
  return undefined;
}

/**
 * One tenant's candidate record assignments on Postgres (ADR 0011, D6). Every transaction sets
 * the tenant, so row-level security confines records, members and assignments to it.
 */
export function createCandidateRecordAccess(client: SqlSession): CandidateRecordAccess {
  return {
    assignMember: async (input) => {
      const workspaceId = requireCandidateRecordId(input.workspaceId);
      const memberId = requireAssignedMemberId(input.memberId);
      try {
        return await client.transaction(async (executor) => {
          await requireMember(executor, memberId);
          const [inserted] = await executor.query(
            `INSERT INTO candidate_record_assignments (workspace_id, member_id) VALUES ($1, $2)
             ON CONFLICT (tenant_id, workspace_id, member_id) DO NOTHING
             RETURNING ${assignmentColumns}`,
            [workspaceId, memberId],
          );
          const [row] =
            inserted === undefined
              ? await executor.query(
                  `SELECT ${assignmentColumns} FROM candidate_record_assignments
                   WHERE workspace_id = $1 AND member_id = $2`,
                  [workspaceId, memberId],
                )
              : [inserted];
          if (row === undefined) throw new Error("The assignment was not recorded");
          return assignment(row);
        });
      } catch (error) {
        throw foreignKeyRefusal(error) ?? error;
      }
    },

    unassignMember: async (input) => {
      const workspaceId = requireCandidateRecordId(input.workspaceId);
      const memberId = requireAssignedMemberId(input.memberId);
      const removed = await client.transaction((executor) =>
        executor.query(
          `DELETE FROM candidate_record_assignments WHERE workspace_id = $1 AND member_id = $2
           RETURNING member_id`,
          [workspaceId, memberId],
        ),
      );
      return removed.length > 0;
    },

    listRecordMembers: async (workspaceId) => {
      const id = requireCandidateRecordId(workspaceId);
      return client.transaction(
        async (executor) => {
          const rows = await executor.query(
            `SELECT ${assignmentColumns} FROM candidate_record_assignments
             WHERE workspace_id = $1 ORDER BY assigned_at, member_id`,
            [id],
          );
          return rows.map(assignment);
        },
        { readOnlySnapshot: true },
      );
    },

    listMemberRecords: async (memberId) => {
      const id = requireAssignedMemberId(memberId);
      return client.transaction(
        async (executor) => {
          await requireMember(executor, id);
          const rows = await executor.query(
            `SELECT ${assignmentColumns} FROM candidate_record_assignments
             WHERE member_id = $1 ORDER BY assigned_at, workspace_id`,
            [id],
          );
          return rows.map(assignment);
        },
        { readOnlySnapshot: true },
      );
    },

    // A record is created through the API as the hosted workspace reference's configuration,
    // `/tenants/<tenant>/workspaces/<id>`; its `workspaces` history row comes later, if ever.
    listRecords: async () => {
      const rows = await client.query(
        `SELECT substr(workspace_ref, length(prefix) + 1) AS workspace_id
         FROM workspace_settings,
           LATERAL (SELECT '/tenants/' || current_setting('draft_loop.tenant_id', true)
             || '/workspaces/' AS prefix) AS reference
         WHERE name = 'workspace.json' AND starts_with(workspace_ref, prefix)
           AND strpos(substr(workspace_ref, length(prefix) + 1), '/') = 0
         ORDER BY workspace_id`,
      );
      return rows.map((row) => String(row.workspace_id));
    },
  };
}
