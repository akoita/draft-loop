import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApi, composeHostedApplication, hostedKnowledgeLocation } from "@draft-loop/api";
import type { RunJob } from "@draft-loop/run-queue";
import { createFilesystemBlobStorage } from "@draft-loop/storage/blobs";
import {
  createPostgresTenantDirectory,
  grantPostgresStorageAccess,
  hostedWorkspaceReference,
  migratePostgresStorage,
  openPostgresTenancy,
  type PostgresTenancy,
  type PostgresTenantDirectory,
} from "@draft-loop/storage-postgres";
import {
  type ApiClient,
  approveRequest,
  archiveRequest,
  briefEdit,
  briefPatchBody,
  createApiClient,
  createBriefBody,
  defaultWorkspaceForm,
  deleteRecordRequest,
  exportRequestBody,
  recordIds,
  selectionRequest,
  startRunBody,
  workspaceRequestBody,
} from "@draft-loop/web";
import type { FastifyInstance } from "fastify";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { scriptedGateway } from "./gateway-test-support.js";
import {
  filesUnder,
  filesystemBlobErasure,
  injectFetch,
  readZipEntries,
  runtimeRole,
  runtimeUrl,
  tenantKeyBlobs,
} from "./hosted-test-support.js";
import { readModelGatewayConfig, workerProviderOptions } from "./model-routes.js";
import { createRunJobHandler, type RunJobOutcome } from "./run-job-handler.js";
import { tenantRunConsent, tenantServices } from "./tenant-services.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const issuer = "https://id.example.test/realms/draft-loop";
const audience = "draft-loop-api";
const budgetCeiling = { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 };
const gatewayEnv = {
  DRAFT_LOOP_VERTEX_PROJECT_ID: "synthetic-project",
  DRAFT_LOOP_VERTEX_LOCATION: "eu",
  DRAFT_LOOP_VERTEX_PRICE_FACTOR: "1.1",
  DRAFT_LOOP_OPENAI_KEY_SECRET: "projects/synthetic/secrets/openai-key/versions/1",
};

/** A fictional organisation and its owner. */
const organisation = {
  organisationId: "org-hazel",
  name: "Hazel Coaching",
  subject: "person-ida",
  email: "ida@hazel.example.test",
} as const;

/**
 * Two fictional candidate records, each with career material carrying a marker that is not
 * hexadecimal, so no id or checksum can contain it by chance.
 */
const records = {
  kept: { id: "candidate-kit", marker: "quill-lantern", employer: "Example Ledger" },
  erased: { id: "candidate-rue", marker: "otter-meadow", employer: "Example Harbour" },
} as const;
type Side = keyof typeof records;

function careerFor(side: Side): string {
  const { marker, employer } = records[side];
  return [
    "# Experience",
    "",
    `## Platform Engineer, ${employer} (2020-2024)`,
    "",
    `Built TypeScript services with deterministic testing, codenamed ${marker}.`,
    "",
  ].join("\n");
}

describe.runIf(connectionString !== undefined)("record export and erasure", () => {
  const url = connectionString ?? "";
  const schema = `erasure_flow_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: url });
  const queued: RunJob[] = [];
  let token = "";
  let blobRoot: string;
  let tenancy: PostgresTenancy;
  let directory: PostgresTenantDirectory;
  let api: FastifyInstance;

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`DO $$
      BEGIN
        CREATE ROLE ${runtimeRole} LOGIN PASSWORD '${runtimeRole}';
      EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
      END $$`);
    await migratePostgresStorage({ connectionString: url, schema });
    await grantPostgresStorageAccess({ connectionString: url, schema }, runtimeRole);
    blobRoot = await mkdtemp(join(tmpdir(), "draft-loop-erasure-flow-"));
    tenancy = await openPostgresTenancy({ connectionString: runtimeUrl(url), schema });
    directory = await createPostgresTenantDirectory({ connectionString: runtimeUrl(url), schema });

    const signingKey = await generateKeyPair("ES256");
    const publicJwk = { ...(await exportJWK(signingKey.publicKey)), kid: "key-1", alg: "ES256" };
    token = await new SignJWT({ email: organisation.email, email_verified: true })
      .setProtectedHeader({ alg: "ES256", kid: "key-1" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(organisation.subject)
      .setExpirationTime("10m")
      .sign(signingKey.privateKey);
    const blobs = tenantKeyBlobs(blobRoot, createFilesystemBlobStorage());
    api = await buildApi({
      ownerToken,
      auth: {
        mode: "oidc",
        issuer,
        audience,
        webClientId: "draft-loop-web",
        allowHttp: false,
        keys: createLocalJWKSet({ keys: [publicJwk] }),
        resolveSignIn: directory.resolveSignIn,
      },
      directory,
      tenants: {
        budgetCeiling,
        recordAccessFor: (tenantId) => tenancy.forTenant(tenantId).candidateRecords,
        knowledgeOwnersFor: (tenantId) => tenancy.forTenant(tenantId).knowledgeBaseOwners,
        // Filesystem objects stand in for the bucket, with the same key-by-key erasure.
        erasureFor: (tenantId) => ({
          records: tenancy.forTenant(tenantId).recordErasure,
          blobs: filesystemBlobErasure(blobRoot, tenantId),
          organisation: tenancy.forTenant(tenantId).organisationErasure,
          objectPrefix: `tenants/${tenantId}/`,
        }),
        applicationFor: (tenantId) =>
          composeHostedApplication({
            storage: tenancy.forTenant(tenantId),
            blobs,
            tenantId,
            budgetCeiling,
            enqueueRun: async (workspaceId, runId) => {
              queued.push({ tenantId, workspaceId, runId });
            },
            knowledgeLocation: (versionId) => hostedKnowledgeLocation(tenantId, versionId),
          }),
      },
    });
  });

  afterAll(async () => {
    await api?.close();
    await directory?.close();
    await tenancy?.close();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
    await rm(blobRoot, { recursive: true, force: true });
  });

  const client = (): ApiClient => createApiClient({ token, fetch: injectFetch(api) });

  /** The worker as a sign-in deployment runs it, through the scripted gateway. */
  const worker = () => {
    const gateway = scriptedGateway(gatewayEnv.DRAFT_LOOP_OPENAI_KEY_SECRET);
    const serviceFor = tenantServices({
      tenancy,
      blobsFor: () => tenantKeyBlobs(blobRoot, createFilesystemBlobStorage()),
      local: workerProviderOptions(readModelGatewayConfig(gatewayEnv), gateway.dependencies),
    });
    const outcomes: RunJobOutcome[] = [];
    const workspaceRoot = (job: RunJob) => hostedWorkspaceReference(job.tenantId, job.workspaceId);
    const handle = createRunJobHandler({
      serviceFor: (job) => serviceFor(job.tenantId),
      workspaceRoot,
      allowProviderData: true,
      budgetCeiling,
      consentFor: tenantRunConsent({ tenancy, serviceFor, workspaceRoot }),
      onOutcome: (_job, outcome) => outcomes.push(outcome),
    });
    return { gateway, handle, outcomes };
  };

  /** Runs every queued job to its review, and what the gateway was sent for it. */
  const drainQueue = async () => {
    const { gateway, handle, outcomes } = worker();
    for (let job = queued.shift(); job !== undefined; job = queued.shift()) {
      outcomes.length = 0;
      while (outcomes.at(-1) !== "settled" && outcomes.length < 10) {
        await handle(job, { requeue: async () => undefined });
      }
      expect(outcomes.at(-1)).toBe("settled");
    }
    return gateway.requestBodies.join("\n");
  };

  /** A record with its consents and one uploaded, selected knowledge base; the base's id. */
  const setUpRecord = async (side: Side) => {
    const workspace = { workspaceId: records[side].id };
    await client().call("PUT /v1/workspaces/{workspaceId}", {
      path: workspace,
      body: workspaceRequestBody({
        ...defaultWorkspaceForm,
        authorModel: "claude-sonnet-5-5",
        criticModel: "gpt-6-luna",
      }),
    });
    await client().call("POST /v1/workspaces/{workspaceId}/consents", {
      path: workspace,
      body: { kind: "material-storage", action: "granted", basis: "contract" },
    });
    await client().call("POST /v1/workspaces/{workspaceId}/consents", {
      path: workspace,
      body: {
        kind: "provider-transmission",
        action: "granted",
        basis: "candidate-consent",
        providers: ["anthropic", "openai"],
      },
    });
    const base = await client().call("POST /v1/knowledge-bases", {
      body: { displayName: "Career material", workspaceId: workspace.workspaceId },
    });
    await client().call("POST /v1/knowledge-bases/{knowledgeBaseId}/sources", {
      path: { knowledgeBaseId: base.id },
      query: { name: "career.md" },
      body: new Blob([careerFor(side)], { type: "text/markdown" }),
      contentType: "text/markdown",
    });
    const selection = selectionRequest([base.id], false);
    if ("problem" in selection) throw new Error(selection.problem);
    await client().call("PUT /v1/workspaces/{workspaceId}/knowledge-selection", {
      path: workspace,
      body: selection.body,
    });
    return base.id;
  };

  /** A reviewed brief and a queued run on the record; the run's path. */
  const beginRun = async (side: Side) => {
    const workspace = { workspaceId: records[side].id };
    const pasted = await client().call("POST /v1/workspaces/{workspaceId}/opportunities", {
      path: workspace,
      body: createBriefBody(
        `Platform Engineer at ${records[side].employer}: build TypeScript services.`,
        new Date(),
      ),
    });
    const briefPath = { ...workspace, briefId: pasted.brief.id };
    const edited = await client().call(
      "PATCH /v1/workspaces/{workspaceId}/opportunities/{briefId}",
      {
        path: briefPath,
        body: briefPatchBody(pasted.brief, {
          ...briefEdit(pasted.brief),
          role: "Platform Engineer",
          requirements: [
            {
              id: "typescript-services",
              text: "Build TypeScript services with deterministic testing",
              priority: "critical",
              sourceIds: [pasted.brief.sources[0]?.id ?? "job-posting"],
            },
          ],
        }),
      },
    );
    const reviewed = await client().call(
      "POST /v1/workspaces/{workspaceId}/opportunities/{briefId}/review",
      { path: briefPath, body: { expectedVersion: edited.brief.version } },
    );
    const begun = await client().call("POST /v1/workspaces/{workspaceId}/runs", {
      path: workspace,
      header: { "idempotency-key": randomUUID() },
      body: startRunBody(reviewed.brief),
    });
    return { ...workspace, runId: begun.runId };
  };

  /** Approves the drafted run and exports it as Markdown. */
  const approveAndExport = async (runPath: { workspaceId: string; runId: string }) => {
    const review = await client().call("GET /v1/workspaces/{workspaceId}/runs/{runId}/review", {
      path: runPath,
    });
    const approval = approveRequest(review, "Synthetic test run: the owner accepts the checks.");
    if ("problem" in approval) throw new Error(approval.problem);
    await client().call("POST /v1/workspaces/{workspaceId}/runs/{runId}/approve", {
      path: runPath,
      body: approval.body,
    });
    await client().call("POST /v1/workspaces/{workspaceId}/runs/{runId}/exports", {
      path: runPath,
      header: { "idempotency-key": randomUUID() },
      body: exportRequestBody("markdown", "modern"),
    });
  };

  /** The record's archive, downloaded as the web screen does, by entry path. */
  const archiveOf = async (side: Side) => {
    const bytes = await client().call(
      "GET /v1/workspaces/{workspaceId}/archive",
      archiveRequest(records[side].id),
    );
    return readZipEntries(Buffer.from(await bytes.arrayBuffer()));
  };
  const textOf = (entries: Map<string, Buffer>) =>
    [...entries.values()].map((content) => content.toString("utf8")).join("\n");

  /** Rows of a table, as JSON text, that mention any of the values. */
  const rowsNaming = async (table: string, values: readonly string[]) => {
    const found = await admin.query<{ row: string }>(
      `SELECT to_jsonb(t)::text AS row FROM ${schema}.${table} t`,
    );
    return found.rows.filter(({ row }) => values.some((value) => row.includes(value)));
  };
  /** Every table of the schema with a row that mentions any of the values. */
  const tablesNaming = async (values: readonly string[]) => {
    const tables = await admin.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename",
      [schema],
    );
    const naming: string[] = [];
    for (const { tablename } of tables.rows)
      if ((await rowsNaming(tablename, values)).length > 0) naming.push(tablename);
    return naming;
  };
  /** Stored files under the blob root whose bytes contain the text. */
  const filesHolding = async (text: string) => {
    const holding: string[] = [];
    for (const key of await filesUnder(blobRoot))
      if ((await readFile(join(blobRoot, key), "utf8")).includes(text)) holding.push(key);
    return holding;
  };

  it("exports each record alone, erases one, then deletes the organisation", async () => {
    const operator = createApiClient({ token: ownerToken, fetch: injectFetch(api) });
    await operator.call("POST /v1/operator/organisations", {
      body: {
        organisationId: organisation.organisationId,
        name: organisation.name,
        firstOwnerEmail: organisation.email,
      },
    });
    expect(await client().call("GET /v1/me", {})).toMatchObject({ role: "owner" });

    // The kept record: material, consents, a run on the scripted gateway and an export.
    await setUpRecord("kept");
    const keptRun = await beginRun("kept");
    expect(await drainQueue()).toContain(records.kept.marker);
    await approveAndExport(keptRun);
    const keptObjects = await filesUnder(blobRoot);
    expect(keptObjects.length).toBeGreaterThanOrEqual(2);

    // The record to erase, the same way.
    const erasedBase = await setUpRecord("erased");
    const erasedRun = await beginRun("erased");
    const sentForErased = await drainQueue();
    expect(sentForErased).toContain(records.erased.marker);
    expect(sentForErased).not.toContain(records.kept.marker);
    await approveAndExport(erasedRun);

    // Each record's archive holds its own material and nothing of the other's.
    for (const [side, other] of [
      ["kept", "erased"],
      ["erased", "kept"],
    ] as const) {
      const entries = await archiveOf(side);
      const manifest = JSON.parse(entries.get("manifest.json")?.toString("utf8") ?? "{}");
      expect(manifest.record?.workspaceId, side).toBe(records[side].id);
      expect(
        [...entries.keys()].some((path) => path.startsWith("objects/")),
        side,
      ).toBe(true);
      expect(textOf(entries), side).toContain(records[side].marker);
      expect(textOf(entries), side).not.toContain(records[other].marker);
      expect(textOf(entries), side).not.toContain(records[other].id);
    }

    // Before erasure, the key tables hold the record, so the checks below are not empty ones.
    // Its history (workspace and audit rows) is keyed by the id its configuration names.
    const settings = await admin.query<{ id: string }>(
      `SELECT content::jsonb ->> 'id' AS id FROM ${schema}.workspace_settings
       WHERE name = 'workspace.json' AND workspace_ref = $1`,
      [hostedWorkspaceReference(organisation.organisationId, records.erased.id)],
    );
    const historyId = settings.rows[0]?.id ?? "";
    expect(historyId).not.toBe("");
    const erasedIds = [records.erased.id, historyId];
    const erasedValues = [...erasedIds, records.erased.marker, erasedBase];
    for (const table of ["workspaces", "consent_events", "audit_events"])
      expect(await rowsNaming(table, erasedIds), table).not.toEqual([]);
    expect(await rowsNaming("candidate_knowledge_sources", [erasedBase])).not.toEqual([]);
    expect(await filesHolding(records.erased.marker)).not.toEqual([]);

    // Erasing the record, its id typed back, leaves no row and no stored object of it.
    const confirmed = deleteRecordRequest(records.erased.id, records.erased.id);
    if ("problem" in confirmed) throw new Error(confirmed.problem);
    await client().call("DELETE /v1/workspaces/{workspaceId}", confirmed.request);
    for (const table of ["workspaces", "consent_events", "audit_events"])
      expect(await rowsNaming(table, erasedIds), table).toEqual([]);
    expect(await rowsNaming("candidate_knowledge_sources", [erasedBase])).toEqual([]);
    expect(await tablesNaming(erasedValues)).toEqual([]);
    expect(await filesUnder(blobRoot)).toEqual(keptObjects);
    expect(await filesHolding(records.erased.marker)).toEqual([]);

    // The other record still works: its archive downloads whole, and it starts another run.
    expect(recordIds(await client().call("GET /v1/workspaces", {}))).toEqual([records.kept.id]);
    expect(textOf(await archiveOf("kept"))).toContain(records.kept.marker);
    await beginRun("kept");
    expect(queued.map((job) => job.workspaceId)).toEqual([records.kept.id]);
    expect(await drainQueue()).toContain(records.kept.marker);

    // Deleting the organisation leaves no row of the tenant and nothing under its blob root.
    await client().call("DELETE /v1/organisation", {
      body: { confirm: organisation.organisationId },
    });
    const tenantTables = await admin.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns
       WHERE table_schema = $1 AND column_name = 'tenant_id' ORDER BY table_name`,
      [schema],
    );
    expect(tenantTables.rows.length).toBeGreaterThan(10);
    for (const { table_name: table } of tenantTables.rows) {
      const left = await admin.query(`SELECT 1 FROM ${schema}.${table} WHERE tenant_id = $1`, [
        organisation.organisationId,
      ]);
      expect(left.rowCount, table).toBe(0);
    }
    expect(
      await tablesNaming([organisation.organisationId, records.kept.id, records.kept.marker]),
    ).toEqual([]);
    expect(await filesUnder(blobRoot, `tenants/${organisation.organisationId}/`)).toEqual([]);
    expect(await filesUnder(blobRoot)).toEqual([]);
    await expect(client().call("GET /v1/workspaces", {})).rejects.toMatchObject({ status: 403 });
  }, 180_000);
});
