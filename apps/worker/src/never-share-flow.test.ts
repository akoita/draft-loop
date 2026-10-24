import { randomUUID } from "node:crypto";
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
  briefEdit,
  briefPatchBody,
  createApiClient,
  createBriefBody,
  defaultWorkspaceForm,
  ownerWorkspaceId,
  ruleRequest,
  selectionRequest,
  startRunBody,
  workspaceRequestBody,
} from "@draft-loop/web";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { scriptedGateway } from "./gateway-test-support.js";
import { injectFetch, runtimeRole, runtimeUrl, tenantKeyBlobs } from "./hosted-test-support.js";
import { readModelGatewayConfig, workerProviderOptions } from "./model-routes.js";
import { createRunJobHandler, type RunJobOutcome } from "./run-job-handler.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const tenantId = "tenant-never-share";
const budgetCeiling = { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 };
// Not hexadecimal, so no id or checksum in a request can contain it by chance.
const neverShareText = "Synthetic private note quokka-marigold: expected salary band.";
const policyText = "Synthetic policy 9c2e: keep every bullet under two lines.";
const career = [
  "# Experience",
  "",
  "## Platform Engineer, Example Ledger (2020-2024)",
  "",
  "Built TypeScript services with deterministic testing.",
  "",
  "## Compensation notes",
  "",
  neverShareText,
  "",
].join("\n");
const gatewayEnv = {
  DRAFT_LOOP_VERTEX_PROJECT_ID: "synthetic-project",
  DRAFT_LOOP_VERTEX_LOCATION: "eu",
  DRAFT_LOOP_VERTEX_PRICE_FACTOR: "1.1",
  DRAFT_LOOP_OPENAI_KEY_SECRET: "projects/synthetic/secrets/openai-key/versions/1",
};

describe.runIf(connectionString !== undefined)("never-share material on Postgres", () => {
  const url = connectionString ?? "";
  const schema = `never_share_${randomUUID().replaceAll("-", "")}`;
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
    blobRoot = await mkdtemp(join(tmpdir(), "draft-loop-never-share-blobs-"));
  });

  afterAll(async () => {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
    await rm(blobRoot, { recursive: true, force: true });
  });

  it("sends the writing policy to the models and a never-share section to none of them", async () => {
    const storage = await openPostgresStorage({
      connectionString: runtimeUrl(url),
      schema,
      tenantId,
    });
    const blobs = tenantKeyBlobs(blobRoot, createFilesystemBlobStorage());
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
        knowledgeLocation: (versionId) => `tenants/${tenantId}/knowledge/${versionId}`,
      }),
    });
    // The worker reaches Claude and OpenAI through the gateway, whose endpoints are scripted
    // here and record every request body they receive.
    const gateway = scriptedGateway(gatewayEnv.DRAFT_LOOP_OPENAI_KEY_SECRET);
    const ports = hostedApplicationPorts({ storage, tenantId, blobs });
    const outcomes: RunJobOutcome[] = [];
    const worker = createRunJobHandler({
      serviceFor: () =>
        createApplicationService(
          createHostedApplicationDriver({
            ...ports,
            settings: withRunBudgetDefaults(ports.settings, budgetCeiling),
            local: workerProviderOptions(readModelGatewayConfig(gatewayEnv), gateway.dependencies),
          }),
        ),
      workspaceRoot: (job) => hostedWorkspaceReference(job.tenantId, job.workspaceId),
      allowProviderData: true,
      budgetCeiling,
      onOutcome: (_job, outcome) => outcomes.push(outcome),
    });
    const client: ApiClient = createApiClient({ token: ownerToken, fetch: injectFetch(api) });
    const workspace = { workspaceId: ownerWorkspaceId };

    try {
      await client.call("PUT /v1/workspaces/{workspaceId}", {
        path: workspace,
        body: workspaceRequestBody({
          ...defaultWorkspaceForm,
          authorModel: "claude-sonnet-5-5",
          criticModel: "gpt-6-luna",
        }),
      });
      await client.call("PUT /v1/workspaces/{workspaceId}/writing-policy", {
        path: workspace,
        body: { content: `# Writing policy\n\n${policyText}\n` },
      });

      // The source holds a section the candidate marks never-share after uploading it.
      const base = await client.call("POST /v1/knowledge-bases", {
        body: { displayName: "Career material" },
      });
      await client.call("POST /v1/knowledge-bases/{knowledgeBaseId}/sources", {
        path: { knowledgeBaseId: base.id },
        query: { name: "career.md" },
        body: new Blob([career], { type: "text/markdown" }),
        contentType: "text/markdown",
      });
      const rule = ruleRequest({
        tier: "never-share",
        kind: "heading-contains",
        heading: "Compensation",
      });
      if ("problem" in rule) throw new Error(rule.problem);
      await client.call("POST /v1/knowledge-bases/{knowledgeBaseId}/sensitivity-rules", {
        path: { knowledgeBaseId: base.id },
        body: rule.body,
      });
      const selection = selectionRequest([base.id], false);
      if ("problem" in selection) throw new Error(selection.problem);
      await client.call("PUT /v1/workspaces/{workspaceId}/knowledge-selection", {
        path: workspace,
        body: selection.body,
      });

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
      const begun = await client.call("POST /v1/workspaces/{workspaceId}/runs", {
        path: workspace,
        header: { "idempotency-key": randomUUID() },
        body: startRunBody(reviewed.brief),
      });
      const job = queued.shift();
      if (job === undefined) throw new Error("The run was queued.");
      while (outcomes.at(-1) !== "settled" && outcomes.length < 10) {
        await worker(job, { requeue: async () => undefined });
      }

      const drafted = await client.call("GET /v1/workspaces/{workspaceId}/runs/{runId}", {
        path: { ...workspace, runId: begun.runId },
      });
      expect(drafted.state).toBe("awaiting-approval");
      // Both models were called, the policy reached them, and the never-share text reached none.
      expect(gateway.vertexUrls.length).toBeGreaterThan(0);
      expect(gateway.openAiOutputs.length).toBeGreaterThan(0);
      expect(gateway.requestBodies.length).toBe(
        gateway.vertexUrls.length + gateway.openAiOutputs.length,
      );
      const sent = gateway.requestBodies.join("\n");
      expect(sent).toContain("Built TypeScript services with deterministic testing.");
      expect(sent).toContain("Synthetic policy 9c2e");
      expect(sent).not.toContain("quokka-marigold");
      expect(sent).not.toContain("expected salary band");
    } finally {
      await api.close();
      await storage.close();
    }
  }, 120_000);
});
