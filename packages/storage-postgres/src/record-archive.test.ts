import { createHash } from "node:crypto";

import {
  recordArchiveManifestSchema,
  recordArchiveTableFileSchema,
  recordArchiveTables,
} from "@draft-loop/schemas/record-archive";
import type { BlobReference, BlobStoragePort } from "@draft-loop/storage";
import type { RecordArchiveFile } from "@draft-loop/storage/record-archive";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hostedWorkspaceReference } from "./hosted-application-ports.js";
import type { PostgresTenancy } from "./postgres-storage.js";
import { openPostgresRecordArchives } from "./record-archive.js";
import type { SqlExecutor } from "./sql-client.js";
import { createTestSchema, type TestSchema } from "./test-schema.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const at = "2026-10-24T10:00:00.000Z";
const sha = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");

/** A blob store per tenant, in memory, that checks references as Cloud Storage's adapter does. */
function memoryBlobs() {
  const objects = new Map<string, Uint8Array>();
  const matches = (reference: BlobReference) => {
    const content = objects.get(reference.location);
    return content !== undefined &&
      content.byteLength === reference.sizeBytes &&
      sha(content) === reference.checksum
      ? content
      : undefined;
  };
  const port: BlobStoragePort = {
    put: async (location, content) => {
      objects.set(location, content);
      return { location, checksum: sha(content), sizeBytes: content.byteLength };
    },
    get: async (reference) => matches(reference),
    exists: async (reference) => matches(reference) !== undefined,
    delete: async (reference) =>
      matches(reference) !== undefined && objects.delete(reference.location),
  };
  return { port, objects };
}

/**
 * One fictional candidate record: every table that holds its data gets one row carrying the
 * record's marker, plus the source and export bytes its rows reference. The markers are not hex,
 * so no checksum can contain one by chance.
 */
interface RecordFixture {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly historyId: string;
  readonly runId: string;
  readonly knowledgeBaseId: string;
  readonly marker: string;
}

const encoder = new TextEncoder();

async function seedRecord(
  executor: SqlExecutor,
  blobs: BlobStoragePort,
  record: RecordFixture,
): Promise<void> {
  const { workspaceId, historyId: w, runId: run, knowledgeBaseId: kb, marker } = record;
  const reference = hostedWorkspaceReference(record.tenantId, workspaceId);
  const payload = JSON.stringify({ note: `fictional ${marker}` });
  const checksum = sha(payload);
  const q = (text: string, parameters: readonly unknown[]) => executor.query(text, parameters);

  await q("SELECT set_config('draft_loop.tenant_id', $1, true)", [record.tenantId]);
  await q(
    "INSERT INTO workspace_settings (workspace_ref, name, content) VALUES ($1, 'workspace.json', $2)",
    [reference, JSON.stringify({ id: w, instructions: `Write for ${marker}.` })],
  );
  await q("INSERT INTO workspaces (id, state, created_at, updated_at) VALUES ($1, $2, $3, $3)", [
    w,
    `ready-${marker}`,
    at,
  ]);
  await q(
    `INSERT INTO consent_events (id, workspace_id, kind, action, basis, recorded_by, providers, note)
     VALUES ($1, $2, 'provider-transmission', 'granted', 'candidate-consent', 'owner', '{anthropic,openai}', $3)`,
    [`consent-${run}`, w, `Agreed by ${marker}.`],
  );
  await q(
    `INSERT INTO writing_policy_versions
       (workspace_id, policy_checksum, version, schema_version, created_at, payload_json, payload_checksum)
     VALUES ($1, $2, 'v1', 1, $3, $4, $2)`,
    [w, checksum, at, payload],
  );
  await q(
    `INSERT INTO canonical_candidate_profile_versions
       (workspace_id, profile_id, version, schema_version, status, created_at, updated_at, payload_json, payload_checksum)
     VALUES ($1, 'profile', 1, 1, 'draft', $2, $2, $3, $4)`,
    [w, at, payload, checksum],
  );
  await q(
    `INSERT INTO opportunity_brief_versions
       (workspace_id, brief_id, version, schema_version, status, created_at, payload_json, payload_checksum)
     VALUES ($1, 'brief', 1, 1, 'draft', $2, $3, $4)`,
    [w, at, payload, checksum],
  );
  await q(
    `INSERT INTO applications (workspace_id, application_id, name, job_source_json, created_at, updated_at)
     VALUES ($1, 'application', $2, '{}', $3, $3)`,
    [w, `Role at ${marker}`, at],
  );
  await q(
    `INSERT INTO application_brief_bindings (workspace_id, brief_id, application_id, created_at)
     VALUES ($1, 'brief', 'application', $2)`,
    [w, at],
  );
  await q(
    "INSERT INTO application_archives (workspace_id, application_id, archived_at) VALUES ($1, $2, $3)",
    [w, `archived-${marker}`, at],
  );
  await q(
    `INSERT INTO application_model_profiles (workspace_id, application_id, model_profiles_json, updated_at)
     VALUES ($1, 'application', $2, $3)`,
    [w, JSON.stringify({ label: marker }), at],
  );
  await q(
    "INSERT INTO default_application_names (workspace_id, name, updated_at) VALUES ($1, $2, $3)",
    [w, `Default ${marker}`, at],
  );
  await q(
    `INSERT INTO context_snapshots (id, workspace_id, schema_version, created_at, payload_json, payload_checksum)
     VALUES ($1, $2, 1, $3, $4, $5)`,
    [`context-${run}`, w, at, payload, checksum],
  );
  await q(
    `INSERT INTO artifact_versions (id, workspace_id, version, created_at, payload_json, payload_checksum)
     VALUES ($1, $2, 1, $3, $4, $5)`,
    [`artifact-${run}`, w, at, payload, checksum],
  );
  await q(
    `INSERT INTO runs (id, workspace_id, context_snapshot_id, state, round, budget_json, approval,
       total_cost_usd, started_at, updated_at, payload_json, record_checksum)
     VALUES ($1, $2, $3, 'approved', 1, '{}', 'approved', 0.5, $4, $4, $5, $6)`,
    [run, w, `context-${run}`, at, payload, checksum],
  );
  await q(
    `INSERT INTO application_run_bindings (workspace_id, run_id, application_id, created_at)
     VALUES ($1, $2, 'application', $3)`,
    [w, run, at],
  );
  await q(
    `INSERT INTO application_chosen_runs (workspace_id, application_id, run_id, reason, chosen_at)
     VALUES ($1, 'application', $2, $3, $4)`,
    [w, run, `Clearer for ${marker}`, at],
  );
  await q(
    `INSERT INTO run_snapshots (id, workspace_id, run_id, context_snapshot_id, state, round, budget_json,
       approval, total_cost_usd, started_at, updated_at, payload_json, record_checksum)
     VALUES ($1, $2, $3, $4, 'approved', 1, '{}', 'approved', 0.5, $5, $5, $6, $7)`,
    [`snapshot-${run}`, w, run, `context-${run}`, at, payload, checksum],
  );
  await q(
    `INSERT INTO rounds (id, workspace_id, run_id, number, state, started_at, payload_json, record_checksum)
     VALUES ($1, $2, $3, 1, 'completed', $4, $5, $6)`,
    [`round-${run}`, w, run, at, payload, checksum],
  );
  await q(
    `INSERT INTO executions (id, workspace_id, run_id, round_id, context_snapshot_id, attempt, step,
       status, provider, model_id, input_tokens, output_tokens, total_tokens, started_at, payload_json,
       record_checksum)
     VALUES ($1, $2, $3, $4, $5, 1, 'author', 'completed', 'anthropic', 'scripted-author', 10, 20, 30,
       $6, $7, $8)`,
    [`execution-${run}`, w, run, `round-${run}`, `context-${run}`, at, payload, checksum],
  );
  await q(
    `INSERT INTO findings (id, workspace_id, run_id, round_id, code, category, severity, message,
       created_at, payload_json, record_checksum)
     VALUES ($1, $2, $3, $4, 'unsupported', 'grounding', 'warning', $5, $6, $7, $8)`,
    [`finding-${run}`, w, run, `round-${run}`, `Cite ${marker}.`, at, payload, checksum],
  );
  await q(
    `INSERT INTO decisions (id, workspace_id, run_id, type, rationale, actor, created_at, payload_json,
       record_checksum)
     VALUES ($1, $2, $3, 'approve', $4, 'candidate', $5, $6, $7)`,
    [`decision-${run}`, w, run, `Fits ${marker}.`, at, payload, checksum],
  );
  const exported = encoder.encode(`# CV\n\nFictional draft for ${marker}.\n`);
  const exportPath = `${reference}/exports/${run}/document.md`;
  await blobs.put(exportPath.slice(1), exported);
  await q(
    `INSERT INTO exports (id, workspace_id, run_id, artifact_id, format, status, output_path,
       output_checksum, created_at, payload_json, record_checksum)
     VALUES ($1, $2, $3, $4, 'markdown', 'completed', $5, $6, $7, $8, $9)`,
    [
      `export-${run}`,
      w,
      run,
      `artifact-${run}`,
      exportPath,
      sha(exported),
      at,
      JSON.stringify({ sizeBytes: exported.byteLength, mimeType: "text/markdown", note: marker }),
      checksum,
    ],
  );
  for (const key of [
    `run:${run}`,
    `execution:${run}:execution-${run}`,
    `artifact:${run}:artifact-${run}`,
    `latest:${run}:1:author`,
  ]) {
    await q("INSERT INTO run_state_entries (key, value) VALUES ($1, $2)", [
      `draft-loop:orchestration:${key}`,
      JSON.stringify({ marker }),
    ]);
  }
  await q(
    `INSERT INTO candidate_knowledge_retrieval_traces (workspace_id, trace_id, schema_version,
       operation_id, purpose, query_checksum, payload_json, payload_checksum, created_at)
     VALUES ($1, $2, 1, $3, 'critic-review', $4, $5, $4, $6)`,
    [w, `trace-${run}`, `operation-${run}`, checksum, payload, at],
  );
  await q(
    `INSERT INTO audit_events (id, workspace_id, event_type, entity_type, entity_id, payload_json,
       payload_checksum, event_checksum, created_at)
     VALUES ($1, $2, 'run.approved', 'run', $3, $4, $5, $5, $6)`,
    [`audit-${run}`, w, run, payload, checksum, at],
  );

  await q(
    `INSERT INTO candidate_knowledge_bases (id, display_name, description, state, is_default,
       created_at, updated_at)
     VALUES ($1, $2, '', 'active', 0, $3, $3)`,
    [kb, `Career notes of ${marker}`, at],
  );
  await q("INSERT INTO knowledge_base_owners (knowledge_base_id, workspace_id) VALUES ($1, $2)", [
    kb,
    workspaceId,
  ]);
  await q(
    `INSERT INTO candidate_knowledge_sources (id, candidate_knowledge_base_id, kind, display_name, created_at)
     VALUES ($1, $2, 'file', $3, $4)`,
    [`source-${kb}`, kb, `notes-${marker}.md`, at],
  );
  const source = encoder.encode(
    `# Experience\n\nBuilt TypeScript services, codenamed ${marker}.\n`,
  );
  const sourceLocation = `knowledge/version-${kb}`;
  await blobs.put(sourceLocation, source);
  await q(
    `INSERT INTO candidate_knowledge_source_versions (id, source_id, version, media_type, checksum,
       size_bytes, created_at)
     VALUES ($1, $2, 1, 'text/markdown', $3, $4, $5)`,
    [`version-${kb}`, `source-${kb}`, sha(source), source.byteLength, at],
  );
  await q(
    `INSERT INTO candidate_knowledge_managed_source_versions (version_id, source_id, blob_location, recorded_at)
     VALUES ($1, $2, $3, $4)`,
    [`version-${kb}`, `source-${kb}`, sourceLocation, at],
  );
  await q(
    `INSERT INTO candidate_knowledge_source_sensitivity_rule_versions (knowledge_base_id, version,
       rules_json, checksum, created_at)
     VALUES ($1, 1, $2, $3, $4)`,
    [kb, JSON.stringify({ rules: [{ heading: marker }] }), checksum, at],
  );
  // Never archived: command results and the tenant's store list.
  await q(
    `INSERT INTO idempotency_keys (scope, key, fingerprint, result_json, expires_at)
     VALUES ($1, 'key-0001', $2, $3, now() + interval '1 day')`,
    [`exports:${workspaceId}:${run}`, checksum, JSON.stringify({ marker })],
  );
}

/** Tables whose rows hold only keys and times, so they carry ids rather than a marker. */
const keyOnlyTables = new Set<string>([
  "application_run_bindings",
  "application_brief_bindings",
  "knowledge_base_owners",
  "candidate_knowledge_source_versions",
  "candidate_knowledge_managed_source_versions",
]);

async function collect(files: AsyncIterable<RecordArchiveFile>): Promise<RecordArchiveFile[]> {
  const collected: RecordArchiveFile[] = [];
  for await (const file of files) collected.push(file);
  return collected;
}

describe.runIf(connectionString !== undefined)("Postgres record archives", () => {
  const url = connectionString ?? "";
  let schema: TestSchema;
  let tenancy: PostgresTenancy;
  const north = memoryBlobs();
  const south = memoryBlobs();

  // Two records of one organisation, and a record of another organisation with the same ids.
  const first: RecordFixture = {
    tenantId: "org-north",
    workspaceId: "coach-1",
    historyId: "history-1",
    runId: "run-1",
    knowledgeBaseId: "kb-1",
    marker: "alder-quill",
  };
  // Its run id extends the first record's, so a key prefix match without its separator would leak.
  const second: RecordFixture = {
    ...first,
    workspaceId: "coach-2",
    historyId: "history-2",
    runId: "run-10",
    knowledgeBaseId: "kb-2",
    marker: "birch-otter",
  };
  const otherTenant: RecordFixture = { ...first, tenantId: "org-south", marker: "cedar-wren" };

  const archives = (blobs: BlobStoragePort = north.port) =>
    openPostgresRecordArchives({
      storage: tenancy.forTenant("org-north"),
      tenantId: "org-north",
      blobs,
      now: () => new Date(at),
    });

  beforeAll(async () => {
    schema = await createTestSchema(url, "record_archive");
    for (const [record, blobs] of [
      [first, north.port],
      [second, north.port],
      [otherTenant, south.port],
    ] as const) {
      await schema.admin.transaction((executor) => seedRecord(executor, blobs, record));
    }
    tenancy = await schema.openTenancy();
  });

  afterAll(async () => {
    await tenancy?.close();
    await schema?.drop();
  });

  it("holds every row and object of one record and nothing of another record or tenant", async () => {
    const archive = await archives().prepare({
      workspaceId: first.workspaceId,
      historyId: first.historyId,
      knowledgeScope: "owned",
    });
    const files = await collect(archive.files());
    const [manifestFile, ...rest] = files;
    expect(manifestFile?.path).toBe("manifest.json");
    expect(sha(manifestFile?.content ?? new Uint8Array())).toBe(archive.manifestSha256);
    const manifest = recordArchiveManifestSchema.parse(
      JSON.parse(new TextDecoder().decode(manifestFile?.content)),
    );
    expect(manifest).toEqual(archive.manifest);
    expect(manifest.record).toEqual({ workspaceId: "coach-1" });
    expect(manifest.createdAt).toBe(at);

    // Every table is present, each with exactly this record's rows, and both objects follow.
    expect(manifest.entries.filter((entry) => entry.kind === "table").map((e) => e.path)).toEqual(
      recordArchiveTables.map((table) => `tables/${table}.json`),
    );
    expect(manifest.entries.filter((entry) => entry.kind === "object")).toHaveLength(2);
    expect(rest.map((file) => file.path)).toEqual(manifest.entries.map((entry) => entry.path));
    for (const [index, entry] of manifest.entries.entries()) {
      const content = rest[index]?.content ?? new Uint8Array();
      expect(sha(content), entry.path).toBe(entry.sha256);
      expect(content.byteLength, entry.path).toBe(entry.sizeBytes);
    }

    const decoder = new TextDecoder();
    for (const file of rest.filter((candidate) => candidate.path.startsWith("tables/"))) {
      const parsed = recordArchiveTableFileSchema.parse(JSON.parse(decoder.decode(file.content)));
      const expected = parsed.table === "run_state_entries" ? 4 : 1;
      expect(parsed.rows, parsed.table).toHaveLength(expected);
      const text = decoder.decode(file.content);
      if (keyOnlyTables.has(parsed.table)) {
        expect(text, parsed.table).toMatch(/"(history-1|coach-1|kb-1|source-kb-1|version-kb-1)"/u);
      } else {
        expect(text, parsed.table).toContain(first.marker);
      }
    }

    const everything = files.map((file) => decoder.decode(file.content)).join("\n");
    expect(everything).toContain("Built TypeScript services, codenamed alder-quill.");
    expect(everything).toContain("Fictional draft for alder-quill.");
    expect(everything).not.toContain(second.marker);
    expect(everything).not.toContain(otherTenant.marker);
    expect(everything).not.toContain("tenant_id");
    expect(everything).not.toContain("key-0001");
  });

  it("holds every base of the tenant in owner-token scope, and still no other record's runs", async () => {
    const archive = await archives().prepare({
      workspaceId: first.workspaceId,
      historyId: first.historyId,
      knowledgeScope: "tenant",
    });
    const decoder = new TextDecoder();
    const files = await collect(archive.files());
    const table = (name: string) => {
      const file = files.find((candidate) => candidate.path === `tables/${name}.json`);
      return recordArchiveTableFileSchema.parse(JSON.parse(decoder.decode(file?.content))).rows;
    };
    expect(table("candidate_knowledge_bases").map((row) => row.id)).toEqual(["kb-1", "kb-2"]);
    expect(table("candidate_knowledge_sources")).toHaveLength(2);
    expect(table("candidate_knowledge_source_sensitivity_rule_versions")).toHaveLength(2);
    expect(table("knowledge_base_owners").map((row) => row.knowledge_base_id)).toEqual(["kb-1"]);
    expect(table("runs").map((row) => row.id)).toEqual(["run-1"]);
    // Both bases' sources and the record's own export.
    expect(archive.manifest.entries.filter((entry) => entry.kind === "object")).toHaveLength(3);
    const everything = files.map((file) => decoder.decode(file.content)).join("\n");
    expect(everything).toContain("codenamed alder-quill");
    expect(everything).toContain("codenamed birch-otter");
    expect(everything).not.toContain("Fictional draft for birch-otter.");
    expect(everything).not.toContain(otherTenant.marker);
  });

  it("archives the second record apart from the first", async () => {
    const archive = await archives().prepare({
      workspaceId: second.workspaceId,
      historyId: second.historyId,
      knowledgeScope: "owned",
    });
    const text = (await collect(archive.files()))
      .map((file) => new TextDecoder().decode(file.content))
      .join("\n");
    expect(text).toContain(second.marker);
    expect(text).not.toContain(first.marker);
    expect(text).not.toContain(otherTenant.marker);
  });

  it("fails closed on a missing or changed object, before and while streaming", async () => {
    const integrity = expect.objectContaining({
      name: "RecordArchiveError",
      code: "object_integrity",
    });
    const request = {
      workspaceId: first.workspaceId,
      historyId: first.historyId,
      knowledgeScope: "owned" as const,
    };
    const sourceLocation = `knowledge/version-${first.knowledgeBaseId}`;
    const exportLocation = `${hostedWorkspaceReference("org-north", "coach-1").slice(1)}/exports/run-1/document.md`;
    const original = north.objects.get(sourceLocation) ?? new Uint8Array();

    north.objects.delete(sourceLocation);
    await expect(archives().prepare(request)).rejects.toEqual(integrity);
    north.objects.set(sourceLocation, encoder.encode("changed bytes"));
    await expect(archives().prepare(request)).rejects.toEqual(integrity);
    north.objects.set(sourceLocation, original);

    // Prepared while whole, then changed before its bytes are reached: the stream throws.
    const archive = await archives().prepare(request);
    const exported = north.objects.get(exportLocation) ?? new Uint8Array();
    north.objects.set(exportLocation, encoder.encode("tampered"));
    await expect(collect(archive.files())).rejects.toEqual(integrity);
    north.objects.set(exportLocation, exported);
    await expect(collect(archive.files())).resolves.toHaveLength(
      archive.manifest.entries.length + 1,
    );
  });

  it("holds only the manifest for a record with nothing stored", async () => {
    const archive = await archives().prepare({
      workspaceId: "coach-new",
      historyId: "history-new",
      knowledgeScope: "owned",
    });
    expect(archive.manifest.entries).toEqual([]);
    await expect(collect(archive.files())).resolves.toHaveLength(1);
  });
});
