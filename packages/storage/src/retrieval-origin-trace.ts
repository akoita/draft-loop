import { createHash } from "node:crypto";
import { StorageConflictError, StorageValidationError } from "./storage-errors.js";

/**
 * Append-only companion to the v1 candidate knowledge retrieval trace for runs that pin a reviewed
 * candidate profile. One trace records, for one evidence selection, the pinned profile version and
 * whether each selected item came from a profile fact or a knowledge-base chunk. It is
 * content-free: item and source ids are opaque, the query is a checksum, and no fact value, quote,
 * fact key or chunk text is stored.
 */
export const retrievalOriginTraceOrigins = ["profile-fact", "knowledge-chunk"] as const;
export type RetrievalOriginTraceOrigin = (typeof retrievalOriginTraceOrigins)[number];

export const retrievalOriginTraceModes = ["lexical", "semantic", "hybrid"] as const;
export type RetrievalOriginTraceMode = (typeof retrievalOriginTraceModes)[number];

export interface RetrievalOriginTraceItem {
  /** The opaque evidence item id the author may cite. */
  readonly itemId: string;
  readonly origin: RetrievalOriginTraceOrigin;
  /** The opaque evidence source id of the item's source version. */
  readonly sourceId: string;
}

export interface RetrievalOriginTraceProfile {
  readonly profileId: string;
  readonly version: number;
  readonly checksum: string;
}

export interface RetrievalOriginTraceInput {
  readonly workspaceId: string;
  readonly traceId: string;
  /** SHA-256 of the query text, as the v1 trace records it. */
  readonly queryChecksum: string;
  readonly profile: RetrievalOriginTraceProfile;
  /** The mode the profile's facts were ranked in. */
  readonly factRankingMode: RetrievalOriginTraceMode;
  /** In selection order. */
  readonly selectedItems: readonly RetrievalOriginTraceItem[];
  readonly createdAt: string;
}

export interface RetrievalOriginTrace extends RetrievalOriginTraceInput {
  readonly payloadChecksum: string;
}

export interface RetrievalOriginTraceStoragePort {
  /** Idempotent for an identical trace; a different trace for the same id is a conflict. */
  readonly appendRetrievalOriginTrace: (
    input: RetrievalOriginTraceInput,
  ) => Promise<RetrievalOriginTrace>;
  readonly getRetrievalOriginTrace: (
    workspaceId: string,
    traceId: string,
  ) => Promise<RetrievalOriginTrace | undefined>;
  /** Every trace of a workspace, oldest first. */
  readonly listRetrievalOriginTraces: (
    workspaceId: string,
  ) => Promise<readonly RetrievalOriginTrace[]>;
}

interface TraceStatement {
  readonly run: (...parameters: readonly unknown[]) => unknown;
  readonly get: (...parameters: readonly unknown[]) => Record<string, unknown> | undefined;
  readonly all: (...parameters: readonly unknown[]) => readonly Record<string, unknown>[];
}

export interface RetrievalOriginTraceDatabase {
  readonly prepare: (sql: string) => TraceStatement;
  readonly transaction: <Result>(operation: () => Result) => () => Result;
}

const hex64 = (column: string): string =>
  `length(${column}) = 64 AND ${column} NOT GLOB '*[^0-9a-f]*'`;

export const retrievalOriginTraceMigration = {
  version: 34,
  sql: `
    CREATE TABLE IF NOT EXISTS candidate_knowledge_retrieval_origin_traces (
      workspace_id TEXT NOT NULL CHECK (length(trim(workspace_id)) > 0),
      trace_id TEXT NOT NULL CHECK (length(trim(trace_id)) > 0),
      query_checksum TEXT NOT NULL CHECK (${hex64("query_checksum")}),
      profile_id TEXT NOT NULL CHECK (length(trim(profile_id)) > 0),
      profile_version INTEGER NOT NULL CHECK (
        typeof(profile_version) = 'integer' AND profile_version >= 1
      ),
      profile_checksum TEXT NOT NULL CHECK (${hex64("profile_checksum")}),
      fact_ranking_mode TEXT NOT NULL CHECK (
        fact_ranking_mode IN ('lexical', 'semantic', 'hybrid')
      ),
      fact_count INTEGER NOT NULL CHECK (typeof(fact_count) = 'integer' AND fact_count >= 0),
      chunk_count INTEGER NOT NULL CHECK (typeof(chunk_count) = 'integer' AND chunk_count >= 0),
      payload_json TEXT NOT NULL,
      payload_checksum TEXT NOT NULL CHECK (${hex64("payload_checksum")}),
      created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
      PRIMARY KEY (workspace_id, trace_id)
    );

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_retrieval_origin_traces_immutable_update
      BEFORE UPDATE ON candidate_knowledge_retrieval_origin_traces
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge retrieval origin traces are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_retrieval_origin_traces_immutable_delete
      BEFORE DELETE ON candidate_knowledge_retrieval_origin_traces
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge retrieval origin traces are immutable'); END;
  `.trim(),
} as const;

const maximumSelectedItems = 100;
const maximumIdentifierLength = 120;
const maximumProfileIdLength = 200;
const safeIdentifier = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u;
const hexSha256 = /^[0-9a-f]{64}$/u;
const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

const inputKeys = [
  "workspaceId",
  "traceId",
  "queryChecksum",
  "profile",
  "factRankingMode",
  "selectedItems",
  "createdAt",
] as const;
const profileKeys = ["profileId", "version", "checksum"] as const;
const itemKeys = ["itemId", "origin", "sourceId"] as const;

function invalid(field: string): StorageValidationError {
  return new StorageValidationError(`Retrieval origin trace ${field} is invalid`);
}

function requireObject(
  value: unknown,
  field: string,
  allowed: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid(field);
  const record = value as Record<string, unknown>;
  const exact =
    Object.keys(record).every((key) => allowed.includes(key)) &&
    allowed.every((key) => key in record);
  if (!exact) {
    throw new StorageValidationError(`Retrieval origin trace ${field} has unexpected fields`);
  }
  return record;
}

function requireIdentifier(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumIdentifierLength ||
    !safeIdentifier.test(value)
  ) {
    throw new StorageValidationError(
      `Retrieval origin trace ${field} must be a safe opaque identifier`,
    );
  }
  return value;
}

/** Profile ids are user-chosen names, so they are bounded text rather than opaque identifiers. */
function requireProfileId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    value.length > maximumProfileIdLength ||
    /\p{Cc}/u.test(value)
  ) {
    throw invalid("profile id");
  }
  return value;
}

function requireChecksum(value: unknown, field: string): string {
  if (typeof value !== "string" || !hexSha256.test(value)) throw invalid(field);
  return value;
}

function requireMember<Member extends string>(
  value: unknown,
  members: readonly Member[],
  field: string,
): Member {
  const member = members.find((candidate) => candidate === value);
  if (member === undefined) throw invalid(field);
  return member;
}

function validatedProfile(value: unknown): RetrievalOriginTraceProfile {
  const record = requireObject(value, "profile", profileKeys);
  const { version } = record;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) {
    throw invalid("profile version");
  }
  return Object.freeze({
    profileId: requireProfileId(record.profileId),
    version,
    checksum: requireChecksum(record.checksum, "profile checksum"),
  });
}

function validatedItems(value: unknown): readonly RetrievalOriginTraceItem[] {
  if (!Array.isArray(value) || value.length > maximumSelectedItems) {
    throw new StorageValidationError(
      `Retrieval origin trace selectedItems must be an array of at most ${maximumSelectedItems} entries`,
    );
  }
  const seen = new Set<string>();
  return Object.freeze(
    (value as readonly unknown[]).map((entry) => {
      const record = requireObject(entry, "selected item", itemKeys);
      const itemId = requireIdentifier(record.itemId, "item id");
      if (seen.has(itemId)) {
        throw new StorageValidationError("Retrieval origin trace item ids must be unique");
      }
      seen.add(itemId);
      return Object.freeze({
        itemId,
        origin: requireMember(record.origin, retrievalOriginTraceOrigins, "item origin"),
        sourceId: requireIdentifier(record.sourceId, "source id"),
      });
    }),
  );
}

function requireTimestamp(value: unknown): string {
  if (typeof value !== "string" || !isoTimestamp.test(value) || Number.isNaN(Date.parse(value))) {
    throw new StorageValidationError(
      "Retrieval origin trace createdAt must be a valid ISO timestamp",
    );
  }
  return value;
}

function validatedTrace(inputValue: unknown): RetrievalOriginTraceInput {
  const input = requireObject(inputValue, "input", inputKeys);
  return {
    workspaceId: requireIdentifier(input.workspaceId, "workspaceId"),
    traceId: requireIdentifier(input.traceId, "trace id"),
    queryChecksum: requireChecksum(input.queryChecksum, "query checksum"),
    profile: validatedProfile(input.profile),
    factRankingMode: requireMember(
      input.factRankingMode,
      retrievalOriginTraceModes,
      "fact ranking mode",
    ),
    selectedItems: validatedItems(input.selectedItems),
    createdAt: requireTimestamp(input.createdAt),
  };
}

function payloadJson(selectedItems: readonly RetrievalOriginTraceItem[]): string {
  return JSON.stringify({
    selectedItems: selectedItems.map(({ itemId, origin, sourceId }) => ({
      itemId,
      origin,
      sourceId,
    })),
  });
}

function checksumOf(json: string): string {
  return createHash("sha256").update(json, "utf8").digest("hex");
}

function stringColumn(row: Record<string, unknown>, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new StorageValidationError("Stored retrieval origin trace is invalid");
  }
  return value;
}

const selectColumns =
  "workspace_id, trace_id, query_checksum, profile_id, profile_version, profile_checksum, fact_ranking_mode, fact_count, chunk_count, payload_json, payload_checksum, created_at";
const selectSql = `SELECT ${selectColumns} FROM candidate_knowledge_retrieval_origin_traces WHERE workspace_id = ? AND trace_id = ?`;
const listSql = `SELECT ${selectColumns} FROM candidate_knowledge_retrieval_origin_traces WHERE workspace_id = ? ORDER BY created_at, trace_id`;

function traceFromRow(row: Record<string, unknown>): RetrievalOriginTrace {
  const json = stringColumn(row, "payload_json");
  const payloadChecksum = stringColumn(row, "payload_checksum");
  if (checksumOf(json) !== payloadChecksum) {
    throw new StorageValidationError(
      "Stored retrieval origin trace checksum does not match its payload",
    );
  }
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    throw new StorageValidationError("Stored retrieval origin trace is invalid");
  }
  const selectedItems = validatedItems(
    requireObject(payload, "payload", ["selectedItems"]).selectedItems,
  );
  const facts = selectedItems.filter(({ origin }) => origin === "profile-fact").length;
  if (row.fact_count !== facts || row.chunk_count !== selectedItems.length - facts) {
    throw new StorageValidationError("Stored retrieval origin trace counts are inconsistent");
  }
  return Object.freeze({
    workspaceId: stringColumn(row, "workspace_id"),
    traceId: stringColumn(row, "trace_id"),
    queryChecksum: stringColumn(row, "query_checksum"),
    profile: Object.freeze({
      profileId: stringColumn(row, "profile_id"),
      version: Number(row.profile_version),
      checksum: stringColumn(row, "profile_checksum"),
    }),
    factRankingMode: requireMember(
      row.fact_ranking_mode,
      retrievalOriginTraceModes,
      "fact ranking mode",
    ),
    selectedItems,
    payloadChecksum,
    createdAt: stringColumn(row, "created_at"),
  });
}

function sameTrace(
  stored: RetrievalOriginTrace,
  trace: RetrievalOriginTraceInput,
  checksum: string,
): boolean {
  return (
    stored.payloadChecksum === checksum &&
    stored.queryChecksum === trace.queryChecksum &&
    stored.profile.profileId === trace.profile.profileId &&
    stored.profile.version === trace.profile.version &&
    stored.profile.checksum === trace.profile.checksum &&
    stored.factRankingMode === trace.factRankingMode &&
    stored.createdAt === trace.createdAt
  );
}

/** Builds the retrieval origin trace port over a database handle; `ensureOpen` guards each call. */
export function createRetrievalOriginTraceStorage(
  database: RetrievalOriginTraceDatabase,
  ensureOpen: () => void,
): RetrievalOriginTraceStoragePort {
  return {
    appendRetrievalOriginTrace: async (inputValue) => {
      ensureOpen();
      const trace = validatedTrace(inputValue);
      const json = payloadJson(trace.selectedItems);
      const checksum = checksumOf(json);
      const facts = trace.selectedItems.filter(({ origin }) => origin === "profile-fact").length;
      let result: RetrievalOriginTrace | undefined;
      database.transaction(() => {
        const existing = database.prepare(selectSql).get(trace.workspaceId, trace.traceId);
        if (existing !== undefined) {
          const stored = traceFromRow(existing);
          if (!sameTrace(stored, trace, checksum)) {
            throw new StorageConflictError("Retrieval origin trace is immutable");
          }
          result = stored;
          return;
        }
        database
          .prepare(
            `INSERT INTO candidate_knowledge_retrieval_origin_traces (${selectColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            trace.workspaceId,
            trace.traceId,
            trace.queryChecksum,
            trace.profile.profileId,
            trace.profile.version,
            trace.profile.checksum,
            trace.factRankingMode,
            facts,
            trace.selectedItems.length - facts,
            json,
            checksum,
            trace.createdAt,
          );
        result = Object.freeze({ ...trace, payloadChecksum: checksum });
      })();
      return result as RetrievalOriginTrace;
    },
    getRetrievalOriginTrace: async (workspaceId, traceId) => {
      ensureOpen();
      const row = database
        .prepare(selectSql)
        .get(requireIdentifier(workspaceId, "workspaceId"), requireIdentifier(traceId, "trace id"));
      return row === undefined ? undefined : traceFromRow(row);
    },
    listRetrievalOriginTraces: async (workspaceId) => {
      ensureOpen();
      return Object.freeze(
        database
          .prepare(listSql)
          .all(requireIdentifier(workspaceId, "workspaceId"))
          .map((row) => traceFromRow(row)),
      );
    },
  };
}
