import { z } from "zod";
import { strictTimestampSchema } from "./schema-primitives.js";

/**
 * Record archive v1: everything the hosted service keeps about one candidate record, as one file
 * set (ADR 0011, D7). The manifest lists every other file with its SHA-256 and size; table files
 * hold the record's rows as stored, and objects hold the original bytes of each source version
 * and exported document, addressed by their SHA-256. See docs/reference/record-archive.md.
 */
export const recordArchiveFormat = "draft-loop-record-archive";
export const recordArchiveFormatVersion = 1;

/** The manifest's own path. It is never listed among its entries. */
export const recordArchiveManifestPath = "manifest.json";

/**
 * The tables an archive may hold, in the order a writer emits them. Anything else, such as the
 * organisation's members, record assignments, idempotency keys or derived search indexes, is
 * never part of an archive.
 */
export const recordArchiveTables = [
  "workspace_settings",
  "workspaces",
  "consent_events",
  "writing_policy_versions",
  "canonical_candidate_profile_versions",
  "opportunity_brief_versions",
  "applications",
  "application_run_bindings",
  "application_brief_bindings",
  "application_archives",
  "application_model_profiles",
  "application_chosen_runs",
  "default_application_names",
  "context_snapshots",
  "artifact_versions",
  "runs",
  "run_snapshots",
  "rounds",
  "executions",
  "findings",
  "decisions",
  "exports",
  "run_state_entries",
  "candidate_knowledge_retrieval_traces",
  "audit_events",
  "knowledge_base_owners",
  "candidate_knowledge_bases",
  "candidate_knowledge_sources",
  "candidate_knowledge_source_versions",
  "candidate_knowledge_managed_source_versions",
  "candidate_knowledge_source_sensitivity_rule_versions",
  "content_screening_results",
  "content_screening_releases",
] as const;

export type RecordArchiveTable = (typeof recordArchiveTables)[number];

/** At most this many files besides the manifest, so a zip needs no ZIP64 entry count. */
export const maximumRecordArchiveEntries = 65_534;

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u, "must be a lowercase hex SHA-256");
const sizeSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const tableSchema = z.enum(recordArchiveTables);

export function recordArchiveTablePath(table: RecordArchiveTable): string {
  return `tables/${table}.json`;
}

export function recordArchiveObjectPath(sha256: string): string {
  return `objects/${sha256}`;
}

const tableEntrySchema = z
  .object({
    kind: z.literal("table"),
    path: z.string(),
    table: tableSchema,
    sha256: sha256Schema,
    sizeBytes: sizeSchema,
  })
  .strict()
  .refine((entry) => entry.path === recordArchiveTablePath(entry.table), {
    message: "a table's path must be tables/<table>.json",
    path: ["path"],
  });

const objectEntrySchema = z
  .object({
    kind: z.literal("object"),
    path: z.string(),
    sha256: sha256Schema,
    sizeBytes: sizeSchema,
  })
  .strict()
  .refine((entry) => entry.path === recordArchiveObjectPath(entry.sha256), {
    message: "an object's path must be objects/<sha256>",
    path: ["path"],
  });

export const recordArchiveEntrySchema = z.discriminatedUnion("kind", [
  tableEntrySchema,
  objectEntrySchema,
]);

export type RecordArchiveEntry = z.infer<typeof recordArchiveEntrySchema>;

export const recordArchiveManifestSchema = z
  .object({
    format: z.literal(recordArchiveFormat),
    formatVersion: z.literal(recordArchiveFormatVersion),
    createdAt: strictTimestampSchema,
    record: z
      .object({
        workspaceId: z
          .string()
          .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier"),
      })
      .strict(),
    entries: z.array(recordArchiveEntrySchema).max(maximumRecordArchiveEntries),
  })
  .strict()
  .superRefine((manifest, context) => {
    const paths = new Set<string>();
    manifest.entries.forEach((entry, index) => {
      if (paths.has(entry.path)) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "path"],
          message: "each path must be listed once",
        });
      }
      paths.add(entry.path);
    });
  });

export type RecordArchiveManifest = z.infer<typeof recordArchiveManifestSchema>;

/**
 * One table file: the record's rows of that table as the service stores them, one object per
 * row keyed by column name, without the tenant column. Text payloads keep their stored text, so
 * their recorded checksums still verify them.
 */
export const recordArchiveTableFileSchema = z
  .object({
    table: tableSchema,
    rows: z.array(z.record(z.string(), z.unknown())),
  })
  .strict()
  .refine((file) => file.rows.every((row) => !Object.hasOwn(row, "tenant_id")), {
    message: "rows never carry the tenant column",
    path: ["rows"],
  });

export type RecordArchiveTableFile = z.infer<typeof recordArchiveTableFileSchema>;
