import { randomUUID } from "node:crypto";
import {
  type FeedbackNote,
  type FeedbackStore,
  isFeedbackCategory,
  maximumFeedbackCharacters,
  maximumFeedbackScreenCharacters,
} from "@draft-loop/storage/feedback";
import { requireOrganisationId, TenantDirectoryError } from "@draft-loop/storage/tenant-directory";

import type { SqlClient, SqlRow } from "./sql-client.js";

function noteRecord(row: SqlRow): FeedbackNote {
  const category = row.category;
  const sentAt = row.sent_at;
  return {
    noteId: String(row.id),
    organisationId: String(row.tenant_id),
    memberId: String(row.member_id),
    category: isFeedbackCategory(category) ? category : null,
    screen: String(row.screen),
    text: String(row.body),
    sentAt: (sentAt instanceof Date ? sentAt : new Date(String(sentAt))).toISOString(),
  };
}

/** Feedback notes on Postgres (#2828), over the tenant directory's pool. */
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
           RETURNING tenant_id, id, member_id, category, screen, body, sent_at`,
          [randomUUID(), memberId, category, where, body, now.toISOString()],
        );
        if (row === undefined) throw new Error("The note was not stored.");
        return noteRecord(row);
      });
    },

    listNewest: async (limit) =>
      (
        await client.query(
          `SELECT tenant_id, id, member_id, category, screen, body, sent_at FROM feedback_notes
           ORDER BY sent_at DESC, id LIMIT $1`,
          [Math.max(1, Math.min(500, Math.trunc(limit)))],
        )
      ).map(noteRecord),
  };
}
