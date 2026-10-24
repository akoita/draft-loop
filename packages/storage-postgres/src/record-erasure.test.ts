import { describe, expect, it } from "vitest";
import { createSqlPool, type SqlClient } from "./sql-client.js";
import { createTestSchema, runtimeRoleUrl, type TestSchema } from "./test-schema.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const at = "2026-10-24T10:00:00.000Z";
const checksum = "0".repeat(64);

/** Tables that hold a tenant's own rows, not any one record's. */
const tenantWideTables = new Set([
  "schema_migrations",
  "organisations",
  "organisation_members",
  "candidate_knowledge_stores",
  "candidate_record_erasures",
]);

/** The tenant's directory rows and knowledge store, as baseline for its records. */
async function seedTenant(admin: SqlClient, tenant: string): Promise<void> {
  await admin.query("INSERT INTO organisations (id, name) VALUES ($1, $2)", [
    tenant,
    `Fictional organisation ${tenant}`,
  ]);
  await admin.query(
    `INSERT INTO organisation_members (tenant_id, id, email, role, status)
     VALUES ($1, 'member-1', $2, 'owner', 'invited')`,
    [tenant, `member-1@${tenant}.example.test`],
  );
  await admin.query(
    "INSERT INTO candidate_knowledge_stores (tenant_id, id, created_at) VALUES ($1, 'knowledge', $2)",
    [tenant, at],
  );
}

/**
 * One candidate record with a row in every table a record reaches, written around the storage
 * as the superuser: history under its history id, an owned knowledge base with two source
 * versions and both indexes, settings, run state, idempotency keys, an assignment and consent.
 */
async function seedRecord(
  admin: SqlClient,
  tenant: string,
  record: string,
  options: { readonly runState?: string } = {},
): Promise<void> {
  const history = `workspace-${record}`;
  const p = `${record}-`;
  const run = `${p}run`;
  const base = `${p}kb`;
  const source = `${p}source`;
  const statements: [string, unknown[]][] = [
    [
      "INSERT INTO workspaces (tenant_id, id, state, created_at, updated_at) VALUES ($1, $2, 'collecting', $3, $3)",
      [tenant, history, at],
    ],
    [
      `INSERT INTO context_snapshots (tenant_id, id, workspace_id, schema_version, created_at, payload_json, payload_checksum)
       VALUES ($1, $2, $3, 1, $4, '{}', $5)`,
      [tenant, `${p}context`, history, at, checksum],
    ],
    [
      `INSERT INTO artifact_versions (tenant_id, id, workspace_id, version, parent_version_id, created_at, payload_json, payload_checksum)
       VALUES ($1, $2, $3, 1, NULL, $4, '{}', $5), ($1, $6, $3, 2, $2, $4, '{}', $5)`,
      [tenant, `${p}artifact-1`, history, at, checksum, `${p}artifact-2`],
    ],
    [
      `INSERT INTO audit_events (tenant_id, id, workspace_id, event_type, entity_type, entity_id, payload_json, payload_checksum, previous_event_checksum, event_checksum, created_at)
       VALUES ($1, $2, $3, 'workspace.saved', 'workspace', $3, '{}', $4, NULL, $4, $5)`,
      [tenant, `${p}audit`, history, checksum, at],
    ],
    [
      `INSERT INTO runs (tenant_id, id, workspace_id, context_snapshot_id, state, round, budget_json, artifact_id, approval, total_cost_usd, started_at, updated_at, payload_json, record_checksum)
       VALUES ($1, $2, $3, $4, 'collecting', 1, '{}', $5, 'pending', 0, $6, $6, '{}', $7)`,
      [tenant, run, history, `${p}context`, `${p}artifact-2`, at, checksum],
    ],
    [
      `INSERT INTO run_snapshots (tenant_id, id, workspace_id, run_id, context_snapshot_id, state, round, budget_json, approval, total_cost_usd, started_at, updated_at, payload_json, record_checksum)
       VALUES ($1, $2, $3, $4, $5, 'collecting', 1, '{}', 'pending', 0, $6, $6, '{}', $7),
              ($1, $8, $3, $4, $5, $9, 1, '{}', 'pending', 0, $6, $6, '{}', $10)`,
      [
        tenant,
        `${p}snapshot-1`,
        history,
        run,
        `${p}context`,
        at,
        checksum,
        `${p}snapshot-2`,
        options.runState ?? "awaiting-review",
        "1".repeat(64),
      ],
    ],
    [
      `INSERT INTO rounds (tenant_id, id, workspace_id, run_id, number, state, started_at, payload_json, record_checksum)
       VALUES ($1, $2, $3, $4, 1, 'completed', $5, '{}', $6)`,
      [tenant, `${p}round`, history, run, at, checksum],
    ],
    [
      `INSERT INTO executions (tenant_id, id, workspace_id, run_id, round_id, context_snapshot_id, artifact_id, attempt, step, status, provider, model_id, input_tokens, output_tokens, total_tokens, started_at, payload_json, record_checksum)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 'author', 'completed', 'scripted', 'scripted-model', 1, 1, 2, $8, '{}', $9)`,
      [
        tenant,
        `${p}execution`,
        history,
        run,
        `${p}round`,
        `${p}context`,
        `${p}artifact-1`,
        at,
        checksum,
      ],
    ],
    [
      `INSERT INTO findings (tenant_id, id, workspace_id, run_id, round_id, execution_id, artifact_id, code, category, severity, message, created_at, payload_json, record_checksum)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'finding', 'evidence', 'warning', 'A fictional finding.', $8, '{}', $9)`,
      [
        tenant,
        `${p}finding`,
        history,
        run,
        `${p}round`,
        `${p}execution`,
        `${p}artifact-1`,
        at,
        checksum,
      ],
    ],
    [
      `INSERT INTO decisions (tenant_id, id, workspace_id, run_id, round_id, artifact_id, type, rationale, actor, created_at, payload_json, record_checksum)
       VALUES ($1, $2, $3, $4, $5, $6, 'approve', 'Fictional approval.', 'owner', $7, '{}', $8)`,
      [tenant, `${p}decision`, history, run, `${p}round`, `${p}artifact-2`, at, checksum],
    ],
    [
      `INSERT INTO exports (tenant_id, id, workspace_id, run_id, artifact_id, format, status, output_path, output_checksum, created_at, payload_json, record_checksum)
       VALUES ($1, $2, $3, $4, $5, 'markdown', 'completed', $6, $7, $8, '{}', $7)`,
      [
        tenant,
        `${p}export`,
        history,
        run,
        `${p}artifact-2`,
        `/tenants/${tenant}/workspaces/${record}/exports/${run}.md`,
        checksum,
        at,
      ],
    ],
    [
      `INSERT INTO opportunity_brief_versions (tenant_id, workspace_id, brief_id, version, schema_version, prior_version, status, created_at, payload_json, payload_checksum)
       VALUES ($1, $2, 'brief-1', 1, 1, NULL, 'draft', $3, '{}', $4), ($1, $2, 'brief-1', 2, 1, 1, 'draft', $3, '{}', $4)`,
      [tenant, history, at, checksum],
    ],
    [
      `INSERT INTO canonical_candidate_profile_versions (tenant_id, workspace_id, profile_id, version, schema_version, parent_version, status, created_at, updated_at, payload_json, payload_checksum)
       VALUES ($1, $2, 'profile-1', 1, 1, NULL, 'draft', $3, $3, '{}', $4)`,
      [tenant, history, at, checksum],
    ],
    [
      `INSERT INTO writing_policy_versions (tenant_id, workspace_id, policy_checksum, version, schema_version, created_at, prior_checksum, payload_json, payload_checksum)
       VALUES ($1, $2, $3, 'v1', 1, $4, NULL, '{}', $3)`,
      [tenant, history, checksum, at],
    ],
    [
      `INSERT INTO applications (tenant_id, workspace_id, application_id, name, job_source_json, created_at, updated_at)
       VALUES ($1, $2, 'application-1', 'Fictional role', '{}', $3, $3)`,
      [tenant, history, at],
    ],
    [
      `INSERT INTO application_run_bindings (tenant_id, workspace_id, run_id, application_id, created_at)
       VALUES ($1, $2, $3, 'application-1', $4)`,
      [tenant, history, run, at],
    ],
    [
      `INSERT INTO application_brief_bindings (tenant_id, workspace_id, brief_id, application_id, created_at)
       VALUES ($1, $2, 'brief-1', 'application-1', $3)`,
      [tenant, history, at],
    ],
    [
      `INSERT INTO application_archives (tenant_id, workspace_id, application_id, archived_at)
       VALUES ($1, $2, 'application-1', $3)`,
      [tenant, history, at],
    ],
    [
      `INSERT INTO application_model_profiles (tenant_id, workspace_id, application_id, model_profiles_json, updated_at)
       VALUES ($1, $2, 'application-1', '{}', $3)`,
      [tenant, history, at],
    ],
    [
      `INSERT INTO default_application_names (tenant_id, workspace_id, name, updated_at)
       VALUES ($1, $2, 'Fictional default', $3)`,
      [tenant, history, at],
    ],
    [
      `INSERT INTO application_chosen_runs (tenant_id, workspace_id, application_id, run_id, chosen_at)
       VALUES ($1, $2, 'application-1', $3, $4)`,
      [tenant, history, run, at],
    ],
    [
      `INSERT INTO candidate_knowledge_retrieval_traces (tenant_id, workspace_id, trace_id, schema_version, operation_id, purpose, query_checksum, payload_json, payload_checksum, created_at)
       VALUES ($1, $2, 'trace-1', 1, 'operation-1', 'critic-review', $3, '{}', $3, $4)`,
      [tenant, history, checksum, at],
    ],
    [
      `INSERT INTO workspace_settings (tenant_id, workspace_ref, name, content)
       VALUES ($1, $2, 'workspace.json', $3), ($1, $2, 'writing-policy.md', 'Fictional policy.')`,
      [tenant, `/tenants/${tenant}/workspaces/${record}`, JSON.stringify({ id: history })],
    ],
    [
      `INSERT INTO run_state_entries (tenant_id, key, value)
       VALUES ($1, 'draft-loop:orchestration:run:' || $2, '{}'),
              ($1, 'draft-loop:orchestration:execution:' || $2 || ':execution-1', '{}'),
              ($1, 'draft-loop:orchestration:latest:' || $2 || ':1:author', '"execution-1"')`,
      [tenant, run],
    ],
    [
      `INSERT INTO idempotency_keys (tenant_id, scope, key, fingerprint, expires_at)
       VALUES ($1, 'runs:' || $2, 'key-1', $3, now() + interval '1 day'),
              ($1, 'exports:' || $2 || ':' || $4, 'key-1', $3, now() + interval '1 day')`,
      [tenant, record, "a".repeat(64), run],
    ],
    [
      `INSERT INTO candidate_record_assignments (tenant_id, workspace_id, member_id)
       VALUES ($1, $2, 'member-1')`,
      [tenant, record],
    ],
    [
      `INSERT INTO consent_events (tenant_id, id, workspace_id, kind, action, basis, recorded_by)
       VALUES ($1, $2, $3, 'material-storage', 'granted', 'contract', 'owner'),
              ($1, $4, $3, 'material-storage', 'withdrawn', 'contract', 'owner')`,
      [tenant, `${p}consent-1`, history, `${p}consent-2`],
    ],
    [
      `INSERT INTO candidate_knowledge_bases (tenant_id, id, display_name, description, state, is_default, created_at, updated_at)
       VALUES ($1, $2, 'Fictional notes', '', 'active', 0, $3, $3)`,
      [tenant, base, at],
    ],
    [
      "INSERT INTO knowledge_base_owners (tenant_id, knowledge_base_id, workspace_id) VALUES ($1, $2, $3)",
      [tenant, base, record],
    ],
    [
      `INSERT INTO candidate_knowledge_sources (tenant_id, id, candidate_knowledge_base_id, kind, display_name, created_at)
       VALUES ($1, $2, $3, 'file', 'fictional-cv.md', $4)`,
      [tenant, source, base, at],
    ],
    [
      `INSERT INTO candidate_knowledge_source_versions (tenant_id, id, source_id, version, parent_version_id, media_type, checksum, size_bytes, created_at)
       VALUES ($1, $2, $3, 1, NULL, 'text/markdown', $4, 5, $5), ($1, $6, $3, 2, $2, 'text/markdown', $4, 5, $5)`,
      [tenant, `${p}version-1`, source, checksum, at, `${p}version-2`],
    ],
    [
      `INSERT INTO candidate_knowledge_managed_source_versions (tenant_id, version_id, source_id, blob_location, recorded_at)
       VALUES ($1, $2, $3, $4, $5), ($1, $6, $3, $7, $5)`,
      [
        tenant,
        `${p}version-1`,
        source,
        `tenants/${tenant}/knowledge/knowledge/${p}version-1`,
        at,
        `${p}version-2`,
        `tenants/${tenant}/knowledge/knowledge/${p}version-2`,
      ],
    ],
    [
      `INSERT INTO candidate_knowledge_source_sensitivity_rule_versions (tenant_id, knowledge_base_id, version, rules_json, checksum, created_at)
       VALUES ($1, $2, 1, '[]', $3, $4)`,
      [tenant, base, checksum, at],
    ],
    [
      `INSERT INTO candidate_knowledge_lexical_indexes (tenant_id, store_id, knowledge_base_id, schema_version, indexer_id, manifest_checksum, scope_json, created_at)
       VALUES ($1, 'knowledge', $2, 1, 'lexical', $3, '{}', $4)`,
      [tenant, base, checksum, at],
    ],
    [
      `INSERT INTO candidate_knowledge_lexical_chunks (tenant_id, store_id, knowledge_base_id, source_id, version_id, chunk_id, ordinal, line_start, line_end, text, metadata_json, tokens)
       VALUES ($1, 'knowledge', $2, $3, $4, 'chunk-1', 0, 1, 1, 'Fictional line.', '{}', ARRAY['fictional', 'line'])`,
      [tenant, base, source, `${p}version-2`],
    ],
    [
      `INSERT INTO candidate_knowledge_vector_indexes (tenant_id, store_id, knowledge_base_id, model_id, model_revision, model_sha256, dimensions, pooling, runtime, lexical_manifest_checksum, created_at)
       VALUES ($1, 'knowledge', $2, 'fictional-embedder', 'r1', $3, 3, 'mean', 'scripted', $3, $4)`,
      [tenant, base, checksum, at],
    ],
    [
      `INSERT INTO candidate_knowledge_vector_chunks (tenant_id, store_id, knowledge_base_id, chunk_id, vector)
       VALUES ($1, 'knowledge', $2, 'chunk-1', '[1,2,3]')`,
      [tenant, base],
    ],
  ];
  for (const [sql, parameters] of statements) await admin.query(sql, parameters);
}

/** Every row of every table, as sorted JSON text per table. */
async function snapshot(admin: SqlClient, schema: string): Promise<Record<string, string[]>> {
  const tables = await admin.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename",
    [schema],
  );
  const rows: Record<string, string[]> = {};
  for (const { tablename } of tables) {
    const table = String(tablename);
    const found = await admin.query(`SELECT to_jsonb(t)::text AS row FROM ${table} t`);
    rows[table] = found.map((row) => String(row.row)).sort();
  }
  return rows;
}

describe.runIf(connectionString !== undefined)("Postgres candidate record erasure", () => {
  const url = connectionString ?? "";

  async function withSchema(work: (schema: TestSchema) => Promise<void>): Promise<void> {
    const schema = await createTestSchema(url, "record_erasure");
    try {
      await seedTenant(schema.admin, "org-north");
      await seedTenant(schema.admin, "org-south");
      await work(schema);
    } finally {
      await schema.drop();
    }
  }

  it("erases every row of a record and leaves other records and tenants as they were", async () => {
    await withSchema(async (schema) => {
      const { admin } = schema;
      await seedRecord(admin, "org-north", "record-kept");
      await seedRecord(admin, "org-south", "record-gone");
      const before = await snapshot(admin, schema.schema);
      await seedRecord(admin, "org-north", "record-gone");

      // The seed reaches every table a record can: a table added later must be erased too.
      const seeded = await snapshot(admin, schema.schema);
      const unseeded = Object.keys(seeded).filter(
        (table) => !tenantWideTables.has(table) && seeded[table]?.length === before[table]?.length,
      );
      expect(unseeded).toEqual([]);

      const tenancy = await schema.openTenancy();
      try {
        const north = tenancy.forTenant("org-north");
        const erasure = north.recordErasure;
        await expect(erasure.isClosed("record-gone")).resolves.toBe(false);
        const objectKeys = [
          "tenants/org-north/knowledge/knowledge/record-gone-version-1",
          "tenants/org-north/knowledge/knowledge/record-gone-version-2",
          "tenants/org-north/workspaces/record-gone/exports/record-gone-run.md",
        ];
        await expect(erasure.close("record-gone")).resolves.toEqual({
          state: "closed",
          resumed: false,
          objectKeys,
        });
        // Closed: gone from the listing at once, and a second call resumes the same erasure.
        await expect(erasure.isClosed("record-gone")).resolves.toBe(true);
        await expect(north.candidateRecords.listRecords()).resolves.toEqual(["record-kept"]);
        await expect(erasure.close("record-gone")).resolves.toEqual({
          state: "closed",
          resumed: true,
          objectKeys,
        });

        const removed = Object.values(seeded).reduce((sum, rows) => sum + rows.length, 0);
        const kept = Object.values(before).reduce((sum, rows) => sum + rows.length, 0);
        await expect(erasure.erase("record-gone")).resolves.toEqual({
          rowsRemoved: removed - kept + 1,
          objectKeys,
        });
        await expect(erasure.close("record-gone")).resolves.toEqual({ state: "missing" });
        await expect(erasure.isClosed("record-gone")).resolves.toBe(false);
        await expect(erasure.erase("record-gone")).rejects.toMatchObject({
          name: "RecordErasureError",
          code: "not_closed",
        });
      } finally {
        await tenancy.close();
      }
      expect(await snapshot(admin, schema.schema)).toEqual(before);
    });
  });

  it("refuses a record with an active run and one never closed", async () => {
    await withSchema(async (schema) => {
      await seedRecord(schema.admin, "org-north", "record-busy", { runState: "drafting" });
      await seedRecord(schema.admin, "org-north", "record-idle");
      const tenancy = await schema.openTenancy();
      try {
        const erasure = tenancy.forTenant("org-north").recordErasure;
        await expect(erasure.close("record-busy")).resolves.toEqual({ state: "run-active" });
        await expect(erasure.isClosed("record-busy")).resolves.toBe(false);
        await expect(erasure.erase("record-idle")).rejects.toMatchObject({ code: "not_closed" });
        await expect(erasure.close("record-never")).resolves.toEqual({ state: "missing" });
        // Another tenant's record is out of reach, even by the same id.
        const south = tenancy.forTenant("org-south").recordErasure;
        await expect(south.close("record-idle")).resolves.toEqual({ state: "missing" });
      } finally {
        await tenancy.close();
      }
    });
  });

  it("keeps the ledger, the audit chain and closing marks out of the runtime role's reach", async () => {
    await withSchema(async (schema) => {
      await seedRecord(schema.admin, "org-north", "record-1");
      const tenancy = await schema.openTenancy();
      const pool = createSqlPool({ connectionString: runtimeRoleUrl(url), schema: schema.schema });
      try {
        await tenancy.forTenant("org-north").recordErasure.close("record-1");
        const asTenant = pool.forTenant("org-north");
        for (const statement of [
          "DELETE FROM consent_events",
          "UPDATE consent_events SET note = 'changed'",
          "TRUNCATE consent_events",
          "DELETE FROM audit_events",
          "UPDATE audit_events SET event_type = 'changed'",
          "DELETE FROM candidate_record_erasures",
        ]) {
          await expect(asTenant.query(statement)).rejects.toThrow(/permission denied/u);
        }
        // The erasure setting alone opens nothing: only the function's owning role passes.
        await expect(
          asTenant.transaction(async (executor) => {
            await executor.query("SET LOCAL draft_loop.erasure = 'on'");
            await executor.query("DELETE FROM context_snapshots");
          }),
        ).rejects.toThrow(/immutable/u);
        // The owning role itself is refused outside the function.
        await expect(schema.admin.query("DELETE FROM context_snapshots")).rejects.toThrow(
          /immutable/u,
        );
        await expect(schema.admin.query("DELETE FROM consent_events")).rejects.toThrow(
          /immutable/u,
        );
        // Without a tenant the function erases nothing.
        await expect(pool.query("SELECT erase_candidate_record('record-1')")).rejects.toThrow(
          /tenant/u,
        );
      } finally {
        await pool.close();
        await tenancy.close();
      }
    });
  });
});
