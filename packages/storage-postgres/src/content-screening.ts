import { randomUUID } from "node:crypto";
import {
  type ContentScreeningResult,
  contentScreeningResultSchema,
} from "@draft-loop/schemas/content-screening";
import {
  type ContentScreeningRelease,
  type ContentScreeningStatus,
  type ContentScreeningStore,
  ContentScreeningStoreError,
  type ContentScreeningSubject,
  isScreeningQuarantined,
  maximumScreeningSubjectsPerQuery,
  requireScreeningKnowledgeBaseId,
  requireScreeningRelease,
  requireScreeningResult,
  requireScreeningResultId,
  requireScreeningSubject,
  requireScreeningWorkspaceId,
  type StoredContentScreeningResult,
} from "@draft-loop/storage/content-screening";
import { appendAuditEventRow } from "./audit-trail.js";
import type { SqlExecutor, SqlRow, SqlSession } from "./sql-client.js";

const lockNamespace = "content-screening";

/** The audit event a release appends: content-free, naming only the result and the member. */
const releaseEventType = "content-screening.released";

/** The columns that name a subject of each kind, in the order its queries bind them. */
const subjectColumns = {
  "job-source": ["workspace_id", "brief_id", "brief_source_id"],
  "knowledge-source-version": ["knowledge_base_id", "source_id", "source_version_id"],
} as const;

type SubjectKind = keyof typeof subjectColumns;

const statusSelect = `
  SELECT r.id, r.subject_kind, r.workspace_id, r.brief_id, r.brief_source_id, r.knowledge_base_id,
    r.source_id, r.source_version_id, r.verdict, r.signals, r.screeners, r.screened_at,
    r.recorded_at, l.member_id AS release_member_id, l.reason AS release_reason,
    l.released_at AS release_released_at
  FROM content_screening_results r
  LEFT JOIN content_screening_releases l ON l.tenant_id = r.tenant_id AND l.result_id = r.id`;

function timestamp(value: unknown): string {
  return (value instanceof Date ? value : new Date(String(value))).toISOString();
}

function subjectOf(row: SqlRow): ContentScreeningSubject {
  if (row.subject_kind === "job-source") {
    return {
      kind: "job-source",
      workspaceId: String(row.workspace_id),
      briefId: String(row.brief_id),
      sourceId: String(row.brief_source_id),
    };
  }
  return {
    kind: "knowledge-source-version",
    knowledgeBaseId: String(row.knowledge_base_id),
    sourceId: String(row.source_id),
    sourceVersionId: String(row.source_version_id),
  };
}

/** The stored result, checked against the schema again so a row written around it is not trusted. */
function resultOf(row: SqlRow): ContentScreeningResult {
  return contentScreeningResultSchema.parse({
    verdict: row.verdict,
    signals: row.signals,
    screeners: row.screeners,
    screenedAt: timestamp(row.screened_at),
  });
}

function storedOf(row: SqlRow): StoredContentScreeningResult {
  return {
    id: String(row.id),
    subject: subjectOf(row),
    result: resultOf(row),
    recordedAt: timestamp(row.recorded_at),
  };
}

function statusOf(row: SqlRow): ContentScreeningStatus {
  const stored = storedOf(row);
  const released = row.release_member_id !== null && row.release_member_id !== undefined;
  const base = {
    ...stored,
    quarantined: isScreeningQuarantined(stored.result.verdict, released),
  };
  if (!released) return base;
  return {
    ...base,
    release: {
      resultId: stored.id,
      memberId: String(row.release_member_id),
      reason: String(row.release_reason),
      releasedAt: timestamp(row.release_released_at),
    },
  };
}

function releaseOf(row: SqlRow): ContentScreeningRelease {
  return {
    resultId: String(row.result_id),
    memberId: String(row.member_id),
    reason: String(row.reason),
    releasedAt: timestamp(row.released_at),
  };
}

function subjectValues(subject: ContentScreeningSubject): readonly string[] {
  return subject.kind === "job-source"
    ? [subject.workspaceId, subject.briefId, subject.sourceId]
    : [subject.knowledgeBaseId, subject.sourceId, subject.sourceVersionId];
}

/** Keeps the latest result of each subject of one kind: no result of it is newer. */
function latestOnly(kind: SubjectKind): string {
  const same = subjectColumns[kind].map((column) => `n.${column} = r.${column}`).join(" AND ");
  return `r.subject_kind = '${kind}' AND NOT EXISTS (
    SELECT 1 FROM content_screening_results n
    WHERE n.subject_kind = '${kind}' AND ${same} AND n.sequence > r.sequence)`;
}

function orderBy(kind: SubjectKind): string {
  return `ORDER BY ${subjectColumns[kind].map((column) => `r.${column} COLLATE "C"`).join(", ")}`;
}

/** Serializes writers of one subject, so "latest" cannot change between a check and its write. */
async function lockSubject(executor: SqlExecutor, subject: ContentScreeningSubject) {
  await executor.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
    lockNamespace,
    JSON.stringify([subject.kind, ...subjectValues(subject)]),
  ]);
}

async function latestOfSubject(
  executor: SqlExecutor,
  subject: ContentScreeningSubject,
): Promise<ContentScreeningStatus | undefined> {
  const [first, second, third] = subjectColumns[subject.kind];
  const [row] = await executor.query(
    `${statusSelect}
     WHERE ${latestOnly(subject.kind)} AND r.${first} = $1 AND r.${second} = $2 AND r.${third} = $3`,
    subjectValues(subject),
  );
  return row === undefined ? undefined : statusOf(row);
}

/** Maps a failed knowledge-source reference onto the port's refusal. */
function missingSubject(error: unknown): ContentScreeningStoreError | undefined {
  const failure = error as { code?: unknown; constraint?: unknown } | null;
  if (
    failure?.code === "23503" &&
    (failure.constraint === "content_screening_results_source" ||
      failure.constraint === "content_screening_results_source_version")
  ) {
    return new ContentScreeningStoreError(
      "subject_not_found",
      "No such knowledge base, source or source version.",
    );
  }
  return undefined;
}

export interface ContentScreeningOptions {
  readonly newId?: () => string;
}

/**
 * One tenant's screening results and releases on Postgres (ADR 0011, phase 2d). Every transaction
 * sets the tenant, so row-level security confines both tables to it. Rows are only ever inserted:
 * the latest result of a subject, and whether a release covers it, decide its quarantine.
 */
export function createContentScreening(
  client: SqlSession,
  options: ContentScreeningOptions = {},
): ContentScreeningStore {
  const newId = options.newId ?? (() => `screening-${randomUUID()}`);

  const statusesOfKind = async (
    executor: SqlExecutor,
    kind: SubjectKind,
    subjects: readonly ContentScreeningSubject[],
    quarantinedOnly: boolean,
  ): Promise<readonly ContentScreeningStatus[]> => {
    if (subjects.length === 0) return [];
    const columns = subjectColumns[kind];
    const rows = await executor.query(
      `${statusSelect}
       WHERE ${latestOnly(kind)}
         AND (${columns.map((column) => `r.${column}`).join(", ")}) IN (
           SELECT * FROM unnest($1::text[], $2::text[], $3::text[]))
         ${quarantinedOnly ? "AND r.verdict <> 'clear' AND l.result_id IS NULL" : ""}
       ${orderBy(kind)}`,
      [0, 1, 2].map((index) => subjects.map((subject) => subjectValues(subject)[index])),
    );
    return rows.map(statusOf);
  };

  return {
    recordResult: async (subject, result) => {
      const checkedSubject = requireScreeningSubject(subject);
      const checkedResult = requireScreeningResult(result);
      const [first, second, third] = subjectColumns[checkedSubject.kind];
      try {
        return await client.transaction(async (executor) => {
          await lockSubject(executor, checkedSubject);
          const [row] = await executor.query(
            `INSERT INTO content_screening_results
               (id, subject_kind, ${first}, ${second}, ${third}, verdict, signals, screeners, screened_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
             RETURNING id, subject_kind, workspace_id, brief_id, brief_source_id, knowledge_base_id,
               source_id, source_version_id, verdict, signals, screeners, screened_at, recorded_at`,
            [
              newId(),
              checkedSubject.kind,
              ...subjectValues(checkedSubject),
              checkedResult.verdict,
              checkedResult.signals,
              JSON.stringify(checkedResult.screeners),
              checkedResult.screenedAt,
            ],
          );
          if (row === undefined) throw new Error("The screening result was not recorded");
          return storedOf(row);
        });
      } catch (error) {
        throw missingSubject(error) ?? error;
      }
    },

    latestFor: async (subject) => {
      const checked = requireScreeningSubject(subject);
      return client.transaction((executor) => latestOfSubject(executor, checked), {
        readOnlySnapshot: true,
      });
    },

    resultById: async (resultId) => {
      const id = requireScreeningResultId(resultId);
      const [row] = await client.query(`${statusSelect} WHERE r.id = $1`, [id]);
      return row === undefined ? undefined : storedOf(row);
    },

    quarantined: async (subjects) => {
      if (subjects.length > maximumScreeningSubjectsPerQuery) {
        throw new ContentScreeningStoreError(
          "invalid_input",
          `At most ${maximumScreeningSubjectsPerQuery} subjects can be asked about at once.`,
        );
      }
      const checked = subjects.map(requireScreeningSubject);
      return client.transaction(
        async (executor) => [
          ...(await statusesOfKind(
            executor,
            "job-source",
            checked.filter((subject) => subject.kind === "job-source"),
            true,
          )),
          ...(await statusesOfKind(
            executor,
            "knowledge-source-version",
            checked.filter((subject) => subject.kind === "knowledge-source-version"),
            true,
          )),
        ],
        { readOnlySnapshot: true },
      );
    },

    release: async (input) => {
      const { resultId, memberId, reason, historyId } = requireScreeningRelease(input);
      return client.transaction(async (executor) => {
        const [found] = await executor.query(`${statusSelect} WHERE r.id = $1`, [resultId]);
        if (found === undefined) {
          throw new ContentScreeningStoreError("result_not_found", "No such screening result.");
        }
        const target = statusOf(found);
        await lockSubject(executor, target.subject);
        const [existing] = await executor.query(
          "SELECT result_id, member_id, reason, released_at FROM content_screening_releases WHERE result_id = $1",
          [resultId],
        );
        if (existing !== undefined) return releaseOf(existing);
        if (target.result.verdict === "clear") {
          throw new ContentScreeningStoreError(
            "not_releasable",
            "A clear screening result has nothing to release.",
          );
        }
        if (target.subject.kind === "job-source" && target.subject.workspaceId !== historyId) {
          throw new ContentScreeningStoreError(
            "invalid_input",
            "A job source is released in its own workspace.",
          );
        }
        const latest = await latestOfSubject(executor, target.subject);
        if (latest?.id !== resultId) {
          throw new ContentScreeningStoreError(
            "result_superseded",
            "A newer screening result exists for this text.",
          );
        }
        const [inserted] = await executor.query(
          `INSERT INTO content_screening_releases (result_id, member_id, reason)
           VALUES ($1, $2, $3) RETURNING result_id, member_id, reason, released_at`,
          [resultId, memberId, reason],
        );
        if (inserted === undefined) throw new Error("The screening release was not recorded");
        const release = releaseOf(inserted);
        // The audit chain hangs off a workspace's history row, which a record that has only
        // uploaded sources may not have yet.
        await executor.query(
          `INSERT INTO workspaces (id, state, created_at, updated_at) VALUES ($1, 'collecting', $2, $2)
           ON CONFLICT (tenant_id, id) DO NOTHING`,
          [historyId, release.releasedAt],
        );
        await appendAuditEventRow(executor, {
          id: `content-screening-release:${resultId}`,
          workspaceId: historyId,
          eventType: releaseEventType,
          entityType: "content-screening-result",
          entityId: resultId,
          payload: { resultId, memberId },
          createdAt: release.releasedAt,
        });
        return release;
      });
    },

    listForRecord: async (workspaceId) => {
      const id = requireScreeningWorkspaceId(workspaceId);
      const rows = await client.query(
        `${statusSelect} WHERE ${latestOnly("job-source")} AND r.workspace_id = $1 ${orderBy("job-source")}`,
        [id],
      );
      return rows.map(statusOf);
    },

    listForKnowledgeBase: async (knowledgeBaseId) => {
      const id = requireScreeningKnowledgeBaseId(knowledgeBaseId);
      const rows = await client.query(
        `${statusSelect} WHERE ${latestOnly("knowledge-source-version")} AND r.knowledge_base_id = $1 ${orderBy("knowledge-source-version")}`,
        [id],
      );
      return rows.map(statusOf);
    },
  };
}
