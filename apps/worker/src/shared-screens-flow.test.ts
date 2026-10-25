import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApi, composeHostedApplication } from "@draft-loop/api";
import { createFilesystemBlobStorage } from "@draft-loop/storage/blobs";
import {
  grantPostgresStorageAccess,
  migratePostgresStorage,
  openPostgresStorage,
} from "@draft-loop/storage-postgres";
import { createCapabilityPort } from "@draft-loop/ui/bridge";
import { createBridgeReviewPort } from "@draft-loop/ui/native";
import {
  createApiClient,
  createHttpBridge,
  defaultWorkspaceForm,
  ownerWorkspaceId,
  workspaceRequestBody,
} from "@draft-loop/web";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { injectFetch, runtimeRole, runtimeUrl, tenantKeyBlobs } from "./hosted-test-support.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const tenantId = "tenant-shared";
const budgetCeiling = { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 };
const jobText =
  "Platform Engineer at Example Ledger\n\nRequirements:\n- Build TypeScript services\n- Write deterministic tests\n";

describe.runIf(connectionString !== undefined)("shared screens on the hosted API", () => {
  const url = connectionString ?? "";
  const schema = `shared_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: url });
  let blobRoot: string;

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
    blobRoot = await mkdtemp(join(tmpdir(), "draft-loop-shared-blobs-"));
  });

  afterAll(async () => {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
    await rm(blobRoot, { recursive: true, force: true });
  });

  it("goes from Home to a reviewed brief through the port the shared screens use", async () => {
    const storage = await openPostgresStorage({
      connectionString: runtimeUrl(url),
      schema,
      tenantId,
    });
    const api = await buildApi({
      ownerToken,
      application: composeHostedApplication({
        storage,
        blobs: tenantKeyBlobs(blobRoot, createFilesystemBlobStorage()),
        tenantId,
        budgetCeiling,
        enqueueRun: async () => undefined,
        knowledgeLocation: (versionId) => `tenants/${tenantId}/knowledge/${versionId}`,
      }),
    });
    const client = createApiClient({ token: ownerToken, fetch: injectFetch(api) });
    const port = createBridgeReviewPort(createCapabilityPort(createHttpBridge({ client })));

    try {
      // The shell sets the workspace up first; the shared screens then open on it.
      await client.call("PUT /v1/workspaces/{workspaceId}", {
        path: { workspaceId: ownerWorkspaceId },
        body: workspaceRequestBody({ ...defaultWorkspaceForm, fixtureMode: true }),
      });
      const home = await port.load();
      expect(home).toMatchObject({ workspaceId: ownerWorkspaceId, runId: "pending" });
      expect(port.workspaceClosable).toBe(false);
      expect(port.jobPagesAllowed).toBe(false);
      expect(port.getCredentialStatus).toBeUndefined();

      // New application: a name and the pasted job, then its requirement step.
      const created = await port.createApplication?.(
        ownerWorkspaceId,
        "Example Ledger platform engineer",
        jobText,
      );
      if (created === undefined) throw new Error("The hosted port creates applications.");
      port.selectApplication?.(created.id);
      const extracted = await port.createOpportunity?.({
        sources: [
          { id: "job-posting", kind: "workspace-job-description", classification: "job-posting" },
        ],
      });
      if (extracted === undefined) throw new Error("The hosted port extracts requirements.");
      expect(extracted.requirements.length).toBeGreaterThan(0);
      expect(extracted.status).toBe("draft");

      // Review the brief; the application's start checklist then reads it as reviewed.
      const reviewed = await port.reviewOpportunity?.(extracted.briefId, extracted.version);
      expect(reviewed?.status).toBe("reviewed");
      const application = await port.load();
      expect(application.setup.jobDescriptionReady).toBe(true);
      expect(application.setup.reviewedOpportunity).toMatchObject({
        briefId: extracted.briefId,
      });
      expect(application.setup.nextSteps).toEqual([
        "Add at least one source to the selected knowledge base.",
      ]);
    } finally {
      await api.close();
      await storage.close();
    }
  }, 120_000);
});
