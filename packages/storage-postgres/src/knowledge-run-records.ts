import type {
  CandidateKnowledgeBaseLifecycleReadinessRecord,
  CandidateKnowledgeSourceLifecycleBlockerReason,
  CandidateKnowledgeSourceLifecycleReadinessRecord,
  CandidateKnowledgeSourceVersionRecord,
  ManagedCandidateKnowledgeSourceVersionRecord,
} from "@draft-loop/storage";
import {
  candidateKnowledgeBaseColumns,
  candidateKnowledgeBaseFromRow,
  candidateKnowledgeSourceColumns,
  candidateKnowledgeSourceFromRow,
  candidateKnowledgeSourceVersionColumns,
  candidateKnowledgeSourceVersionFromRow,
} from "@draft-loop/storage/candidate-knowledge";
import { StorageConflictError, StorageValidationError } from "@draft-loop/storage/errors";
import { requireNonEmpty } from "@draft-loop/storage/history-records";
import type { CandidateKnowledgeStoreDescriptor } from "@draft-loop/storage/knowledge-store";
import {
  prepareSourceSensitivityRulesAppend,
  requireSourceSensitivityRulesChronology,
  type SourceSensitivityRuleStoragePort,
  sourceSensitivityRuleColumns,
  sourceSensitivityRuleVersionFromRow,
} from "@draft-loop/storage/source-sensitivity-rules";
import type { SqlClient, SqlExecutor } from "./sql-client.js";

export interface ManagedCandidateKnowledgeSourceVersionInput {
  readonly knowledgeBaseId: string;
  readonly sourceId: string;
  readonly versionId: string;
  /** Where the version's bytes are in the service's blob storage. */
  readonly location: string;
  readonly recordedAt: string;
}

export interface ManagedCandidateKnowledgeSourceVersionLocation {
  readonly metadata: ManagedCandidateKnowledgeSourceVersionRecord;
  readonly location: string;
}

/**
 * What a run reads from a hosted candidate knowledge store beyond the knowledge-base records: the
 * store itself, which versions the service holds bytes for, their lifecycle readiness, and the
 * sensitivity rules. The writes here are the ones hosted intake (`createHostedKnowledgeIntake` in
 * `@draft-loop/application`) needs to store an uploaded source.
 */
export interface CandidateKnowledgeRunRecords
  extends Pick<
    SourceSensitivityRuleStoragePort,
    "appendCandidateKnowledgeSourceSensitivityRules" | "getCandidateKnowledgeSourceSensitivityRules"
  > {
  readonly createCandidateKnowledgeStore: (
    descriptor: CandidateKnowledgeStoreDescriptor,
  ) => Promise<CandidateKnowledgeStoreDescriptor>;
  readonly getCandidateKnowledgeStore: (
    id: string,
  ) => Promise<CandidateKnowledgeStoreDescriptor | undefined>;
  readonly recordManagedCandidateKnowledgeSourceVersion: (
    input: ManagedCandidateKnowledgeSourceVersionInput,
  ) => Promise<void>;
  readonly getManagedCandidateKnowledgeSourceVersion: (
    knowledgeBaseId: string,
    sourceId: string,
    versionId: string,
  ) => Promise<ManagedCandidateKnowledgeSourceVersionLocation | undefined>;
  readonly getCandidateKnowledgeBaseLifecycleReadiness: (
    knowledgeBaseId: string,
  ) => Promise<CandidateKnowledgeBaseLifecycleReadinessRecord | undefined>;
}

function requireId(value: string, field: string): string {
  return requireNonEmpty(value, field).trim();
}

function requireTimestamp(value: string, field: string): string {
  if (Number.isNaN(Date.parse(value)) || !/^\d{4}-\d{2}-\d{2}T/u.test(value)) {
    throw new StorageValidationError(`${field} must be a valid ISO timestamp`);
  }
  return value;
}

const sourcesOfBase =
  "SELECT id FROM candidate_knowledge_sources WHERE candidate_knowledge_base_id = $1";

function sorted<T>(values: readonly T[], key: (value: T) => string): T[] {
  return [...values].sort((left, right) =>
    key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0,
  );
}

/**
 * One source's readiness. A hosted source has no local origin to refresh from, no refresh
 * observation and no directory: its origin is the upload, bound when its first managed bytes were
 * recorded. So a source is ready when its knowledge base is active and its latest version's bytes
 * are held, and the same blockers as the local store apply otherwise.
 */
function sourceReadiness(
  knowledgeBase: { readonly state: "active" | "archived"; readonly archivedAt: string | null },
  source: { readonly id: string; readonly kind: string },
  versions: readonly CandidateKnowledgeSourceVersionRecord[],
  managed: ReadonlyMap<string, string>,
): CandidateKnowledgeSourceLifecycleReadinessRecord {
  const latest = versions.at(-1);
  if (latest === undefined) {
    throw new StorageValidationError(
      `candidate knowledge source ${source.id} has no source versions`,
    );
  }
  const isManaged = managed.has(latest.id);
  const boundAt = sorted(
    versions.flatMap((version) => managed.get(version.id) ?? []),
    (value) => value,
  )[0];
  const originBoundAt = source.kind === "file" ? (boundAt ?? null) : null;
  const reasons: CandidateKnowledgeSourceLifecycleBlockerReason[] = [];
  if (knowledgeBase.state === "archived") reasons.push("knowledge-base-archived");
  if (!isManaged) reasons.push("latest-version-unmanaged");
  if (source.kind === "file" && originBoundAt === null) reasons.push("source-origin-unbound");
  return Object.freeze({
    sourceId: source.id,
    latestVersionId: latest.id,
    status: reasons.length === 0 ? "ready" : "blocked",
    reasons: Object.freeze(reasons),
    lifecycleRevision: Object.freeze({
      knowledgeBaseState: knowledgeBase.state,
      knowledgeBaseArchivedAt: knowledgeBase.archivedAt,
      versionId: latest.id,
      version: latest.version,
      createdAt: latest.createdAt,
      managed: isManaged,
      originBoundAt,
      observation: null,
      retirement: null,
      provenanceFetchedAt: null,
      directory: null,
    }),
  });
}

async function readiness(
  executor: SqlExecutor,
  knowledgeBaseId: string,
): Promise<CandidateKnowledgeBaseLifecycleReadinessRecord | undefined> {
  const [baseRow] = await executor.query(
    `SELECT ${candidateKnowledgeBaseColumns} FROM candidate_knowledge_bases WHERE id = $1`,
    [knowledgeBaseId],
  );
  if (baseRow === undefined) return undefined;
  const knowledgeBase = candidateKnowledgeBaseFromRow(baseRow);
  const sources = (
    await executor.query(
      `SELECT ${candidateKnowledgeSourceColumns} FROM candidate_knowledge_sources
       WHERE candidate_knowledge_base_id = $1 ORDER BY id COLLATE "C"`,
      [knowledgeBaseId],
    )
  ).map(candidateKnowledgeSourceFromRow);
  const versions = (
    await executor.query(
      `SELECT ${candidateKnowledgeSourceVersionColumns} FROM candidate_knowledge_source_versions
       WHERE source_id IN (${sourcesOfBase}) ORDER BY version, id COLLATE "C"`,
      [knowledgeBaseId],
    )
  ).map(candidateKnowledgeSourceVersionFromRow);
  const managed = new Map(
    (
      await executor.query(
        `SELECT version_id, recorded_at FROM candidate_knowledge_managed_source_versions
         WHERE source_id IN (${sourcesOfBase})`,
        [knowledgeBaseId],
      )
    ).map((row) => [String(row.version_id), String(row.recorded_at)] as const),
  );
  return Object.freeze({
    knowledgeBaseId: knowledgeBase.id,
    state: knowledgeBase.state,
    archivedAt: knowledgeBase.archivedAt,
    sources: Object.freeze(
      sources.map((source) =>
        sourceReadiness(
          knowledgeBase,
          source,
          versions.filter((version) => version.sourceId === source.id),
          managed,
        ),
      ),
    ),
  });
}

const sensitivityTable = "candidate_knowledge_source_sensitivity_rule_versions";

export function createKnowledgeRunRecords(client: SqlClient): CandidateKnowledgeRunRecords {
  return {
    createCandidateKnowledgeStore: async (descriptor) => {
      const id = requireId(descriptor.id, "candidate knowledge store id");
      const createdAt = requireTimestamp(
        descriptor.createdAt,
        "candidate knowledge store createdAt",
      );
      await client.query(
        "INSERT INTO candidate_knowledge_stores (id, created_at) VALUES ($1, $2)",
        [id, createdAt],
      );
      return Object.freeze({ schemaVersion: 1, id, createdAt });
    },
    getCandidateKnowledgeStore: async (idInput) => {
      const id = requireId(idInput, "candidate knowledge store id");
      const [row] = await client.query(
        "SELECT id, created_at FROM candidate_knowledge_stores WHERE id = $1",
        [id],
      );
      return row === undefined
        ? undefined
        : Object.freeze({
            schemaVersion: 1,
            id: String(row.id),
            createdAt: String(row.created_at),
          });
    },
    recordManagedCandidateKnowledgeSourceVersion: async (input) => {
      const knowledgeBaseId = requireId(input.knowledgeBaseId, "candidate knowledge base id");
      const sourceId = requireId(input.sourceId, "candidate knowledge source id");
      const versionId = requireId(input.versionId, "candidate knowledge source version id");
      const location = requireId(input.location, "managed source version location");
      const recordedAt = requireTimestamp(input.recordedAt, "managed source version recordedAt");
      await client.transaction(async (executor) => {
        const [source] = await executor.query(
          `SELECT ${candidateKnowledgeSourceColumns} FROM candidate_knowledge_sources
           WHERE candidate_knowledge_base_id = $1 AND id = $2`,
          [knowledgeBaseId, sourceId],
        );
        if (source === undefined) {
          throw new StorageValidationError(
            `candidate knowledge source ${sourceId} was not found in candidate knowledge base ${knowledgeBaseId}`,
          );
        }
        // URL sources need fetch provenance, which comes with intake.
        if (candidateKnowledgeSourceFromRow(source).kind !== "file") {
          throw new StorageConflictError("Only file sources can hold managed bytes in this store.");
        }
        await executor.query(
          `INSERT INTO candidate_knowledge_managed_source_versions
             (version_id, source_id, blob_location, recorded_at) VALUES ($1, $2, $3, $4)`,
          [versionId, sourceId, location, recordedAt],
        );
      });
    },
    getManagedCandidateKnowledgeSourceVersion: async (
      knowledgeBaseIdInput,
      sourceIdInput,
      versionIdInput,
    ) => {
      const knowledgeBaseId = requireId(knowledgeBaseIdInput, "candidate knowledge base id");
      const sourceId = requireId(sourceIdInput, "candidate knowledge source id");
      const versionId = requireId(versionIdInput, "candidate knowledge source version id");
      const [row] = await client.query(
        `SELECT v.id, v.source_id, v.version, v.parent_version_id, v.media_type, v.checksum,
           v.size_bytes, v.created_at, s.kind, m.blob_location
         FROM candidate_knowledge_managed_source_versions m
         JOIN candidate_knowledge_source_versions v ON v.id = m.version_id AND v.source_id = m.source_id
         JOIN candidate_knowledge_sources s ON s.id = v.source_id
         WHERE s.candidate_knowledge_base_id = $1 AND v.source_id = $2 AND v.id = $3`,
        [knowledgeBaseId, sourceId, versionId],
      );
      if (row === undefined) return undefined;
      const version = candidateKnowledgeSourceVersionFromRow(row);
      return Object.freeze({
        metadata: Object.freeze({
          ...version,
          knowledgeBaseId,
          kind: row.kind === "url" ? "url" : "file",
        }),
        location: String(row.blob_location),
      });
    },
    getCandidateKnowledgeBaseLifecycleReadiness: (knowledgeBaseId) =>
      client.transaction(
        (executor) =>
          readiness(executor, requireId(knowledgeBaseId, "candidate knowledge base id")),
        { readOnlySnapshot: true },
      ),
    appendCandidateKnowledgeSourceSensitivityRules: async (knowledgeBaseIdInput, input) => {
      const prepared = prepareSourceSensitivityRulesAppend(knowledgeBaseIdInput, input);
      return client.transaction(async (executor) => {
        const [base] = await executor.query(
          "SELECT id FROM candidate_knowledge_bases WHERE id = $1 FOR UPDATE",
          [prepared.knowledgeBaseId],
        );
        if (base === undefined) {
          throw new StorageValidationError(
            `candidate knowledge base ${prepared.knowledgeBaseId} was not found`,
          );
        }
        const [latest] = await executor.query(
          `SELECT version, created_at FROM ${sensitivityTable}
           WHERE knowledge_base_id = $1 ORDER BY version DESC LIMIT 1`,
          [prepared.knowledgeBaseId],
        );
        requireSourceSensitivityRulesChronology(
          prepared.createdAt,
          latest === undefined ? undefined : String(latest.created_at),
        );
        const version = latest === undefined ? 1 : Number(latest.version) + 1;
        const [row] = await executor.query(
          `INSERT INTO ${sensitivityTable} (${sourceSensitivityRuleColumns})
           VALUES ($1, $2, $3, $4, $5) RETURNING ${sourceSensitivityRuleColumns}`,
          [
            prepared.knowledgeBaseId,
            version,
            prepared.rulesJson,
            prepared.checksum,
            prepared.createdAt,
          ],
        );
        return sourceSensitivityRuleVersionFromRow(row ?? {});
      });
    },
    getCandidateKnowledgeSourceSensitivityRules: async (knowledgeBaseIdInput) => {
      const knowledgeBaseId = requireId(knowledgeBaseIdInput, "candidate knowledge base id");
      const [row] = await client.query(
        `SELECT ${sourceSensitivityRuleColumns} FROM ${sensitivityTable}
         WHERE knowledge_base_id = $1 ORDER BY version DESC LIMIT 1`,
        [knowledgeBaseId],
      );
      return row === undefined ? undefined : sourceSensitivityRuleVersionFromRow(row);
    },
  };
}
