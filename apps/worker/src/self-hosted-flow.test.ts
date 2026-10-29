import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApi, composeHostedApplication, hostedKnowledgeLocation } from "@draft-loop/api";
import {
  createApplicationService,
  createHostedApplicationDriver,
  withRunBudgetDefaults,
} from "@draft-loop/application";
import {
  grantPostgresStorageAccess,
  hostedApplicationPorts,
  hostedWorkspaceReference,
  migratePostgresStorage,
  openPostgresStorage,
} from "@draft-loop/storage-postgres";
import { workspaceSetupPresets } from "@draft-loop/ui/workspace-setup-model";
import {
  type ApiClient,
  briefEdit,
  briefPatchBody,
  createApiClient,
  createBriefBody,
  grantRequest,
  ownerWorkspaceId,
  selectionRequest,
  setupRequestBody,
  sourceMediaType,
  startRunBody,
  workspaceProviders,
} from "@draft-loop/web";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openTenantBlobs, readBlobBackend } from "./blob-backend.js";
import { scriptedDirectRoutes } from "./gateway-test-support.js";
import { filesUnder, injectFetch, runtimeRole, runtimeUrl } from "./hosted-test-support.js";
import { readModelRoutes, routeProviderOptions } from "./route-config.js";
import { createRunJobHandler } from "./run-job-handler.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const ownerToken = "owner-token-for-tests-0123456789abcdef";
// The self-hosted stack's one tenant (deploy/local/compose.yaml).
const tenantId = "local";
const budgetCeiling = { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 };
const career =
  "# Experience\n\n## Platform Engineer, Example Ledger (2020-2024)\n\nBuilt TypeScript services with deterministic testing.\n";

describe.runIf(connectionString !== undefined)("self-hosted run on Postgres", () => {
  const url = connectionString ?? "";
  const schema = `selfhosted_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: url });
  let directory: string;

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
    directory = await mkdtemp(join(tmpdir(), "draft-loop-self-hosted-"));
  });

  afterAll(async () => {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
    await rm(directory, { recursive: true, force: true });
  });

  it("takes an upload to an approved, exported DOCX on the direct routes with files on disk", async () => {
    // The operator's keys, one file each, readable by the service's user only.
    const keys = join(directory, "keys");
    await mkdir(keys);
    for (const [name, value] of [
      ["anthropic_api_key", "synthetic-claude-key\n"],
      ["openai_api_key", "synthetic-openai-key\n"],
    ] as const) {
      await writeFile(join(keys, name), value);
      await chmod(join(keys, name), 0o600);
    }
    const blobRoot = join(directory, "blobs");
    // The worker's and the API's settings on the self-hosted stack, read as their startup reads them.
    const env = {
      DRAFT_LOOP_MODEL_ROUTES: "direct",
      DRAFT_LOOP_SECRETS_DIR: keys,
      DRAFT_LOOP_BLOB_BACKEND: "filesystem",
      DRAFT_LOOP_BLOB_ROOT: blobRoot,
    };
    const routes = readModelRoutes(env);
    expect(routes?.kind).toBe("direct");
    const blobs = openTenantBlobs(readBlobBackend(env)).storageFor(tenantId);
    const scripted = scriptedDirectRoutes();

    const storage = await openPostgresStorage({
      connectionString: runtimeUrl(url),
      schema,
      tenantId,
    });
    const queued: { tenantId: string; workspaceId: string; runId: string }[] = [];
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
        knowledgeLocation: (versionId) => hostedKnowledgeLocation(tenantId, versionId),
      }),
    });
    const ports = hostedApplicationPorts({ storage, tenantId, blobs });
    const worker = createRunJobHandler({
      serviceFor: () =>
        createApplicationService(
          createHostedApplicationDriver({
            ...ports,
            settings: withRunBudgetDefaults(ports.settings, budgetCeiling),
            local: routeProviderOptions(routes, scripted.dependencies),
          }),
        ),
      workspaceRoot: (job) => hostedWorkspaceReference(job.tenantId, job.workspaceId),
      allowProviderData: true,
      budgetCeiling,
    });
    const drainQueue = async () => {
      for (let job = queued.shift(); job !== undefined; job = queued.shift()) {
        for (let step = 0; step < 10; step += 1) {
          let requeued = false;
          await worker(job, {
            requeue: async () => {
              requeued = true;
            },
          });
          if (!requeued) break;
        }
      }
    };
    const client: ApiClient = createApiClient({ token: ownerToken, fetch: injectFetch(api) });
    const workspace = { workspaceId: ownerWorkspaceId };

    try {
      // Setup: the Balanced preset, on real providers rather than fixtures.
      const preset = workspaceSetupPresets().find(({ id }) => id === "balanced");
      if (preset === undefined) throw new Error("The Balanced preset is listed.");
      const created = await client.call("PUT /v1/workspaces/{workspaceId}", {
        path: workspace,
        body: setupRequestBody({ language: "en", maxRounds: 2, preset, fixtureMode: false }),
      });
      expect(created).toMatchObject({ fixtureMode: false });
      for (const grant of [
        grantRequest("material-storage", { basis: "contract" }),
        grantRequest("provider-transmission", {
          basis: "candidate-consent",
          providers: workspaceProviders(created),
          confirmed: true,
          note: "Self-hosted test.",
        }),
      ]) {
        if ("problem" in grant) throw new Error(grant.problem);
        await client.call("POST /v1/workspaces/{workspaceId}/consents", {
          path: workspace,
          body: grant.body,
        });
      }

      // Career evidence: one uploaded file, kept on disk under the tenant's prefix.
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
      const selection = selectionRequest([base.id], false);
      if ("problem" in selection) throw new Error(selection.problem);
      await client.call("PUT /v1/workspaces/{workspaceId}/knowledge-selection", {
        path: workspace,
        body: selection.body,
      });
      const uploaded = await filesUnder(blobRoot);
      expect(uploaded).toHaveLength(1);
      expect(uploaded[0]).toMatch(new RegExp(`^tenants/${tenantId}/knowledge/`, "u"));

      // Job brief: paste, set one requirement, mark it reviewed.
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

      // Run: the worker drafts on the Claude API and critiques on OpenAI, with the keys from files.
      const begun = await client.call("POST /v1/workspaces/{workspaceId}/runs", {
        path: workspace,
        header: { "idempotency-key": randomUUID() },
        body: startRunBody(reviewed.brief),
      });
      await drainQueue();
      const runPath = { ...workspace, runId: begun.runId };
      const drafted = await client.call("GET /v1/workspaces/{workspaceId}/runs/{runId}", {
        path: runPath,
      });
      expect(drafted.state).toBe("awaiting-approval");
      expect(scripted.anthropicUrls.length).toBeGreaterThan(0);
      for (const call of scripted.anthropicUrls) {
        expect(call).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/messages/u);
      }
      expect(new Set(scripted.anthropicKeys)).toEqual(new Set(["synthetic-claude-key"]));
      expect(new Set(scripted.openAiKeys)).toEqual(new Set(["synthetic-openai-key"]));
      expect(scripted.openAiOutputs).toEqual(["application_plan_review", "draft_critique"]);

      // Run history names each call's route.
      const executions = await admin.query<{ provider: string; route: string }>(
        `SELECT provider, (payload_json::jsonb)->>'route' AS route
           FROM ${schema}.executions WHERE run_id = $1 AND status = 'completed'`,
        [begun.runId],
      );
      expect(new Set(executions.rows.map((row) => `${row.provider}:${row.route}`))).toEqual(
        new Set(["anthropic:anthropic-api", "openai:openai-api"]),
      );

      // Review: decide every finding, then approve, past any failing final check with a reason.
      const review = await client.call("GET /v1/workspaces/{workspaceId}/runs/{runId}/review", {
        path: runPath,
      });
      for (const finding of review.findings) {
        await client.call(
          "PUT /v1/workspaces/{workspaceId}/runs/{runId}/findings/{findingId}/decision",
          {
            path: { ...runPath, findingId: finding.id },
            body:
              finding.severity === "error"
                ? { decision: "overridden", rationale: "Checked against the source." }
                : { decision: "accepted" },
          },
        );
      }
      const approved = await client.call("POST /v1/workspaces/{workspaceId}/runs/{runId}/approve", {
        path: runPath,
        body: { readinessOverrideRationale: "Synthetic test run: the owner accepts the checks." },
      });
      expect(approved.state).toBe("approved");

      // Export: a DOCX whose bytes live on disk beside the upload, under the same tenant.
      const exported = await client.call("POST /v1/workspaces/{workspaceId}/runs/{runId}/exports", {
        path: runPath,
        header: { "idempotency-key": randomUUID() },
        body: { format: "docx", templateId: "modern" },
      });
      expect(exported).toMatchObject({ format: "docx", templateId: "modern" });
      const content = await api.inject({
        method: "GET",
        url: `/v1/workspaces/${ownerWorkspaceId}/runs/${begun.runId}/exports/${exported.id}/content`,
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect(content.statusCode).toBe(200);
      const bytes = content.rawPayload;
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(exported.checksum);
      // A DOCX is a zip archive.
      expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
      const stored = await filesUnder(blobRoot);
      expect(stored.length).toBeGreaterThan(uploaded.length);
      for (const key of stored) expect(key.startsWith(`tenants/${tenantId}/`)).toBe(true);
    } finally {
      await api.close();
      await storage.close();
    }
  }, 120_000);
});
