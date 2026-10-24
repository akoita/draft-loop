import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApi, composeHostedApplication } from "@draft-loop/api";
import {
  type ApplicationService,
  createApplicationService,
  createHostedApplicationDriver,
  withRunBudgetDefaults,
} from "@draft-loop/application";
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

import { scriptedGateway, scriptedUsage } from "./gateway-test-support.js";
import { runtimeRole, runtimeUrl, tenantKeyBlobs } from "./hosted-test-support.js";
import { readModelGatewayConfig, workerProviderOptions } from "./model-routes.js";
import { createRunJobHandler, type RunJobOutcome } from "./run-job-handler.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const createdAt = "2026-10-21T10:00:00.000Z";
const silent = { write: () => undefined };
const tenantId = "tenant-a";
const workspace = hostedWorkspaceReference(tenantId, "workspace-1");
const storeReference = hostedKnowledgeStoreReference(tenantId, "store-1");
const budgetCeiling = { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 };
const career = new TextEncoder().encode(
  "# Experience\n\n## Platform Engineer, Example Ledger (2020-2024)\n\nBuilt TypeScript services with deterministic testing.\n",
);

/** Selects the synthetic knowledge base, reviews a one-requirement brief and begins its run. */
async function beginRun(service: ApplicationService, root: string) {
  await service.configureKnowledgeSelection(
    {
      root,
      entries: [{ storeRoot: storeReference, storeId: "store-1", knowledgeBaseId: "ckb-1" }],
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
  return service.begin(
    {
      root,
      opportunityBrief: { briefId: reviewed.brief.id, version: reviewed.brief.version },
    },
    silent,
  );
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
    const ports = hostedApplicationPorts({
      storage,
      tenantId,
      blobs: {
        ...blobs,
        get: (reference) => {
          reads.push(reference.location);
          return blobs.get(reference);
        },
      },
    });
    // As the API composes it: the ceiling fills the cost and duration limits the workspace lacks.
    const service = createApplicationService(
      createHostedApplicationDriver({
        ...ports,
        settings: withRunBudgetDefaults(ports.settings, budgetCeiling),
      }),
    );
    await service.initialize(
      { root: workspace, jobDescription: "job.md", sources: "sources", fixtureMode: true },
      silent,
    );
    const begun = await beginRun(service, workspace);
    const outcomes: RunJobOutcome[] = [];
    const handle = createRunJobHandler({
      serviceFor: () => service,
      workspaceRoot: (job) => hostedWorkspaceReference(job.tenantId, job.workspaceId),
      allowProviderData: false,
      budgetCeiling,
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

  it("drives a provider run through the model gateway and meters each call's route", async () => {
    const gatewayEnv = {
      DRAFT_LOOP_VERTEX_PROJECT_ID: "synthetic-project",
      DRAFT_LOOP_VERTEX_LOCATION: "eu",
      DRAFT_LOOP_VERTEX_PRICE_FACTOR: "1.1",
      DRAFT_LOOP_OPENAI_KEY_SECRET: "projects/synthetic/secrets/openai-key/versions/1",
    };
    const gateway = scriptedGateway(gatewayEnv.DRAFT_LOOP_OPENAI_KEY_SECRET);
    const ports = hostedApplicationPorts({ storage, tenantId, blobs });
    // As the worker composes it, with the gateway's endpoints and Secret Manager scripted.
    const service = createApplicationService(
      createHostedApplicationDriver({
        ...ports,
        settings: withRunBudgetDefaults(ports.settings, budgetCeiling),
        local: workerProviderOptions(readModelGatewayConfig(gatewayEnv), gateway.dependencies),
      }),
    );
    const root = hostedWorkspaceReference(tenantId, "workspace-2");
    await service.initialize(
      {
        root,
        jobDescription: "job.md",
        sources: "sources",
        authorCompany: "anthropic",
        authorModel: "claude-sonnet-5-5",
        criticCompany: "openai",
        criticModel: "gpt-6-luna",
      },
      silent,
    );
    const begun = await beginRun(service, root);
    const outcomes: RunJobOutcome[] = [];
    const handle = createRunJobHandler({
      serviceFor: () => service,
      workspaceRoot: (job) => hostedWorkspaceReference(job.tenantId, job.workspaceId),
      allowProviderData: true,
      budgetCeiling,
      onOutcome: (_job, outcome) => outcomes.push(outcome),
    });

    const job = { tenantId, workspaceId: "workspace-2", runId: begun.runId };
    while (outcomes.at(-1) !== "settled" && outcomes.length < 10) {
      await handle(job, { requeue: async () => undefined });
    }

    const snapshot = await service.status({ root, runId: begun.runId });
    expect(snapshot?.state).toBe("awaiting-approval");
    // The author reached Claude in the EU multi-region and the critic OpenAI's EU endpoint,
    // with the key Secret Manager holds; no call left the scripted gateway.
    expect(gateway.vertexUrls.length).toBeGreaterThan(0);
    for (const url of gateway.vertexUrls) {
      expect(url).toMatch(/^https:\/\/aiplatform\.eu\.rep\.googleapis\.com\//u);
    }
    expect(gateway.openAiOutputs).toEqual(["application_plan_review", "draft_critique"]);
    expect(new Set(gateway.openAiKeys)).toEqual(new Set(["synthetic-openai-key"]));

    // Run history records each call's route and its Vertex-priced cost: the draft and critique
    // as executions, the plan and its review in the plan step's records.
    const executions = await admin.query<{
      provider: string;
      model_id: string;
      route: string;
      estimated_usd: number;
      completed_at: string;
    }>(
      `SELECT provider, model_id, (payload_json::jsonb)->>'route' AS route,
              estimated_usd, completed_at
         FROM ${schema}.executions WHERE run_id = $1 AND status = 'completed'`,
      [begun.runId],
    );
    const calls = [
      ...executions.rows.map((row) => ({
        provider: row.provider,
        modelId: row.model_id,
        route: row.route,
        estimatedUsd: Number(row.estimated_usd),
      })),
      ...(snapshot?.applicationPlan?.steps ?? []),
    ];
    const vertexCallUsd =
      ((scriptedUsage.vertex.inputTokens * 2 + scriptedUsage.vertex.outputTokens * 10) / 1e6) * 1.1;
    const openAiCallUsd =
      (scriptedUsage.openai.inputTokens * 0.1 + scriptedUsage.openai.outputTokens * 0.5) / 1e6;
    const authorCalls = calls.filter((call) => call.provider === "anthropic");
    const criticCalls = calls.filter((call) => call.provider === "openai");
    // The plan and the draft; the plan review and the critique.
    expect([authorCalls.length, criticCalls.length]).toEqual([2, 2]);
    for (const call of authorCalls) {
      expect(call).toMatchObject({ modelId: "claude-sonnet-5-5", route: "vertex-ai" });
      expect(call.estimatedUsd).toBeCloseTo(vertexCallUsd, 10);
    }
    for (const call of criticCalls) {
      expect(call).toMatchObject({ modelId: "gpt-6-luna", route: "openai-api" });
      expect(call.estimatedUsd).toBeCloseTo(openAiCallUsd, 10);
    }
    const expected = {
      calls: calls.length,
      inputTokens:
        authorCalls.length * scriptedUsage.vertex.inputTokens +
        criticCalls.length * scriptedUsage.openai.inputTokens,
      outputTokens:
        authorCalls.length * scriptedUsage.vertex.outputTokens +
        criticCalls.length * scriptedUsage.openai.outputTokens,
      unpricedCalls: 0,
    };
    const expectedUsd = authorCalls.length * vertexCallUsd + criticCalls.length * openAiCallUsd;
    expect(snapshot?.totalCostUsd).toBeCloseTo(expectedUsd, 10);

    // The API's usage routes report the same totals, per run and for the tenant's month.
    const ownerToken = "owner-token-for-tests-0123456789abcdef";
    const api = await buildApi({
      ownerToken,
      application: {
        service,
        workspaceRoot: (workspaceId) => hostedWorkspaceReference(tenantId, workspaceId),
        enqueueRun: async () => undefined,
        budgetCeiling,
        monthUsage: (month) => storage.monthUsage(month),
      },
    });
    try {
      const month = String(executions.rows[0]?.completed_at).slice(0, 7);
      const [runUsage, monthUsage] = await Promise.all(
        [`/v1/workspaces/workspace-2/runs/${begun.runId}/usage`, `/v1/usage?month=${month}`].map(
          async (path) => {
            const response = await api.inject({
              method: "GET",
              url: path,
              headers: { authorization: `Bearer ${ownerToken}` },
            });
            expect(response.statusCode).toBe(200);
            return response.json<{ estimatedUsd: number; lines: { route: string | null }[] }>();
          },
        ),
      );
      expect(runUsage).toMatchObject(expected);
      expect(runUsage?.estimatedUsd).toBeCloseTo(expectedUsd, 8);
      expect(new Set(runUsage?.lines.map((line) => line.route))).toEqual(
        new Set(["vertex-ai", "openai-api"]),
      );
      // The month also holds the other workspace's fixture run, which costs nothing.
      expect(monthUsage?.lines.filter((line) => line.route !== "fixture")).toEqual(runUsage?.lines);
    } finally {
      await api.close();
    }
  }, 120_000);

  it("takes runs from setup to a downloaded DOCX through the API only, one after a revision", async () => {
    const ownerToken = "owner-token-for-tests-0123456789abcdef";
    const apiTenant = "tenant-api";
    const tenantBlobs = tenantKeyBlobs(blobRoot, blobs);
    const queued: { tenantId: string; workspaceId: string; runId: string }[] = [];
    const apiStorage = await openPostgresStorage({
      connectionString: runtimeUrl(url),
      schema,
      tenantId: apiTenant,
    });
    // The API and the worker share the tenant's database and blobs, as their containers do.
    const api = await buildApi({
      ownerToken,
      application: composeHostedApplication({
        storage: apiStorage,
        blobs: tenantBlobs,
        tenantId: apiTenant,
        budgetCeiling,
        enqueueRun: async (workspaceId, runId) => {
          queued.push({ tenantId: apiTenant, workspaceId, runId });
        },
        knowledgeLocation: (versionId) => `tenants/${apiTenant}/knowledge/${versionId}`,
      }),
    });
    const ports = hostedApplicationPorts({
      storage: apiStorage,
      tenantId: apiTenant,
      blobs: tenantBlobs,
    });
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
    let keys = 0;
    // The routes' JSON is read as it comes; each route's schema is tested in the API package.
    const call = async (
      method: "GET" | "POST" | "PUT" | "PATCH",
      path: string,
      payload?: object,
    ) => {
      keys += 1;
      const response = await api.inject({
        method,
        url: path,
        headers: {
          authorization: `Bearer ${ownerToken}`,
          "idempotency-key": `exit-key-${String(keys).padStart(4, "0")}`,
        },
        ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
      });
      return { status: response.statusCode, body: response.json() };
    };

    try {
      const workspacePath = "/v1/workspaces/exit-1";
      expect((await call("PUT", workspacePath, { fixtureMode: true })).status).toBe(201);
      const base = await call("POST", "/v1/knowledge-bases", { displayName: "Career" });
      const upload = await api.inject({
        method: "POST",
        url: `/v1/knowledge-bases/${base.body.id}/sources?name=career.md`,
        headers: { authorization: `Bearer ${ownerToken}`, "content-type": "text/markdown" },
        payload: Buffer.from(career),
      });
      expect(upload.statusCode).toBe(201);
      expect(
        (
          await call("PUT", `${workspacePath}/knowledge-selection`, {
            knowledgeBaseIds: [base.body.id],
          })
        ).status,
      ).toBe(200);
      const created = await call("POST", `${workspacePath}/opportunities`, {
        sources: [
          {
            id: "posting",
            kind: "pasted-content",
            classification: "job-posting",
            content: "Platform Engineer at Example Ledger: build TypeScript services.",
          },
        ],
      });
      const briefPath = `${workspacePath}/opportunities/${created.body.brief.id}`;
      const edited = await call("PATCH", briefPath, {
        expectedVersion: created.body.brief.version,
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
      const reviewed = await call("POST", `${briefPath}/review`, {
        expectedVersion: edited.body.brief.version,
      });
      expect(reviewed.status).toBe(200);
      const brief = { briefId: reviewed.body.brief.id, version: reviewed.body.brief.version };

      /** Begins a run and lets the worker draft it to the person's review. */
      const draftedRun = async (): Promise<string> => {
        const begun = await call("POST", `${workspacePath}/runs`, { opportunityBrief: brief });
        expect(begun.status).toBe(201);
        await drainQueue();
        const review = await call("GET", `${workspacePath}/runs/${begun.body.runId}/review`);
        expect(review.body.run.state).toBe("awaiting-approval");
        return begun.body.runId;
      };

      /** Decides every finding, approves, exports a DOCX and downloads it, checking its bytes. */
      const approveAndDownload = async (runId: string) => {
        const runPath = `${workspacePath}/runs/${runId}`;
        let review = (await call("GET", `${runPath}/review`)).body;
        expect(review.draft?.sections.length).toBeGreaterThan(0);
        for (const finding of review.findings) {
          const decided = await call(
            "PUT",
            `${runPath}/findings/${encodeURIComponent(finding.id)}/decision`,
            { decision: "accepted", rationale: "Checked against the source." },
          );
          expect(decided.status).toBe(200);
          review = decided.body;
        }
        expect(
          review.findings.every(({ decision }: { decision: string }) => decision === "accepted"),
        ).toBe(true);
        let approved = await call("POST", `${runPath}/approve`, {});
        if (approved.status === 409 && approved.body.error.code === "readiness_blocked") {
          approved = await call("POST", `${runPath}/approve`, {
            readinessOverrideRationale: "Synthetic test run: the owner accepts the open checks.",
          });
        }
        expect(approved.body).toMatchObject({ runId, state: "approved", approval: "approved" });

        const exported = await call("POST", `${runPath}/exports`, { format: "docx" });
        expect(exported.status).toBe(201);
        expect(exported.body).not.toHaveProperty("location");
        const listed = await call("GET", `${runPath}/exports`);
        expect(listed.body.exports).toEqual([exported.body]);
        const download = await api.inject({
          method: "GET",
          url: `${runPath}/exports/${encodeURIComponent(exported.body.id)}/content`,
          headers: { authorization: `Bearer ${ownerToken}` },
        });
        expect(download.statusCode).toBe(200);
        expect(download.headers["content-type"]).toContain(
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        );
        const sha256 = createHash("sha256").update(download.rawPayload).digest("hex");
        expect(sha256).toBe(exported.body.checksum);
        expect(download.headers["x-content-sha256"]).toBe(sha256);
        expect(download.rawPayload.byteLength).toBe(exported.body.sizeBytes);
        // A DOCX is a zip archive.
        expect(download.rawPayload.subarray(0, 2).toString("latin1")).toBe("PK");
        expect((await call("GET", runPath)).body.state).toBe("exported");
      };

      const firstRun = await draftedRun();
      await approveAndDownload(firstRun);

      const revisedRun = await draftedRun();
      const firstRound = (await call("GET", `${workspacePath}/runs/${revisedRun}`)).body.round;
      const revision = await call("POST", `${workspacePath}/runs/${revisedRun}/revision`, {
        candidateDirection: "Lead with the TypeScript services.",
      });
      expect(revision.status).toBe(200);
      expect(queued).toHaveLength(1);
      await drainQueue();
      const revised = await call("GET", `${workspacePath}/runs/${revisedRun}/review`);
      expect(revised.body.run).toMatchObject({ state: "awaiting-approval", round: firstRound + 1 });
      expect(revised.body.candidateDirection).toBe("Lead with the TypeScript services.");
      await approveAndDownload(revisedRun);

      // Each document is in the tenant's blobs, under its workspace and run.
      const stored = await readdir(join(blobRoot, "tenants", apiTenant, "workspaces", "exit-1"), {
        recursive: true,
      });
      const documentRuns = stored
        .filter((path) => path.endsWith(".docx"))
        .map((path) => path.split("/")[1]);
      expect(documentRuns.sort()).toEqual([firstRun, revisedRun].sort());
    } finally {
      await api.close();
      await apiStorage.close();
    }
  }, 120_000);
});
