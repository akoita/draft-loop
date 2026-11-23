import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import type { EvidenceSourceRecord } from "./ports/retrieval.js";

export type ApprovedEvidenceSources = readonly Pick<EvidenceSourceRecord, "id" | "checksum">[];

interface Reader {
  prepare(sql: string): {
    all(...parameters: readonly unknown[]): readonly Record<string, unknown>[];
    get(...parameters: readonly unknown[]): Record<string, unknown> | undefined;
  };
}
export function readEvidenceSource(database: Reader, id: string): EvidenceSourceRecord | undefined {
  const row = database
    .prepare(
      "SELECT id, workspace_id, path, media_type, checksum, created_at FROM evidence_sources WHERE id = ?",
    )
    .get(id);
  return row === undefined
    ? undefined
    : {
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        path: String(row.path),
        mediaType: String(row.media_type),
        checksum: String(row.checksum),
        createdAt: String(row.created_at),
      };
}

/** A Markdown heading that dates a role or period, such as `## Analyst, 2021 to present`. */
export function isDatedChronologyHeading(text: string): boolean {
  return /^\s*#{1,6}\s+[^\n]*(?:19|20)\d{2}[^\n]*(?:\bto\b|[–—-])[^\n]*(?:(?:19|20)\d{2}|present|current|now)\b/iu.test(
    text,
  );
}

/** A chunk that is one top-level heading line and nothing else, such as `# Amara Okafor`. */
function isTopLevelHeadingLine(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("# ") && !trimmed.includes("\n");
}

/**
 * Read dated Markdown headings from immutable, explicitly pinned sources, plus each source's
 * opening `#` heading when it stands alone: a profile usually names its candidate there (#3296),
 * and the caller keeps it only when it names a person.
 */
export function readApprovedChronology(
  database: Reader,
  workspaceId: string,
  sources: readonly { readonly id: string; readonly checksum: string }[],
): readonly ScoredEvidenceChunk[] {
  if (!workspaceId.trim() || sources.length > 100)
    throw new Error("Chronology source bounds exceeded.");
  const hits: ScoredEvidenceChunk[] = [];
  for (const source of sources) {
    const stored = database
      .prepare("SELECT workspace_id, checksum FROM evidence_sources WHERE id = ?")
      .get(source.id);
    if (!stored || stored.workspace_id !== workspaceId || stored.checksum !== source.checksum)
      throw new Error("Pinned chronology source is unavailable.");
    const rows = database
      .prepare(
        "SELECT id, source_id, ordinal, line_start, line_end, checksum, text FROM evidence_chunks WHERE workspace_id = ? AND source_id = ? AND ltrim(text) LIKE '#%' ORDER BY ordinal, id LIMIT 101",
      )
      .all(workspaceId, source.id);
    if (rows.length > 100) throw new Error("Chronology heading scan bound exceeded.");
    const first = database
      .prepare(
        "SELECT min(ordinal) AS ordinal FROM evidence_chunks WHERE workspace_id = ? AND source_id = ?",
      )
      .get(workspaceId, source.id);
    const firstOrdinal =
      first?.ordinal === null || first?.ordinal === undefined ? -1 : Number(first.ordinal);
    for (const row of rows) {
      const text = String(row.text);
      if (
        !isDatedChronologyHeading(text) &&
        !(Number(row.ordinal) === firstOrdinal && isTopLevelHeadingLine(text))
      )
        continue;
      hits.push({
        id: String(row.id),
        workspaceId,
        sourceId: String(row.source_id),
        ordinal: Number(row.ordinal),
        lineStart: Number(row.line_start),
        lineEnd: Number(row.line_end),
        checksum: String(row.checksum),
        text,
        rank: 0,
      });
      if (hits.length > 20 || Buffer.byteLength(JSON.stringify(hits)) > 131072)
        throw new Error("Chronology evidence exceeds provider bounds.");
    }
  }
  return hits;
}
