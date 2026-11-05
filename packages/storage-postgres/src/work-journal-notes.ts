import type { WorkJournalStoredNote } from "@draft-loop/schemas/work-journal";
import {
  requireStoredWorkJournalNote,
  type WorkJournalNoteStore,
  WorkJournalStoreError,
} from "@draft-loop/storage/work-journal-notes";
import type { SqlSession } from "./sql-client.js";

function noteOf(row: Record<string, unknown>): WorkJournalStoredNote {
  const value = typeof row.note === "string" ? JSON.parse(row.note) : row.note;
  return requireStoredWorkJournalNote(value);
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "23505";
}

/** One tenant's work journal on Postgres; row-level security confines it to the tenant. */
export function createWorkJournalNoteStore(client: SqlSession): WorkJournalNoteStore {
  return {
    insert: async (input) => {
      const note = requireStoredWorkJournalNote(input);
      try {
        await client.query(
          `INSERT INTO work_journal_notes
             (id, workspace_id, status, dedupe_key, project, note, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
          [
            note.id,
            note.workspace_id,
            note.status,
            note.dedupe_key,
            note.content.project.name,
            JSON.stringify(note),
            note.created_at,
            note.updated_at,
          ],
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new WorkJournalStoreError("duplicate_key", "A note already holds this key.");
        }
        throw error;
      }
    },
    replace: async (input) => {
      const note = requireStoredWorkJournalNote(input);
      let rows: readonly Record<string, unknown>[];
      try {
        rows = await client.query(
          `UPDATE work_journal_notes
             SET status = $3, dedupe_key = $4, project = $5,
                 -- Creation time, tenant and filing agent token come from the stored note.
                 note = CASE WHEN note ? 'agent_token_id'
                   THEN jsonb_set(jsonb_set(jsonb_set($6::jsonb, '{created_at}', to_jsonb(created_at)),
                     '{tenant_id}', note -> 'tenant_id'), '{agent_token_id}', note -> 'agent_token_id')
                   ELSE jsonb_set(jsonb_set($6::jsonb, '{created_at}', to_jsonb(created_at)),
                     '{tenant_id}', note -> 'tenant_id') - 'agent_token_id'
                 END,
                 updated_at = $7
           WHERE workspace_id = $1 AND id = $2
           RETURNING id`,
          [
            note.workspace_id,
            note.id,
            note.status,
            note.dedupe_key,
            note.content.project.name,
            JSON.stringify(note),
            note.updated_at,
          ],
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new WorkJournalStoreError("duplicate_key", "A note already holds this key.");
        }
        throw error;
      }
      if (rows.length === 0) {
        throw new WorkJournalStoreError("note_not_found", "No such work journal note.");
      }
    },
    get: async (workspaceId, id) => {
      const [row] = await client.query(
        "SELECT note FROM work_journal_notes WHERE workspace_id = $1 AND id = $2",
        [workspaceId, id],
      );
      return row === undefined ? undefined : noteOf(row);
    },
    holderOfKey: async (key) => {
      const [row] = await client.query(
        `SELECT note FROM work_journal_notes WHERE dedupe_key = $1
         ORDER BY (status <> 'discarded') DESC, created_at DESC, id DESC LIMIT 1`,
        [key],
      );
      if (row !== undefined) return { kind: "note", note: noteOf(row) };
      const [forgotten] = await client.query(
        "SELECT note_id FROM work_journal_forgotten_keys WHERE dedupe_key = $1",
        [key],
      );
      return forgotten === undefined
        ? undefined
        : { kind: "forgotten", noteId: String(forgotten.note_id) };
    },
    list: async ({ workspaceId, status, project, since, agentTokenId, limit }) => {
      const rows = await client.query(
        `SELECT note FROM work_journal_notes
         WHERE workspace_id = $1
           AND ($2::text IS NULL OR status = $2)
           AND ($3::text IS NULL OR lower(project) = lower($3))
           AND ($4::text IS NULL OR created_at >= $4)
           AND ($6::text IS NULL OR note ->> 'agent_token_id' = $6
             OR COALESCE(note -> 'amended_by_agent_token_ids', '[]'::jsonb) ? $6)
         ORDER BY created_at DESC, id DESC
         LIMIT $5`,
        [workspaceId, status ?? null, project ?? null, since ?? null, limit, agentTokenId ?? null],
      );
      return rows.map(noteOf);
    },
    pending: async (workspaceId) => {
      const rows = await client.query(
        `SELECT note FROM work_journal_notes WHERE workspace_id = $1 AND status = 'pending'
         ORDER BY created_at DESC, id DESC LIMIT 500`,
        [workspaceId],
      );
      return rows.map(noteOf);
    },
    countCreatedSince: async (workspaceId, since) => {
      const [row] = await client.query(
        "SELECT count(*) AS count FROM work_journal_notes WHERE workspace_id = $1 AND created_at >= $2",
        [workspaceId, since],
      );
      return Number(row?.count ?? 0);
    },
    countPending: async () => {
      const [row] = await client.query(
        "SELECT count(*) AS count FROM work_journal_notes WHERE status = 'pending'",
      );
      return Number(row?.count ?? 0);
    },
    deletePending: async (workspaceId) => {
      const rows = await client.query(
        "DELETE FROM work_journal_notes WHERE workspace_id = $1 AND status = 'pending' RETURNING id",
        [workspaceId],
      );
      return rows.length;
    },
    forgetDiscarded: async (before) =>
      client.transaction(async (executor) => {
        const rows = await executor.query(
          `DELETE FROM work_journal_notes WHERE status = 'discarded' AND updated_at < $1
           RETURNING id, workspace_id, dedupe_key`,
          [before],
        );
        for (const row of rows) {
          await executor.query(
            `INSERT INTO work_journal_forgotten_keys (dedupe_key, note_id, workspace_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (tenant_id, dedupe_key) DO UPDATE SET note_id = EXCLUDED.note_id`,
            [row.dedupe_key, row.id, row.workspace_id],
          );
        }
        return rows.length;
      }),
    intake: async (workspaceId) => {
      const [row] = await client.query(
        "SELECT enabled, changed_at FROM work_journal_intake WHERE workspace_id = $1",
        [workspaceId],
      );
      return row === undefined
        ? { enabled: false }
        : { enabled: row.enabled === true, changedAt: String(row.changed_at) };
    },
    setIntake: async (workspaceId, enabled, at) => {
      await client.query(
        `INSERT INTO work_journal_intake (workspace_id, enabled, changed_at) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, workspace_id)
         DO UPDATE SET enabled = EXCLUDED.enabled, changed_at = EXCLUDED.changed_at`,
        [workspaceId, enabled, at],
      );
      return { enabled, changedAt: at };
    },
  };
}
