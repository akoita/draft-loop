import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createApplicationService,
  createHostedApplicationDriver,
  withRunBudgetDefaults,
} from "@draft-loop/application";
import {
  grantRunQueueAccess,
  migrateRunQueue,
  openRunQueue,
  type RunJob,
  type RunQueue,
} from "@draft-loop/run-queue";
import type { BlobStoragePort } from "@draft-loop/storage";
import { createFilesystemBlobStorage } from "@draft-loop/storage/blobs";
import {
  grantPostgresStorageAccess,
  hostedApplicationPorts,
  hostedKnowledgeStoreReference,
  hostedWorkspaceReference,
  migratePostgresStorage,
  openPostgresTenancy,
  type PostgresTenancy,
} from "@draft-loop/storage-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runtimeRole, runtimeUrl } from "./hosted-test-support.js";
import type { RunJobOutcome } from "./run-job-handler.js";
import { tenantRecordErased, tenantServices } from "./tenant-services.js";
import { startWorker } from "./worker.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const tenants = ["tenant-north", "tenant-south"] as const;
type Tenant = (typeof tenants)[number];
// Both tenants use the same workspace and store ids: only the tenant tells them apart.
const workspaceId = "workspace-1";
const createdAt = "2026-10-24T10:00:00.000Z";
const silent = { write: () => undefined };
const budgetCeiling = { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 };
const career = new TextEncoder().encode(
  "# Experience\n\n## Platform Engineer, Example Ledger (2020-2024)\n\nBuilt TypeScript services with deterministic testing.\n",
);

/** Resolves once `check` passes, polling the way a person would refresh a page. */
async function eventually(check: () => Promise<void> | void, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await check();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

describe.runIf(connectionString !== undefined)("worker serving many tenants on Postgres", () => {
  const url = connectionString ?? "";
  const schema = `tenants_${randomUUID().replaceAll("-", "")}`;
  const queueSchema = `tenants_queue_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: url });
  const files = createFilesystemBlobStorage();
  /** Every blob each tenant's composition reads, by the tenant it was composed for. */
  const reads: { tenantId: string; location: string }[] = [];
  let blobRoot: string;
  let tenancy: PostgresTenancy;
  let queue: RunQueue;

  /** A tenant's blobs: files under its own folder, as Cloud Storage keeps its own prefix. */
  const blobsFor = (tenantId: string): BlobStoragePort => ({
    ...files,
    get: (reference) => {
      reads.push({ tenantId, location: reference.location });
      return files.get(reference);
    },
  });

  /** Rows per tenant in every table that carries one, so a stray write shows up anywhere. */
  async function rowsByTenant(): Promise<Record<string, Record<string, number>>> {
    const tables = await admin.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns
       WHERE table_schema = $1 AND column_name = 'tenant_id' ORDER BY table_name`,
      [schema],
    );
    const counts: Record<string, Record<string, number>> = {};
    for (const { table_name: table } of tables.rows) {
      const result = await admin.query<{ tenant_id: string; count: string }>(
        `SELECT tenant_id, count(*) AS count FROM ${schema}.${table} GROUP BY tenant_id`,
      );
      for (const row of result.rows) {
        counts[row.tenant_id] = { ...counts[row.tenant_id], [table]: Number(row.count) };
      }
    }
    return counts;
  }

  /** As the API does it: one knowledge base whose source bytes sit in the tenant's blobs. */
  async function prepareRun(tenantId: Tenant): Promise<string> {
    const storage = tenancy.forTenant(tenantId);
    await storage.createCandidateKnowledgeStore({ schemaVersion: 1, id: "store-1", createdAt });
    await storage.createCandidateKnowledgeBase({
      id: "ckb-1",
      displayName: "Career",
      description: "",
      isDefault: true,
      createdAt,
    });
    await storage.createCandidateKnowledgeSource(
      {
        id: "source-1",
        knowledgeBaseId: "ckb-1",
        kind: "file",
        displayName: "career.md",
        createdAt,
      },
      {
        id: "version-1",
        mediaType: "text/markdown",
        checksum: createHash("sha256").update(career).digest("hex"),
        sizeBytes: career.byteLength,
        createdAt,
      },
    );
    const stored = await files.put(join(blobRoot, tenantId, "source-1", "version-1"), career);
    await storage.recordManagedCandidateKnowledgeSourceVersion({
      knowledgeBaseId: "ckb-1",
      sourceId: "source-1",
      versionId: "version-1",
      location: stored.location,
      recordedAt: createdAt,
    });

    const ports = hostedApplicationPorts({ storage, tenantId, blobs: files });
    const service = createApplicationService(
      createHostedApplicationDriver({
        ...ports,
        settings: withRunBudgetDefaults(ports.settings, budgetCeiling),
      }),
    );
    const root = hostedWorkspaceReference(tenantId, workspaceId);
    await service.initialize(
      { root, jobDescription: "job.md", sources: "sources", fixtureMode: true },
      silent,
    );
    await service.configureKnowledgeSelection(
      {
        root,
        entries: [
          {
            storeRoot: hostedKnowledgeStoreReference(tenantId, "store-1"),
            storeId: "store-1",
            knowledgeBaseId: "ckb-1",
          },
        ],
      },
      silent,
    );
    const created = await service.createOpportunity({
      root,
      sources: [
        {
          id: "posting",
          kind: "pasted-content",
          classification: "job-posting",
          content: "Platform Engineer at Example Ledger: build TypeScript services.",
        },
      ],
    });
    const edited = await service.editOpportunity({
      root,
      briefId: created.brief.id,
      expectedVersion: created.brief.version,
      patch: {
        role: { value: "Platform Engineer", sourceIds: ["posting"] },
        requirements: [
          {
            id: "typescript-services",
            text: "Build TypeScript services with deterministic testing",
            priority: "critical",
            sourceIds: ["posting"],
          },
        ],
      },
    });
    const reviewed = await service.reviewOpportunity({
      root,
      briefId: created.brief.id,
      expectedVersion: edited.brief.version,
    });
    const begun = await service.begin(
      { root, opportunityBrief: { briefId: reviewed.brief.id, version: reviewed.brief.version } },
      silent,
    );
    return begun.runId;
  }

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
    await migrateRunQueue({ connectionString: url, schema: queueSchema });
    await grantRunQueueAccess({ connectionString: url, schema: queueSchema }, runtimeRole);
    tenancy = await openPostgresTenancy({ connectionString: runtimeUrl(url), schema });
    queue = await openRunQueue({ connectionString: runtimeUrl(url), schema: queueSchema });
    blobRoot = await mkdtemp(join(tmpdir(), "draft-loop-tenant-blobs-"));
  });

  afterAll(async () => {
    await queue?.close();
    await tenancy?.close();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.query(`DROP SCHEMA IF EXISTS ${queueSchema} CASCADE`);
    await admin.end();
    await rm(blobRoot, { recursive: true, force: true });
  });

  it("runs each tenant's queued job in that tenant and writes nothing to the other", async () => {
    const runIds = {} as Record<Tenant, string>;
    for (const tenantId of tenants) runIds[tenantId] = await prepareRun(tenantId);
    const serviceFor = tenantServices({ tenancy, blobsFor });
    const finished: { job: RunJob; outcome: RunJobOutcome }[] = [];
    const worker = await startWorker({
      queue: {
        connectionString: runtimeUrl(url),
        schema: queueSchema,
        pollingIntervalSeconds: 0.5,
      },
      runs: {
        serviceFor: (job) => serviceFor(job.tenantId),
        workspaceRoot: (job) => hostedWorkspaceReference(job.tenantId, job.workspaceId),
        allowProviderData: false,
        budgetCeiling,
        onOutcome: (job, outcome) => finished.push({ job, outcome }),
      },
    });
    try {
      // One tenant at a time, so any row the other tenant gains would be this job's.
      for (const [index, tenantId] of tenants.entries()) {
        const before = await rowsByTenant();
        await queue.enqueue({ tenantId, workspaceId, runId: runIds[tenantId] });
        await eventually(() => expect(finished).toHaveLength(index + 1));
        const after = await rowsByTenant();
        for (const other of tenants.filter((candidate) => candidate !== tenantId)) {
          expect(after[other]).toEqual(before[other]);
        }
        expect(after[tenantId]).not.toEqual(before[tenantId]);
      }
    } finally {
      await worker.stop({ graceMs: 1_000 });
    }

    expect(finished.map(({ job, outcome }) => [job.tenantId, outcome])).toEqual([
      ["tenant-north", "advanced"],
      ["tenant-south", "advanced"],
    ]);
    for (const tenantId of tenants) {
      const root = hostedWorkspaceReference(tenantId, workspaceId);
      const own = serviceFor(tenantId);
      expect((await own.status({ root, runId: runIds[tenantId] }))?.state).toBe(
        "awaiting-approval",
      );
      // The same workspace id in the other tenant holds no such run.
      const other = tenants.find((candidate) => candidate !== tenantId) ?? tenantId;
      const otherRoot = hostedWorkspaceReference(other, workspaceId);
      await expect(
        serviceFor(other).status({ root: otherRoot, runId: runIds[tenantId] }),
      ).rejects.toThrow("was not found");
    }
    const runs = await admin.query(`SELECT tenant_id, id FROM ${schema}.runs ORDER BY tenant_id`);
    expect(runs.rows).toEqual([
      { tenant_id: "tenant-north", id: runIds["tenant-north"] },
      { tenant_id: "tenant-south", id: runIds["tenant-south"] },
    ]);
    // Each tenant's evidence came from its own bytes, read through its own blobs.
    expect(reads.length).toBeGreaterThan(0);
    for (const { tenantId, location } of reads) {
      expect(location.startsWith(join(blobRoot, tenantId))).toBe(true);
    }
    expect(new Set(reads.map(({ tenantId }) => tenantId))).toEqual(new Set(tenants));
  }, 120_000);

  it("erases every row a real run left and ends the record's later jobs quietly", async () => {
    // The first test left a finished run in each tenant's workspace.
    const tenantId: Tenant = "tenant-north";
    const storage = tenancy.forTenant(tenantId);
    const serviceFor = tenantServices({ tenancy, blobsFor });
    const workspaceRoot = (job: RunJob) => hostedWorkspaceReference(job.tenantId, job.workspaceId);
    const recordErased = tenantRecordErased({ tenancy, serviceFor, workspaceRoot });
    const job = { tenantId, workspaceId, runId: "run-after-erasure" };
    await expect(recordErased(job)).resolves.toBe(false);

    await storage.knowledgeBaseOwners.setOwner({ knowledgeBaseId: "ckb-1", workspaceId });
    await expect(storage.recordErasure.close(workspaceId)).resolves.toMatchObject({
      state: "closed",
      resumed: false,
    });
    await expect(recordErased(job)).resolves.toBe(true);
    const south = (await rowsByTenant())["tenant-south"];
    await storage.recordErasure.erase(workspaceId);
    await expect(recordErased(job)).resolves.toBe(true);
    // Only the tenant's knowledge store, which no record owns, is left; the other tenant is whole.
    const after = await rowsByTenant();
    expect(after[tenantId]).toEqual({ candidate_knowledge_stores: 1 });
    expect(after["tenant-south"]).toEqual(south);

    const finished: RunJobOutcome[] = [];
    const worker = await startWorker({
      queue: {
        connectionString: runtimeUrl(url),
        schema: queueSchema,
        pollingIntervalSeconds: 0.5,
      },
      runs: {
        serviceFor: (queued) => serviceFor(queued.tenantId),
        workspaceRoot,
        allowProviderData: false,
        budgetCeiling,
        recordErased,
        onOutcome: (_job, outcome) => finished.push(outcome),
      },
    });
    try {
      await queue.enqueue(job);
      await eventually(() => expect(finished).toEqual(["record-erased"]));
    } finally {
      await worker.stop({ graceMs: 1_000 });
    }
  }, 60_000);

  it("refuses a job whose tenant id is not a safe identifier before touching storage", () => {
    const blobTenants: string[] = [];
    const serviceFor = tenantServices({
      tenancy,
      blobsFor: (tenantId) => {
        blobTenants.push(tenantId);
        return blobsFor(tenantId);
      },
    });

    expect(() => serviceFor("../tenant-north")).toThrow("Invalid tenant id");
    expect(blobTenants).toEqual([]);
  });
});
