import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ApplicationBundle,
  createApplicationService,
  createLocalApplicationDriver,
  readApplicationBundle,
} from "@draft-loop/application";
import { openSqliteStorageReadOnly } from "@draft-loop/storage";
import { createFilesystemBlobStorage } from "@draft-loop/storage/blobs";
import {
  createSqlClient,
  grantPostgresStorageAccess,
  migratePostgresStorage,
  openPostgresStorage,
  type PostgresStorage,
} from "@draft-loop/storage-postgres";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";
import { composeHostedApplication } from "./hosted-application.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const runtimeRole = "draft_loop_test_app";
const ownerToken = "owner-token-for-tests-0123456789abcdef";
const silent = { write: () => undefined };

function runtimeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.username = runtimeRole;
  parsed.password = runtimeRole;
  return parsed.toString();
}

/** A fictional desktop workspace with a reviewed brief and an approved fixture run, as a bundle. */
async function desktopBundle(
  parent: string,
): Promise<{ bundle: ApplicationBundle; runId: string }> {
  const service = createApplicationService(createLocalApplicationDriver());
  const root = join(parent, "desktop");
  await mkdir(join(root, "evidence"), { recursive: true });
  const job = "# Fictional Platform Engineer\n\nBuild TypeScript services at Example Ledger.";
  await writeFile(join(root, "job.md"), `${job}\n`, "utf8");
  await writeFile(
    join(root, "evidence", "resume.md"),
    "Built fictional TypeScript services with deterministic testing.\n",
    "utf8",
  );
  await service.initialize(
    { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
    silent,
  );
  const briefId = "brief-import";
  await service.createOpportunity({
    root,
    id: briefId,
    sources: [
      {
        id: "posting",
        kind: "pasted-content",
        classification: "job-posting",
        content: "Platform Engineer at Example Ledger: build TypeScript services.",
      },
    ],
  });
  await service.editOpportunity({
    root,
    briefId,
    expectedVersion: 1,
    patch: {
      role: { value: "Platform Engineer", sourceIds: ["posting"] },
      employer: { value: "Example Ledger", sourceIds: ["posting"] },
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
  await service.reviewOpportunity({ root, briefId, expectedVersion: 2 });
  const started = await service.start(
    { root, opportunityBrief: { briefId, version: 3 }, allowProviderData: false },
    silent,
  );
  await service.lifecycle({ root, action: "revision", runId: started.runId }, silent);
  await service.resume({ root, runId: started.runId }, silent);
  await service.lifecycle({ root, action: "approve", runId: started.runId }, silent);
  const history = openSqliteStorageReadOnly(join(root, ".draft-loop", "history.sqlite"));
  try {
    const bundle = await readApplicationBundle({
      source: history,
      sourceWorkspaceId: (await service.readWorkspace(root)).id,
      sourceApplicationId: "default",
      name: "Fictional Platform Engineer",
      jobText: job,
    });
    return {
      bundle: JSON.parse(JSON.stringify(bundle)) as ApplicationBundle,
      runId: started.runId,
    };
  } finally {
    await history.close();
  }
}

describe.runIf(connectionString !== undefined)("importing a desktop application", () => {
  const url = connectionString ?? "";
  const schema = `import_${randomUUID().replaceAll("-", "")}`;
  const admin = createSqlClient({ connectionString: url, maxConnections: 1 });
  let storage: PostgresStorage;
  let parent: string;
  let app: FastifyInstance;

  const call = async (method: "GET" | "POST" | "PUT", path: string, payload?: object) => {
    const response = await app.inject({
      method,
      url: path,
      headers: { authorization: `Bearer ${ownerToken}` },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
    return { status: response.statusCode, body: response.json() };
  };

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`DO $$
      BEGIN
        CREATE ROLE ${runtimeRole} LOGIN PASSWORD '${runtimeRole}';
      EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
      END $$`);
    await migratePostgresStorage({ connectionString: url, schema });
    await grantPostgresStorageAccess({ connectionString: url, schema }, runtimeRole);
    storage = await openPostgresStorage({
      connectionString: runtimeUrl(url),
      schema,
      tenantId: "owner",
    });
    parent = await mkdtemp(join(tmpdir(), "draft-loop-import-"));
    const hosted = composeHostedApplication({
      storage,
      blobs: createFilesystemBlobStorage(),
      tenantId: "owner",
      budgetCeiling: { maxRounds: 3, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      enqueueRun: async () => undefined,
      knowledgeLocation: (versionId) => join(parent, "knowledge", versionId),
    });
    app = await buildApi({ ownerToken, application: hosted });
  });

  afterAll(async () => {
    await app?.close();
    await storage?.close();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.close();
    await rm(parent, { recursive: true, force: true });
  });

  it("shows the imported application and run, and answers a resend as already imported", async () => {
    const { bundle, runId } = await desktopBundle(parent);
    expect((await call("PUT", "/v1/workspaces/imported-1", { fixtureMode: true })).status).toBe(
      201,
    );

    const imported = await call("POST", "/v1/workspaces/imported-1/application-imports", bundle);

    expect(imported).toMatchObject({
      status: 201,
      body: {
        name: "Fictional Platform Engineer",
        status: "imported",
        counts: { runs: 1, briefs: 1, briefVersions: 3 },
      },
    });
    const applications = await call("GET", "/v1/workspaces/imported-1/applications");
    const application = applications.body.applications.find(
      (item: { id: string }) => item.id === imported.body.applicationId,
    );
    expect(application).toMatchObject({ name: "Fictional Platform Engineer" });
    expect(application.runs.map((run: { id: string }) => run.id)).toEqual([runId]);

    const review = await call("GET", `/v1/workspaces/imported-1/runs/${runId}/review`);
    expect(review.status).toBe(200);
    expect(JSON.stringify(review.body)).toContain("TypeScript");

    expect(
      await call("POST", "/v1/workspaces/imported-1/application-imports", bundle),
    ).toMatchObject({ status: 200, body: { status: "already-imported" } });
  });

  it("refuses a malformed bundle before writing anything", async () => {
    const refused = await call("POST", "/v1/workspaces/imported-1/application-imports", {
      format: "something-else",
    });
    expect(refused.status).toBe(400);
  });
});
