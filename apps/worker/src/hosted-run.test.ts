import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApplicationService, createHostedApplicationDriver } from "@draft-loop/application";
import { createFilesystemBlobStorage } from "@draft-loop/storage/blobs";
import {
  grantPostgresStorageAccess,
  hostedApplicationPorts,
  hostedKnowledgeStoreReference,
  hostedWorkspaceReference,
  migratePostgresStorage,
  openPostgresStorage,
  type PostgresStorage,
} from "@draft-loop/storage-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRunJobHandler, type RunJobOutcome } from "./run-job-handler.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const runtimeRole = "draft_loop_test_app";
const createdAt = "2026-10-21T10:00:00.000Z";
const silent = { write: () => undefined };
const tenantId = "tenant-a";
const workspace = hostedWorkspaceReference(tenantId, "workspace-1");
const storeReference = hostedKnowledgeStoreReference(tenantId, "store-1");
const career = new TextEncoder().encode(
  "# Experience\n\n## Platform Engineer, Example Ledger (2020-2024)\n\nBuilt TypeScript services with deterministic testing.\n",
);

function runtimeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.username = runtimeRole;
  parsed.password = runtimeRole;
  return parsed.toString();
}

describe.runIf(connectionString !== undefined)("hosted run on Postgres", () => {
  const url = connectionString ?? "";
  const schema = `hosted_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: url });
  const blobs = createFilesystemBlobStorage();
  let blobRoot: string;
  let storage: PostgresStorage;

  /** One synthetic knowledge base whose only source's bytes are in blob storage. */
  async function seedKnowledge(): Promise<void> {
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
    const reference = await blobs.put(join(blobRoot, "source-1", "version-1"), career);
    await storage.recordManagedCandidateKnowledgeSourceVersion({
      knowledgeBaseId: "ckb-1",
      sourceId: "source-1",
      versionId: "version-1",
      location: reference.location,
      recordedAt: createdAt,
    });
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
    storage = await openPostgresStorage({ connectionString: runtimeUrl(url), schema, tenantId });
    blobRoot = await mkdtemp(join(tmpdir(), "draft-loop-hosted-blobs-"));
    await seedKnowledge();
  });

  afterAll(async () => {
    await storage?.close();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
    await rm(blobRoot, { recursive: true, force: true });
  });

  it("begins a fixture run through the hosted driver and the worker drives it to approval", async () => {
    const reads: string[] = [];
    const service = createApplicationService(
      createHostedApplicationDriver(
        hostedApplicationPorts({
          storage,
          tenantId,
          blobs: {
            ...blobs,
            get: (reference) => {
              reads.push(reference.location);
              return blobs.get(reference);
            },
          },
        }),
      ),
    );
    await service.initialize(
      { root: workspace, jobDescription: "job.md", sources: "sources", fixtureMode: true },
      silent,
    );
    await service.configureKnowledgeSelection(
      {
        root: workspace,
        entries: [{ storeRoot: storeReference, storeId: "store-1", knowledgeBaseId: "ckb-1" }],
      },
      silent,
    );
    const created = await service.createOpportunity({
      root: workspace,
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
      root: workspace,
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
      root: workspace,
      briefId: created.brief.id,
      expectedVersion: edited.brief.version,
    });
    const begun = await service.begin(
      {
        root: workspace,
        opportunityBrief: { briefId: reviewed.brief.id, version: reviewed.brief.version },
      },
      silent,
    );
    const outcomes: RunJobOutcome[] = [];
    const handle = createRunJobHandler({
      service,
      workspaceRoot: (job) => hostedWorkspaceReference(job.tenantId, job.workspaceId),
      allowProviderData: false,
      onOutcome: (_job, outcome) => outcomes.push(outcome),
    });

    const job = { tenantId, workspaceId: "workspace-1", runId: begun.runId };
    await handle(job, { requeue: async () => undefined });
    await handle(job, { requeue: async () => undefined });

    expect(begun.state).toBe("drafting");
    expect(outcomes).toEqual(["advanced", "settled"]);
    expect((await service.status({ root: workspace, runId: begun.runId }))?.state).toBe(
      "awaiting-approval",
    );
    // The run's history is this tenant's rows, and its evidence came from the managed bytes.
    const runs = await admin.query(`SELECT tenant_id FROM ${schema}.runs`);
    expect(runs.rows).toEqual([{ tenant_id: tenantId }]);
    expect(reads.length).toBeGreaterThan(0);
    expect(new Set(reads)).toEqual(new Set([join(blobRoot, "source-1", "version-1")]));
  }, 120_000);
});
