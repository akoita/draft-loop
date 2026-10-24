import { createHash } from "node:crypto";

import {
  type RecordArchiveEntry,
  type RecordArchiveManifest,
  type RecordArchiveTable,
  recordArchiveFormat,
  recordArchiveFormatVersion,
  recordArchiveManifestPath,
  recordArchiveManifestSchema,
  recordArchiveObjectPath,
  recordArchiveTablePath,
  recordArchiveTables,
} from "@draft-loop/schemas/record-archive";
import type { BlobReference, BlobStoragePort } from "@draft-loop/storage";
import { StorageSecurityError } from "@draft-loop/storage/errors";
import {
  type RecordArchive,
  RecordArchiveError,
  type RecordArchiveFile,
  type RecordArchiveKnowledgeScope,
  type RecordArchiveRequest,
  type RecordArchives,
} from "@draft-loop/storage/record-archive";

import { hostedWorkspaceReference, workspaceReferenceBlobs } from "./hosted-application-ports.js";
import type { PostgresTenantStorage } from "./postgres-storage.js";
import type { SqlExecutor, SqlRow, SqlSession } from "./sql-client.js";

/** What a row query is bound to: the record under its three ids, its runs and its bases. */
interface RecordScope {
  readonly historyId: string;
  readonly workspaceReference: string;
  readonly workspaceId: string;
  readonly runIds: readonly string[];
  readonly knowledgeBaseIds: readonly string[];
}

const orchestrationPrefix = "draft-loop:orchestration:";

/**
 * Each table's rows of one record, in a stable order. Run-history tables are keyed by the history
 * id, settings by the driver's reference, ownership by the API's workspace id, the orchestrator's
 * run state by the record's run ids, and knowledge by the bases in the request's scope. Every query runs
 * in a transaction that sets the tenant, so row-level security confines it to that tenant.
 */
const tableQueries: Readonly<
  Record<RecordArchiveTable, (scope: RecordScope) => readonly [string, readonly unknown[]]>
> = {
  workspace_settings: (s) => [
    `SELECT * FROM workspace_settings WHERE workspace_ref = $1 ORDER BY name COLLATE "C"`,
    [s.workspaceReference],
  ],
  workspaces: (s) => ["SELECT * FROM workspaces WHERE id = $1", [s.historyId]],
  consent_events: (s) => [
    "SELECT * FROM consent_events WHERE workspace_id = $1 ORDER BY sequence",
    [s.historyId],
  ],
  writing_policy_versions: (s) => [
    "SELECT * FROM writing_policy_versions WHERE workspace_id = $1 ORDER BY created_at, policy_checksum",
    [s.historyId],
  ],
  canonical_candidate_profile_versions: (s) => [
    "SELECT * FROM canonical_candidate_profile_versions WHERE workspace_id = $1 ORDER BY profile_id, version",
    [s.historyId],
  ],
  opportunity_brief_versions: (s) => [
    "SELECT * FROM opportunity_brief_versions WHERE workspace_id = $1 ORDER BY brief_id, version",
    [s.historyId],
  ],
  applications: (s) => [
    "SELECT * FROM applications WHERE workspace_id = $1 ORDER BY application_id",
    [s.historyId],
  ],
  application_run_bindings: (s) => [
    "SELECT * FROM application_run_bindings WHERE workspace_id = $1 ORDER BY run_id",
    [s.historyId],
  ],
  application_brief_bindings: (s) => [
    "SELECT * FROM application_brief_bindings WHERE workspace_id = $1 ORDER BY brief_id",
    [s.historyId],
  ],
  application_archives: (s) => [
    "SELECT * FROM application_archives WHERE workspace_id = $1 ORDER BY application_id",
    [s.historyId],
  ],
  application_model_profiles: (s) => [
    "SELECT * FROM application_model_profiles WHERE workspace_id = $1 ORDER BY application_id",
    [s.historyId],
  ],
  application_chosen_runs: (s) => [
    "SELECT * FROM application_chosen_runs WHERE workspace_id = $1 ORDER BY application_id",
    [s.historyId],
  ],
  default_application_names: (s) => [
    "SELECT * FROM default_application_names WHERE workspace_id = $1",
    [s.historyId],
  ],
  context_snapshots: (s) => [
    "SELECT * FROM context_snapshots WHERE workspace_id = $1 ORDER BY created_at, id",
    [s.historyId],
  ],
  artifact_versions: (s) => [
    "SELECT * FROM artifact_versions WHERE workspace_id = $1 ORDER BY created_at, id",
    [s.historyId],
  ],
  runs: (s) => [
    "SELECT * FROM runs WHERE workspace_id = $1 ORDER BY started_at, id",
    [s.historyId],
  ],
  run_snapshots: (s) => [
    "SELECT * FROM run_snapshots WHERE workspace_id = $1 ORDER BY sequence",
    [s.historyId],
  ],
  rounds: (s) => [
    "SELECT * FROM rounds WHERE workspace_id = $1 ORDER BY run_id, number",
    [s.historyId],
  ],
  executions: (s) => [
    "SELECT * FROM executions WHERE workspace_id = $1 ORDER BY started_at, id",
    [s.historyId],
  ],
  findings: (s) => [
    "SELECT * FROM findings WHERE workspace_id = $1 ORDER BY created_at, id",
    [s.historyId],
  ],
  decisions: (s) => [
    "SELECT * FROM decisions WHERE workspace_id = $1 ORDER BY created_at, id",
    [s.historyId],
  ],
  exports: (s) => [
    "SELECT * FROM exports WHERE workspace_id = $1 ORDER BY created_at, id",
    [s.historyId],
  ],
  // The orchestrator's keys name a run: `run:<id>`, or `<kind>:<id>:...` for its executions,
  // artifacts and latest steps. Run ids are safe identifiers without a colon.
  run_state_entries: (s) => [
    `SELECT * FROM run_state_entries AS e
     WHERE EXISTS (
       SELECT 1 FROM unnest($1::text[]) AS r(id)
       WHERE e.key = $2 || 'run:' || r.id
         OR starts_with(e.key, $2 || 'execution:' || r.id || ':')
         OR starts_with(e.key, $2 || 'artifact:' || r.id || ':')
         OR starts_with(e.key, $2 || 'latest:' || r.id || ':')
     )
     ORDER BY key COLLATE "C"`,
    [s.runIds, orchestrationPrefix],
  ],
  candidate_knowledge_retrieval_traces: (s) => [
    "SELECT * FROM candidate_knowledge_retrieval_traces WHERE workspace_id = $1 ORDER BY created_at, trace_id",
    [s.historyId],
  ],
  audit_events: (s) => [
    "SELECT * FROM audit_events WHERE workspace_id = $1 ORDER BY sequence",
    [s.historyId],
  ],
  knowledge_base_owners: (s) => [
    `SELECT * FROM knowledge_base_owners WHERE workspace_id = $1 ORDER BY knowledge_base_id COLLATE "C"`,
    [s.workspaceId],
  ],
  candidate_knowledge_bases: (s) => [
    `SELECT * FROM candidate_knowledge_bases WHERE id = ANY($1::text[]) ORDER BY id COLLATE "C"`,
    [s.knowledgeBaseIds],
  ],
  candidate_knowledge_sources: (s) => [
    `SELECT * FROM candidate_knowledge_sources WHERE candidate_knowledge_base_id = ANY($1::text[])
     ORDER BY created_at, id`,
    [s.knowledgeBaseIds],
  ],
  candidate_knowledge_source_versions: (s) => [
    `SELECT v.* FROM candidate_knowledge_source_versions AS v
     JOIN candidate_knowledge_sources AS s ON s.id = v.source_id
     WHERE s.candidate_knowledge_base_id = ANY($1::text[])
     ORDER BY v.source_id, v.version`,
    [s.knowledgeBaseIds],
  ],
  candidate_knowledge_managed_source_versions: (s) => [
    `SELECT m.* FROM candidate_knowledge_managed_source_versions AS m
     JOIN candidate_knowledge_sources AS s ON s.id = m.source_id
     WHERE s.candidate_knowledge_base_id = ANY($1::text[])
     ORDER BY m.version_id`,
    [s.knowledgeBaseIds],
  ],
  candidate_knowledge_source_sensitivity_rule_versions: (s) => [
    `SELECT * FROM candidate_knowledge_source_sensitivity_rule_versions
     WHERE knowledge_base_id = ANY($1::text[]) ORDER BY knowledge_base_id, version`,
    [s.knowledgeBaseIds],
  ],
};

/** One record's rows of each table that has any, without the tenant column. */
export type RecordArchiveRows = ReadonlyMap<RecordArchiveTable, readonly SqlRow[]>;

/** A row's values as JSON keeps them: timestamps as ISO text, 64-bit integers as Postgres text. */
function archivedRow(row: SqlRow): SqlRow {
  const { tenant_id: _tenant, ...columns } = row;
  return Object.fromEntries(
    Object.entries(columns).map(([column, value]) => [
      column,
      value instanceof Date ? value.toISOString() : value,
    ]),
  );
}

async function readRows(
  executor: SqlExecutor,
  table: RecordArchiveTable,
  scope: RecordScope,
): Promise<readonly SqlRow[]> {
  const [text, parameters] = tableQueries[table](scope);
  return (await executor.query(text, parameters)).map(archivedRow);
}

/**
 * Reads one record's rows of every archive table from one snapshot, so the files agree with each
 * other. The tenant session confines every read to its tenant.
 */
export function createRecordArchiveRows(client: SqlSession) {
  return {
    readRecordArchiveRows: (scope: {
      readonly historyId: string;
      readonly workspaceReference: string;
      readonly workspaceId: string;
      readonly knowledgeScope: RecordArchiveKnowledgeScope;
    }): Promise<RecordArchiveRows> =>
      client.transaction(
        async (executor) => {
          const base: RecordScope = { ...scope, runIds: [], knowledgeBaseIds: [] };
          const runs = await readRows(executor, "runs", base);
          const owners = await readRows(executor, "knowledge_base_owners", base);
          const knowledgeBaseIds =
            scope.knowledgeScope === "tenant"
              ? (
                  await executor.query(
                    `SELECT id FROM candidate_knowledge_bases ORDER BY id COLLATE "C"`,
                  )
                ).map((row) => String(row.id))
              : owners.map((row) => String(row.knowledge_base_id));
          const full: RecordScope = {
            ...base,
            runIds: runs.map((row) => String(row.id)),
            knowledgeBaseIds,
          };
          const rows = new Map<RecordArchiveTable, readonly SqlRow[]>();
          for (const table of recordArchiveTables) {
            const tableRows =
              table === "runs"
                ? runs
                : table === "knowledge_base_owners"
                  ? owners
                  : await readRows(executor, table, full);
            if (tableRows.length > 0) rows.set(table, tableRows);
          }
          return rows;
        },
        { readOnlySnapshot: true },
      ),
  };
}

/** Where an object's bytes are read from and what they must still be. */
interface ArchiveObject {
  readonly blobs: BlobStoragePort;
  readonly reference: BlobReference;
}

function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function payloadField(row: SqlRow, name: string): unknown {
  if (typeof row.payload_json !== "string") return undefined;
  try {
    const payload: unknown = JSON.parse(row.payload_json);
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return undefined;
    return (payload as Readonly<Record<string, unknown>>)[name];
  } catch {
    return undefined;
  }
}

const integrityFailure = () =>
  new RecordArchiveError(
    "object_integrity",
    "A stored source or exported document is missing or no longer matches its recorded checksum.",
  );

/**
 * Every object the rows reference, by checksum: each managed source version's bytes, and each
 * completed export whose checksum and size were recorded. An export without a recorded size cannot
 * be checked by reference, so only its row is archived, as the export routes do. An export stored
 * outside this record's workspace reference fails closed.
 */
function referencedObjects(
  rows: RecordArchiveRows,
  blobs: BlobStoragePort,
  exportBlobs: BlobStoragePort,
  workspaceReference: string,
): Map<string, ArchiveObject> {
  const objects = new Map<string, ArchiveObject>();
  const add = (store: BlobStoragePort, reference: BlobReference) => {
    const existing = objects.get(reference.checksum);
    if (existing !== undefined && existing.reference.sizeBytes !== reference.sizeBytes) {
      throw integrityFailure();
    }
    if (existing === undefined) objects.set(reference.checksum, { blobs: store, reference });
  };

  const versions = new Map(
    (rows.get("candidate_knowledge_source_versions") ?? []).map((row) => [String(row.id), row]),
  );
  for (const managed of rows.get("candidate_knowledge_managed_source_versions") ?? []) {
    const version = versions.get(String(managed.version_id));
    if (version === undefined) throw integrityFailure();
    add(blobs, {
      location: String(managed.blob_location),
      checksum: String(version.checksum),
      sizeBytes: Number(version.size_bytes),
    });
  }

  for (const row of rows.get("exports") ?? []) {
    const sizeBytes = payloadField(row, "sizeBytes");
    if (
      row.status !== "completed" ||
      typeof row.output_path !== "string" ||
      typeof row.output_checksum !== "string" ||
      typeof sizeBytes !== "number"
    ) {
      continue;
    }
    if (!row.output_path.startsWith(`${workspaceReference}/`)) {
      throw new StorageSecurityError("An export is stored outside its record's workspace.");
    }
    add(exportBlobs, {
      location: row.output_path,
      checksum: row.output_checksum,
      sizeBytes,
    });
  }
  return objects;
}

async function readChecked(object: ArchiveObject): Promise<Uint8Array> {
  const content = await object.blobs.get(object.reference);
  if (
    content === undefined ||
    content.byteLength !== object.reference.sizeBytes ||
    sha256(content) !== object.reference.checksum
  ) {
    throw integrityFailure();
  }
  return content;
}

export interface PostgresRecordArchivesOptions {
  /** One tenant's storage, borrowed. */
  readonly storage: PostgresTenantStorage;
  /** The tenant the storage was opened for. */
  readonly tenantId: string;
  /** The tenant's blob storage: managed source bytes and exported documents. */
  readonly blobs: BlobStoragePort;
  readonly now?: () => Date;
}

const encoder = new TextEncoder();

/**
 * Record archives over one tenant's Postgres rows and blob objects (ADR 0011, D7). Preparing reads
 * every row of the record from one snapshot and checks each object it references, so a missing or
 * changed object fails before anything is sent. The files then stream one at a time: table files
 * from the prepared rows, objects read and checked again as they are reached.
 */
export function openPostgresRecordArchives(options: PostgresRecordArchivesOptions): RecordArchives {
  const { storage, tenantId, blobs } = options;
  const exportBlobs = workspaceReferenceBlobs(blobs);
  const now = options.now ?? (() => new Date());
  return {
    prepare: async (request: RecordArchiveRequest): Promise<RecordArchive> => {
      const workspaceReference = hostedWorkspaceReference(tenantId, request.workspaceId);
      const rows = await storage.readRecordArchiveRows({
        historyId: request.historyId,
        workspaceReference,
        workspaceId: request.workspaceId,
        knowledgeScope: request.knowledgeScope,
      });
      const tableFiles = new Map<string, Uint8Array>();
      const entries: RecordArchiveEntry[] = [];
      for (const [table, tableRows] of rows) {
        const content = encoder.encode(`${JSON.stringify({ table, rows: tableRows }, null, 2)}\n`);
        const path = recordArchiveTablePath(table);
        tableFiles.set(path, content);
        entries.push({
          kind: "table",
          path,
          table,
          sha256: sha256(content),
          sizeBytes: content.byteLength,
        });
      }
      const objects = referencedObjects(rows, blobs, exportBlobs, workspaceReference);
      const objectsByPath = new Map<string, ArchiveObject>();
      for (const [checksum, object] of objects) {
        if (!(await object.blobs.exists(object.reference))) throw integrityFailure();
        const path = recordArchiveObjectPath(checksum);
        objectsByPath.set(path, object);
        entries.push({
          kind: "object",
          path,
          sha256: checksum,
          sizeBytes: object.reference.sizeBytes,
        });
      }
      const manifest: RecordArchiveManifest = recordArchiveManifestSchema.parse({
        format: recordArchiveFormat,
        formatVersion: recordArchiveFormatVersion,
        createdAt: now().toISOString(),
        record: { workspaceId: request.workspaceId },
        entries,
      });
      const manifestContent = encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`);
      return {
        manifest,
        manifestSha256: sha256(manifestContent),
        files: async function* (): AsyncGenerator<RecordArchiveFile> {
          yield { path: recordArchiveManifestPath, content: manifestContent };
          for (const entry of manifest.entries) {
            const table = tableFiles.get(entry.path);
            if (table !== undefined) {
              yield { path: entry.path, content: table };
              continue;
            }
            const object = objectsByPath.get(entry.path);
            if (object === undefined) throw integrityFailure();
            yield { path: entry.path, content: await readChecked(object) };
          }
        },
      };
    },
  };
}
