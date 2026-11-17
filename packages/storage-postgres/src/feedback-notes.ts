import { randomUUID } from "node:crypto";
import {
  type FeedbackNote,
  type FeedbackStore,
  isFeedbackCategory,
  maximumFeedbackCharacters,
  maximumFeedbackScreenCharacters,
  maximumSupportTranscriptTurnCharacters,
  maximumSupportTranscriptTurns,
  type SupportTranscriptTurn,
} from "@draft-loop/storage/feedback";
import { requireOrganisationId, TenantDirectoryError } from "@draft-loop/storage/tenant-directory";

import type { SqlClient, SqlRow } from "./sql-client.js";

const columns = "tenant_id, id, kind, member_id, category, screen, body, transcript, sent_at";

/** The longest support summary, in characters: one paragraph. */
const maximumSupportSummaryCharacters = 800;

function transcriptRecord(value: unknown): readonly SupportTranscriptTurn[] | null {
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(parsed)) return null;
  return parsed.flatMap((turn: unknown) => {
    const { role, text } = (turn ?? {}) as { role?: unknown; text?: unknown };
    return (role === "member" || role === "assistant") && typeof text === "string"
      ? [{ role, text }]
      : [];
  });
}

function noteRecord(row: SqlRow): FeedbackNote {
  const category = row.category;
  const sentAt = row.sent_at;
  const support = row.kind === "support";
  return {
    noteId: String(row.id),
    kind: support ? "support" : "note",
    organisationId: String(row.tenant_id),
    memberId: String(row.member_id),
    category: isFeedbackCategory(category) ? category : null,
    screen: String(row.screen),
    text: String(row.body),
    transcript: support ? transcriptRecord(row.transcript) : null,
    sentAt: (sentAt instanceof Date ? sentAt : new Date(String(sentAt))).toISOString(),
  };
}

/** Feedback notes and support tickets on Postgres (#2828, #2883), over the directory's pool. */
export function createPostgresFeedback(client: SqlClient): FeedbackStore {
  return {
    send: async ({ organisationId, memberId, category, screen, text, now }) => {
      const tenantId = requireOrganisationId(organisationId);
      const body = text.trim();
      const where = screen.trim();
      if (body === "" || body.length > maximumFeedbackCharacters) {
        throw new TenantDirectoryError(
          "invalid_input",
          `A note has 1 to ${maximumFeedbackCharacters} characters.`,
        );
      }
      if (where === "" || where.length > maximumFeedbackScreenCharacters) {
        throw new TenantDirectoryError("invalid_input", "Invalid screen name.");
      }
      if (category !== null && !isFeedbackCategory(category)) {
        throw new TenantDirectoryError("invalid_input", "Invalid feedback category.");
      }
      if (Number.isNaN(now.getTime())) throw new Error("A clock must be a valid date.");
      return client.transaction(async (executor) => {
        await executor.query("SELECT set_config('draft_loop.tenant_id', $1, true)", [tenantId]);
        const [row] = await executor.query(
          `INSERT INTO feedback_notes (id, member_id, category, screen, body, sent_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING ${columns}`,
          [randomUUID(), memberId, category, where, body, now.toISOString()],
        );
        if (row === undefined) throw new Error("The note was not stored.");
        return noteRecord(row);
      });
    },

    openSupportTicket: async ({ organisationId, memberId, summary, transcript, now }) => {
      const tenantId = requireOrganisationId(organisationId);
      const body = summary.trim();
      if (body === "" || body.length > maximumSupportSummaryCharacters) {
        throw new TenantDirectoryError(
          "invalid_input",
          `A support summary has 1 to ${maximumSupportSummaryCharacters} characters.`,
        );
      }
      if (
        transcript.length > maximumSupportTranscriptTurns ||
        transcript.some(
          ({ role, text }) =>
            (role !== "member" && role !== "assistant") ||
            text.length > maximumSupportTranscriptTurnCharacters,
        )
      ) {
        throw new TenantDirectoryError(
          "invalid_input",
          `A transcript has at most ${maximumSupportTranscriptTurns} turns of ${maximumSupportTranscriptTurnCharacters} characters.`,
        );
      }
      if (Number.isNaN(now.getTime())) throw new Error("A clock must be a valid date.");
      const turns = transcript.map(({ role, text }) => ({ role, text }));
      return client.transaction(async (executor) => {
        await executor.query("SELECT set_config('draft_loop.tenant_id', $1, true)", [tenantId]);
        const [row] = await executor.query(
          `INSERT INTO feedback_notes
             (id, kind, member_id, category, screen, body, transcript, sent_at)
           VALUES ($1, 'support', $2, NULL, 'support', $3, $4::jsonb, $5)
           RETURNING ${columns}`,
          [randomUUID(), memberId, body, JSON.stringify(turns), now.toISOString()],
        );
        if (row === undefined) throw new Error("The ticket was not stored.");
        return noteRecord(row);
      });
    },

    listNewest: async (limit) =>
      (
        await client.query(
          `SELECT ${columns} FROM feedback_notes ORDER BY sent_at DESC, id LIMIT $1`,
          [Math.max(1, Math.min(500, Math.trunc(limit)))],
        )
      ).map(noteRecord),

    // The `support_retention` policy lets this delete only tickets older than the keep period.
    deleteSupportTicketsBefore: async (cutoff) => {
      if (Number.isNaN(cutoff.getTime())) throw new Error("A cutoff must be a valid date.");
      const rows = await client.query(
        "DELETE FROM feedback_notes WHERE kind = 'support' AND sent_at < $1 RETURNING id",
        [cutoff.toISOString()],
      );
      return rows.length;
    },
  };
}
