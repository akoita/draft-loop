import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApi, composeHostedApplication } from "@draft-loop/api";
import type { ProfileDerivationState } from "@draft-loop/run-queue";
import { createFilesystemBlobStorage } from "@draft-loop/storage/blobs";
import {
  grantPostgresStorageAccess,
  migratePostgresStorage,
  openPostgresStorage,
} from "@draft-loop/storage-postgres";
import { createCapabilityPort } from "@draft-loop/ui/bridge";
import { loadCareerEvidenceStatus } from "@draft-loop/ui/career-evidence";
import { addFirstCareerEvidence } from "@draft-loop/ui/career-evidence-setup";
import { createBridgeReviewPort } from "@draft-loop/ui/native";
import { createApiClient, createHttpBridge, ownerWorkspaceId } from "@draft-loop/web";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { injectFetch, runtimeRole, runtimeUrl, tenantKeyBlobs } from "./hosted-test-support.js";
import { createProfileDerivationHandler } from "./profile-derivation-handler.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const tenantId = "tenant-shared";
const budgetCeiling = { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 };
/** A fictional CV the browser's file picker would hand over. */
const evidenceFile = new File(
  ["# Example Candidate\n\n- Built TypeScript services at Example Ledger.\n"],
  "example-cv.md",
  { type: "text/markdown" },
);
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

  it("goes from Home through a reviewed career profile to a started run, through the port the shared screens use", async () => {
    const storage = await openPostgresStorage({
      connectionString: runtimeUrl(url),
      schema,
      tenantId,
    });
    // The worker's derivation, run in place when queued; its outcome is what the screens poll.
    let derivation: ProfileDerivationState | undefined;
    const derive = createProfileDerivationHandler({
      serviceFor: () => application.service,
      workspaceRoot: (job) => application.workspaceRoot(job.workspaceId),
      allowProviderData: true,
    });
    const application = composeHostedApplication({
      storage,
      blobs: tenantKeyBlobs(blobRoot, createFilesystemBlobStorage()),
      tenantId,
      budgetCeiling,
      enqueueRun: async () => undefined,
      profileDerivations: {
        queue: async (job) => {
          const signal = new AbortController().signal;
          const outcome = await derive({ tenantId, ...job }, { signal, reportProgress: () => {} });
          derivation =
            outcome.outcome === "derived"
              ? { status: "derived", version: outcome.version }
              : { status: "failed", reason: "failed" };
          return true;
        },
        state: async () => derivation,
        cancel: async () => false,
      },
      knowledgeLocation: (versionId) => `tenants/${tenantId}/knowledge/${versionId}`,
    });
    const api = await buildApi({ ownerToken, application });
    const client = createApiClient({ token: ownerToken, fetch: injectFetch(api) });
    const port = createBridgeReviewPort(
      createCapabilityPort(createHttpBridge({ client, pickFile: async () => evidenceFile })),
    );

    try {
      // The shell sets the workspace up first; the shared screens then open on it.
      await client.call("PUT /v1/workspaces/{workspaceId}", {
        path: { workspaceId: ownerWorkspaceId },
        body: { language: "en", maxRounds: 2, fixtureMode: true },
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

      // Career evidence: the card's first add creates the workspace's base, uploads the picked
      // file and selects the base; the start checklist then has nothing left to ask.
      const added = await addFirstCareerEvidence({
        capabilities: port,
        workspaceId: ownerWorkspaceId,
        source: { kind: "file" },
        safeName: (name) => name,
        isCurrent: () => true,
        onChanged: async () => true,
      });
      expect(added).toMatchObject({ status: "added" });
      expect(await loadCareerEvidenceStatus(port, ownerWorkspaceId, (name) => name)).toMatchObject({
        kind: "selected",
        displayName: "Career evidence",
        sourceCount: 1,
      });
      const ready = await port.load();
      expect(ready.setup.nextSteps).toEqual([]);

      // Career profile: derived on the worker, its open issues acknowledged, then reviewed; the
      // run chooses it from the reviewed catalog, as on the desktop.
      const drafted = await port.deriveCanonicalCandidateProfile?.({
        profileId: "career",
        providerTransmissionApproved: true,
      });
      if (drafted === undefined) throw new Error("The hosted port derives profiles.");
      expect(drafted).toMatchObject({ version: 1, status: "draft" });
      expect(drafted.facts.length).toBeGreaterThan(0);
      const acknowledged = await port.editCanonicalCandidateProfile?.({
        profileId: "career",
        expectedVersion: drafted.version,
        patch: { issues: drafted.issues.map((issue) => ({ ...issue, status: "acknowledged" })) },
      });
      const reviewedProfile = await port.reviewCanonicalCandidateProfile?.(
        "career",
        acknowledged?.version ?? drafted.version,
      );
      expect(reviewedProfile?.status).toBe("reviewed");
      const catalog = await port.listReviewedCanonicalCandidateProfiles?.(ownerWorkspaceId);
      const chosen = catalog?.profiles[0];
      if (chosen === undefined) throw new Error("The reviewed profile is in the catalog.");
      expect(chosen).toMatchObject({ profileId: "career", version: reviewedProfile?.version });

      // Start the review from the Review step: the run is saved and queued for a worker.
      const started = await port.dispatch(ready, {
        type: "start",
        candidateProfile: { profileId: chosen.profileId, version: chosen.version },
      });
      expect(started.runId).not.toBe("pending");
      const listed = await client.call(
        "GET /v1/workspaces/{workspaceId}/applications/{applicationId}",
        { path: { workspaceId: ownerWorkspaceId, applicationId: created.id } },
      );
      expect(listed.runs.map(({ id }) => id)).toEqual([started.runId]);
    } finally {
      await api.close();
      await storage.close();
    }
  }, 120_000);
});
