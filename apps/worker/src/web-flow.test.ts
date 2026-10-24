import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApi, composeHostedApplication } from "@draft-loop/api";
import {
  createApplicationService,
  createHostedApplicationDriver,
  withRunBudgetDefaults,
} from "@draft-loop/application";
import { createFilesystemBlobStorage } from "@draft-loop/storage/blobs";
import {
  grantPostgresStorageAccess,
  hostedApplicationPorts,
  hostedWorkspaceReference,
  migratePostgresStorage,
  openPostgresStorage,
} from "@draft-loop/storage-postgres";
import {
  type ApiClient,
  approveRequest,
  briefEdit,
  briefPatchBody,
  createApiClient,
  createBriefBody,
  currentRunId,
  decisionRequest,
  defaultWorkspaceForm,
  exportFileName,
  exportRequestBody,
  ownerWorkspaceId,
  readDefaultApplication,
  reviewSections,
  selectionRequest,
  shouldPoll,
  sourceMediaType,
  startProblem,
  startRunBody,
  workspaceRequestBody,
} from "@draft-loop/web";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { injectFetch, runtimeRole, runtimeUrl, tenantKeyBlobs } from "./hosted-test-support.js";
import { createRunJobHandler } from "./run-job-handler.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const tenantId = "tenant-web";
const budgetCeiling = { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 };
const career =
  "# Experience\n\n## Platform Engineer, Example Ledger (2020-2024)\n\nBuilt TypeScript services with deterministic testing.\n";

describe.runIf(connectionString !== undefined)("web screen flow on Postgres", () => {
  const url = connectionString ?? "";
  const schema = `web_${randomUUID().replaceAll("-", "")}`;
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
    blobRoot = await mkdtemp(join(tmpdir(), "draft-loop-web-blobs-"));
  });

  afterAll(async () => {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
    await rm(blobRoot, { recursive: true, force: true });
  });

  it("takes a run from setup to a downloaded CV through the web client, with one revision", async () => {
    const storage = await openPostgresStorage({
      connectionString: runtimeUrl(url),
      schema,
      tenantId,
    });
    const blobs = tenantKeyBlobs(blobRoot, createFilesystemBlobStorage());
    const queued: { tenantId: string; workspaceId: string; runId: string }[] = [];
    // The API and the worker share the tenant's database and blobs, as their containers do.
    const api = await buildApi({
      ownerToken,
      application: composeHostedApplication({
        storage,
        blobs,
        tenantId,
        budgetCeiling,
        enqueueRun: async (workspaceId, runId) => {
          queued.push({ tenantId, workspaceId, runId });
        },
        knowledgeLocation: (versionId) => `tenants/${tenantId}/knowledge/${versionId}`,
      }),
    });
    const ports = hostedApplicationPorts({ storage, tenantId, blobs });
    const worker = createRunJobHandler({
      serviceFor: () =>
        createApplicationService(
          createHostedApplicationDriver({
            ...ports,
            settings: withRunBudgetDefaults(ports.settings, budgetCeiling),
          }),
        ),
      workspaceRoot: (job) => hostedWorkspaceReference(job.tenantId, job.workspaceId),
      allowProviderData: false,
      budgetCeiling,
    });
    const drainQueue = async () => {
      for (let job = queued.shift(); job !== undefined; job = queued.shift()) {
        await worker(job, { requeue: async () => undefined });
      }
    };
    const client: ApiClient = createApiClient({ token: ownerToken, fetch: injectFetch(api) });
    const workspace = { workspaceId: ownerWorkspaceId };

    try {
      // Workspace step: a first visit finds none and offers setup; create it in fixture mode, so
      // the run calls no model.
      await expect(
        client.call("GET /v1/workspaces/{workspaceId}", { path: workspace }),
      ).rejects.toMatchObject({ status: 404, code: "not_found" });
      const created = await client.call("PUT /v1/workspaces/{workspaceId}", {
        path: workspace,
        body: workspaceRequestBody({ ...defaultWorkspaceForm, fixtureMode: true }),
      });
      expect(created).toMatchObject({ fixtureMode: true });

      // Sources step: a base, one uploaded file, and the selection.
      const base = await client.call("POST /v1/knowledge-bases", {
        body: { displayName: "Career material" },
      });
      const contentType = sourceMediaType("career.md");
      if (contentType === undefined) throw new Error("Markdown is a source type.");
      await client.call("POST /v1/knowledge-bases/{knowledgeBaseId}/sources", {
        path: { knowledgeBaseId: base.id },
        query: { name: "career.md" },
        body: new Blob([career], { type: contentType }),
        contentType,
      });
      const { sources } = await client.call("GET /v1/knowledge-bases/{knowledgeBaseId}/sources", {
        path: { knowledgeBaseId: base.id },
      });
      expect(sources.map((source) => source.displayName)).toEqual(["career.md"]);
      const selection = selectionRequest([base.id], false);
      if ("problem" in selection) throw new Error(selection.problem);
      await client.call("PUT /v1/workspaces/{workspaceId}/knowledge-selection", {
        path: workspace,
        body: selection.body,
      });

      // Job brief step: paste, edit the requirements, mark the version reviewed.
      const pasted = await client.call("POST /v1/workspaces/{workspaceId}/opportunities", {
        path: workspace,
        body: createBriefBody(
          "Platform Engineer at Example Ledger: build TypeScript services.",
          new Date(),
        ),
      });
      const briefPath = { ...workspace, briefId: pasted.brief.id };
      const edited = await client.call(
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
      const reviewed = await client.call(
        "POST /v1/workspaces/{workspaceId}/opportunities/{briefId}/review",
        { path: briefPath, body: { expectedVersion: edited.brief.version } },
      );
      expect(startProblem(reviewed.brief)).toBeUndefined();

      // Run step: start, let the worker draft, and stop polling at review.
      const begun = await client.call("POST /v1/workspaces/{workspaceId}/runs", {
        path: workspace,
        header: { "idempotency-key": randomUUID() },
        body: startRunBody(reviewed.brief),
      });
      expect(shouldPoll(begun)).toBe(true);
      await drainQueue();
      // The default application lists the run, so a browser that remembers nothing finds it.
      const application = await readDefaultApplication(client);
      expect(currentRunId(application, {})).toBe(begun.runId);
      const runPath = { ...workspace, runId: begun.runId };
      const drafted = await client.call("GET /v1/workspaces/{workspaceId}/runs/{runId}", {
        path: runPath,
      });
      expect(drafted.state).toBe("awaiting-approval");
      expect(shouldPoll(drafted)).toBe(false);

      // Review step: the draft with its evidence, and one revision round.
      let review = await client.call("GET /v1/workspaces/{workspaceId}/runs/{runId}/review", {
        path: runPath,
      });
      if (review.draft === null) throw new Error("The run has a draft.");
      const { sections } = reviewSections(review.draft, review.findings);
      expect(sections.length).toBeGreaterThan(0);
      const revised = await client.call("POST /v1/workspaces/{workspaceId}/runs/{runId}/revision", {
        path: runPath,
        header: { "idempotency-key": randomUUID() },
        body: { candidateDirection: "Lead with the TypeScript services." },
      });
      expect(shouldPoll(revised)).toBe(true);
      await drainQueue();
      review = await client.call("GET /v1/workspaces/{workspaceId}/runs/{runId}/review", {
        path: runPath,
      });
      expect(review.run).toMatchObject({ state: "awaiting-approval", round: drafted.round + 1 });
      for (const finding of review.findings) {
        const request = decisionRequest("accepted", "Checked against the source.");
        if ("problem" in request) throw new Error(request.problem);
        review = await client.call(
          "PUT /v1/workspaces/{workspaceId}/runs/{runId}/findings/{findingId}/decision",
          { path: { ...runPath, findingId: finding.id }, body: request.body },
        );
      }

      // Approve and export: approve past any open check with a reason, export, download.
      const approval = approveRequest(
        review,
        "Synthetic test run: the owner accepts the open checks.",
      );
      if ("problem" in approval) throw new Error(approval.problem);
      const approved = await client.call("POST /v1/workspaces/{workspaceId}/runs/{runId}/approve", {
        path: runPath,
        body: approval.body,
      });
      expect(approved).toMatchObject({ state: "approved", approval: "approved" });
      const exported = await client.call("POST /v1/workspaces/{workspaceId}/runs/{runId}/exports", {
        path: runPath,
        header: { "idempotency-key": randomUUID() },
        body: exportRequestBody("docx", "modern"),
      });
      expect(exported).toMatchObject({ format: "docx", templateId: "modern" });
      expect(exportFileName(exported)).toMatch(/\.docx$/);
      const { exports } = await client.call(
        "GET /v1/workspaces/{workspaceId}/runs/{runId}/exports",
        { path: runPath },
      );
      expect(exports).toEqual([exported]);
      const document = await client.call(
        "GET /v1/workspaces/{workspaceId}/runs/{runId}/exports/{exportId}/content",
        { path: { ...runPath, exportId: exported.id } },
      );
      const bytes = Buffer.from(await document.arrayBuffer());
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(exported.checksum);
      expect(bytes.byteLength).toBe(exported.sizeBytes);
      // A DOCX is a zip archive.
      expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
    } finally {
      await api.close();
      await storage.close();
    }
  }, 120_000);
});
