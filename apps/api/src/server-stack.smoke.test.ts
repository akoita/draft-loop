import { createHash, randomUUID } from "node:crypto";
import { createApplicationService, createHostedApplicationDriver } from "@draft-loop/application";
import type { BlobStoragePort } from "@draft-loop/storage";
import { createGcsBlobStorage } from "@draft-loop/storage-gcs";
import {
  hostedApplicationPorts,
  hostedKnowledgeStoreReference,
  hostedWorkspaceReference,
  openPostgresStorage,
  type PostgresStorage,
} from "@draft-loop/storage-postgres";
import { Storage } from "@google-cloud/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Set by `pnpm server:test` once the local stack is up (docs/operations/local-server-stack.md);
 * skipped otherwise. The smoke drives the API and the worker containers end to end.
 */
const apiUrl = process.env.DRAFT_LOOP_TEST_API_URL;

const env = (name: string): string => process.env[name] ?? "";
const silent = { write: () => undefined };
const createdAt = "2026-10-21T10:00:00.000Z";
const career = new TextEncoder().encode(
  "# Experience\n\n## Platform Engineer, Example Ledger (2020-2024)\n\nBuilt TypeScript services with deterministic testing.\n",
);

describe.runIf(apiUrl !== undefined)("local server stack", () => {
  const tenantId = env("DRAFT_LOOP_TEST_TENANT_ID");
  // Fresh ids each time, so the smoke runs again on a stack that keeps earlier data.
  const suffix = randomUUID().slice(0, 8);
  const workspaceId = `smoke-${suffix}`;
  const storeId = `store-${suffix}`;
  const knowledgeBaseId = `ckb-${suffix}`;
  // Built in beforeAll: the describe body also runs when the suite is skipped.
  let workspace: string;
  let blobs: BlobStoragePort;
  let storage: PostgresStorage;

  const api = (path: string, init: RequestInit = {}) =>
    fetch(`${apiUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${env("DRAFT_LOOP_TEST_API_OWNER_TOKEN")}`,
        "content-type": "application/json",
        ...init.headers,
      },
    });

  /** What intake and the workspace routes will do once they exist: one synthetic source. */
  async function seedKnowledge(): Promise<void> {
    await storage.createCandidateKnowledgeStore({ schemaVersion: 1, id: storeId, createdAt });
    await storage.createCandidateKnowledgeBase({
      id: knowledgeBaseId,
      displayName: "Career",
      description: "",
      isDefault: false,
      createdAt,
    });
    const versionId = `version-${suffix}`;
    await storage.createCandidateKnowledgeSource(
      {
        id: `source-${suffix}`,
        knowledgeBaseId,
        kind: "file",
        displayName: "career.md",
        createdAt,
      },
      {
        id: versionId,
        mediaType: "text/markdown",
        checksum: createHash("sha256").update(career).digest("hex"),
        sizeBytes: career.byteLength,
        createdAt,
      },
    );
    const reference = await blobs.put(
      `tenants/${tenantId}/knowledge/${storeId}/${versionId}`,
      career,
    );
    await storage.recordManagedCandidateKnowledgeSourceVersion({
      knowledgeBaseId,
      sourceId: `source-${suffix}`,
      versionId,
      location: reference.location,
      recordedAt: createdAt,
    });
  }

  /** A fixture-mode workspace with the knowledge selected and a reviewed job brief. */
  async function seedWorkspace(): Promise<{ briefId: string; version: number }> {
    const service = createApplicationService(
      createHostedApplicationDriver(hostedApplicationPorts({ storage, tenantId, blobs })),
    );
    await service.initialize(
      { root: workspace, jobDescription: "job.md", sources: "sources", fixtureMode: true },
      silent,
    );
    await service.configureKnowledgeSelection(
      {
        root: workspace,
        entries: [
          { storeRoot: hostedKnowledgeStoreReference(tenantId, storeId), storeId, knowledgeBaseId },
        ],
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
    return { briefId: reviewed.brief.id, version: reviewed.brief.version };
  }

  beforeAll(async () => {
    workspace = hostedWorkspaceReference(tenantId, workspaceId);
    blobs = createGcsBlobStorage({
      bucket: new Storage({
        apiEndpoint: env("DRAFT_LOOP_TEST_GCS_URL"),
        projectId: "draft-loop-local",
      }).bucket(env("DRAFT_LOOP_TEST_BLOB_BUCKET")),
      tenantId,
    });
    storage = await openPostgresStorage({
      connectionString: env("DRAFT_LOOP_TEST_RUNTIME_POSTGRES_URL"),
      schema: "draft_loop",
      tenantId,
    });
  });

  afterAll(async () => {
    await storage?.close();
  });

  it("begins a run through the API and reads it back once the worker has drafted it", async () => {
    await seedKnowledge();
    const opportunityBrief = await seedWorkspace();

    const workspaceResponse = await api(`/v1/workspaces/${workspaceId}`);
    const begun = await api(`/v1/workspaces/${workspaceId}/runs`, {
      method: "POST",
      headers: { "idempotency-key": `smoke-${suffix}` },
      body: JSON.stringify({ opportunityBrief }),
    });
    const run = (await begun.json()) as { runId: string; state: string };

    expect(workspaceResponse.status).toBe(200);
    expect(begun.status).toBe(201);
    let latest = run;
    for (let attempt = 0; attempt < 60 && latest.state !== "awaiting-approval"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      latest = (await (await api(`/v1/workspaces/${workspaceId}/runs/${run.runId}`)).json()) as {
        runId: string;
        state: string;
      };
    }
    expect(latest).toMatchObject({
      runId: run.runId,
      state: "awaiting-approval",
      hasDraft: true,
      approval: "pending",
    });
  }, 120_000);
});
