import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
const career =
  "# Experience\n\n## Platform Engineer, Example Ledger (2020-2024)\n\nBuilt TypeScript services with deterministic testing.\n";

function runtimeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.username = runtimeRole;
  parsed.password = runtimeRole;
  return parsed.toString();
}

describe.runIf(connectionString !== undefined)("hosted setup through the API", () => {
  const url = connectionString ?? "";
  const schema = `setup_${randomUUID().replaceAll("-", "")}`;
  const admin = createSqlClient({ connectionString: url, maxConnections: 1 });
  const queued: { workspaceId: string; runId: string }[] = [];
  let storage: PostgresStorage;
  let blobRoot: string;
  let app: FastifyInstance;

  const call = async (method: "GET" | "POST" | "PUT" | "PATCH", path: string, payload?: object) => {
    const response = await app.inject({
      method,
      url: path,
      headers: { authorization: `Bearer ${ownerToken}`, "idempotency-key": "setup-run-0001" },
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
    blobRoot = await mkdtemp(join(tmpdir(), "draft-loop-setup-"));
    app = await buildApi({
      ownerToken,
      application: composeHostedApplication({
        storage,
        blobs: createFilesystemBlobStorage(),
        tenantId: "owner",
        budgetCeiling: { maxRounds: 3, maxCostUsd: 3, maxDurationMs: 1_800_000 },
        enqueueRun: async (workspaceId, runId) => {
          queued.push({ workspaceId, runId });
        },
        knowledgeLocation: (versionId) => join(blobRoot, "knowledge", versionId),
      }),
    });
  });

  afterAll(async () => {
    await app?.close();
    await storage?.close();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.close();
    await rm(blobRoot, { recursive: true, force: true });
  });

  it("sets up a workspace, its knowledge and a reviewed brief, then begins a run", async () => {
    const workspace = await call("PUT", "/v1/workspaces/setup-1", { fixtureMode: true });
    expect(workspace.status).toBe(201);
    expect(await call("PUT", "/v1/workspaces/setup-1", { fixtureMode: true })).toMatchObject({
      status: 409,
    });

    const base = await call("POST", "/v1/knowledge-bases", { displayName: "Career" });
    expect(base.status).toBe(201);
    const upload = await app.inject({
      method: "POST",
      url: `/v1/knowledge-bases/${base.body.id}/sources?name=career.md`,
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "text/markdown" },
      payload: career,
    });
    expect(upload.statusCode).toBe(201);
    const sources = await call("GET", `/v1/knowledge-bases/${base.body.id}/sources`);
    expect(sources.body.sources).toHaveLength(1);

    const selected = await call("PUT", "/v1/workspaces/setup-1/knowledge-selection", {
      knowledgeBaseIds: [base.body.id],
    });
    expect(selected.status).toBe(200);
    expect(selected.body.knowledgeBaseIds).toEqual([base.body.id]);

    const created = await call("POST", "/v1/workspaces/setup-1/opportunities", {
      sources: [
        {
          id: "posting",
          kind: "pasted-content",
          classification: "job-posting",
          content: "Platform Engineer at Example Ledger: build TypeScript services.",
        },
      ],
    });
    expect(created.status).toBe(201);
    const briefId = created.body.brief.id as string;
    const briefPath = `/v1/workspaces/setup-1/opportunities/${briefId}`;
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
    expect(edited.status).toBe(200);
    const stale = await call("PATCH", briefPath, {
      expectedVersion: created.body.brief.version,
      patch: { employer: null },
    });
    expect(stale.status).toBe(409);
    const reviewed = await call("POST", `${briefPath}/review`, {
      expectedVersion: edited.body.brief.version,
    });
    expect(reviewed.status).toBe(200);
    const versions = await call("GET", `${briefPath}/versions`);
    expect(versions.body.versions.map(({ status }: { status: string }) => status)).toEqual([
      "draft",
      "draft",
      "reviewed",
    ]);

    const run = await call("POST", "/v1/workspaces/setup-1/runs", {
      opportunityBrief: { briefId, version: reviewed.body.brief.version },
    });
    expect(run.status).toBe(201);
    expect(queued).toEqual([{ workspaceId: "setup-1", runId: run.body.runId }]);
    const read = await call("GET", `/v1/workspaces/setup-1/runs/${run.body.runId}`);
    expect(read.status).toBe(200);
  });
});
