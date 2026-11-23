import type { SqlExecutor } from "./sql-client.js";

/**
 * Cover letter help for the quality digest (#3282): one organisation's counts of a day, read as
 * that organisation. Only numbers leave the query, never a letter, kit or id.
 */
export interface CoverLetterUseRow {
  /** Writing kits saved. */
  readonly kits: number;
  /**
   * Full letters a model drafted: `cover-letter` versions not based on another one. The web
   * offers them only after the one-time risk choice, which the browser keeps (#3277).
   */
  readonly fullDrafts: number;
  /** Applications with a cover letter version saved that day. */
  readonly letters: number;
  /** Of those, the ones whose newest version that day the candidate edited. */
  readonly editedLetters: number;
}

// Times stored as text are ISO 8601; the casts compare them as times. A version is the
// candidate's when one item was rewritten, or when it is based on another version and no critic
// wrote it (the web's `isUneditedModelLetter`, inverted).
const coverLetterUseSql = `
  WITH day_rows AS (
    SELECT workspace_id, application_id, kind, draft, created_at::timestamptz AS at
      FROM application_material_drafts
     WHERE kind IN ('cover-letter', 'cover-letter-kit')
       AND created_at::timestamptz >= $1 AND created_at::timestamptz < $2
  ), newest AS (
    SELECT DISTINCT ON (workspace_id, application_id) draft FROM day_rows
     WHERE kind = 'cover-letter'
     ORDER BY workspace_id, application_id, at DESC
  )
  SELECT
    (SELECT count(*) FROM day_rows WHERE kind = 'cover-letter-kit') AS kits,
    (SELECT count(*) FROM day_rows
      WHERE kind = 'cover-letter' AND draft->'based_on' IS NULL) AS full_drafts,
    (SELECT count(*) FROM newest) AS letters,
    (SELECT count(*) FROM newest
      WHERE coalesce(draft->'items', '[]'::jsonb) @> '[{"edited": true}]'::jsonb
         OR (draft->'based_on' IS NOT NULL AND draft->'critic_findings' IS NULL)) AS edited`;

/** Reads one organisation's cover letter counts in [from, to); the session is that tenant's. */
export async function readCoverLetterUse(
  tenant: SqlExecutor,
  from: Date,
  to: Date,
): Promise<CoverLetterUseRow> {
  const [row] = await tenant.query(coverLetterUseSql, [from.toISOString(), to.toISOString()]);
  return {
    kits: Number(row?.kits ?? 0),
    fullDrafts: Number(row?.full_drafts ?? 0),
    letters: Number(row?.letters ?? 0),
    editedLetters: Number(row?.edited ?? 0),
  };
}

/** Reads the deployment's Check my letter count for the UTC days in [from, to). */
export async function readCoverLetterChecks(
  client: SqlExecutor,
  from: Date,
  to: Date,
): Promise<number> {
  const [row] = await client.query(
    `SELECT coalesce(sum(checks), 0) AS total FROM cover_letter_check_counts
      WHERE day >= $1::date AND day < $2::date`,
    [from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)],
  );
  return Number(row?.total ?? 0);
}
