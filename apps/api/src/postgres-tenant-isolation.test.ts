import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFilesystemBlobStorage } from "@draft-loop/storage/blobs";
import {
  createPostgresTenantDirectory,
  createSqlClient,
  grantPostgresStorageAccess,
  migratePostgresStorage,
  openPostgresTenancy,
  type PostgresTenancy,
  type PostgresTenantDirectory,
} from "@draft-loop/storage-postgres";
import type { FastifyInstance } from "fastify";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";
import { composeHostedApplication } from "./hosted-application.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const runtimeRole = "draft_loop_test_app";
const ownerToken = "owner-token-for-tests-0123456789abcdef";
const issuer = "https://id.example.test/realms/draft-loop";
const audience = "draft-loop-api";
const budgetCeiling = { maxRounds: 3, maxCostUsd: 3, maxDurationMs: 1_800_000 };
const career =
  "# Experience\n\n## Platform Engineer, Example Ledger (2020-2024)\n\nBuilt TypeScript services with deterministic testing.\n";

/** Each signed-in person and the organisation the directory resolves them to. */
const members: Readonly<Record<string, string>> = {
  "person-a": "org-a",
  "person-b": "org-b",
};

function runtimeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.username = runtimeRole;
  parsed.password = runtimeRole;
  return parsed.toString();
}

describe.runIf(connectionString !== undefined)("tenant isolation through the API", () => {
  const url = connectionString ?? "";
  const schema = `tenants_${randomUUID().replaceAll("-", "")}`;
  const admin = createSqlClient({ connectionString: url, maxConnections: 1 });
  const queued: { tenantId: string; workspaceId: string; runId: string }[] = [];
  const tokens: Record<string, string> = {};
  let tenancy: PostgresTenancy;
  let directory: PostgresTenantDirectory;
  let blobRoot: string;
  let app: FastifyInstance;

  const call = async (
    person: "person-a" | "person-b",
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    payload?: object,
  ) => {
    const response = await app.inject({
      method,
      url: path,
      headers: {
        authorization: `Bearer ${tokens[person]}`,
        "idempotency-key": "tenant-test-0001",
      },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
    return { status: response.statusCode, body: response.json() };
  };
  const asA = (...args: [Parameters<typeof call>[1], string, object?]) => call("person-a", ...args);
  const asB = (...args: [Parameters<typeof call>[1], string, object?]) => call("person-b", ...args);

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`DO $$
      BEGIN
        CREATE ROLE ${runtimeRole} LOGIN PASSWORD '${runtimeRole}';
      EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
      END $$`);
    await migratePostgresStorage({ connectionString: url, schema });
    await grantPostgresStorageAccess({ connectionString: url, schema }, runtimeRole);
    tenancy = await openPostgresTenancy({ connectionString: runtimeUrl(url), schema });
    // Each person owns their organisation, so record access never confines them.
    directory = await createPostgresTenantDirectory({ connectionString: runtimeUrl(url), schema });
    for (const [subject, organisationId] of Object.entries(members)) {
      await directory.createOrganisation({
        organisationId,
        name: `Organisation ${organisationId}`,
        firstOwnerEmail: `${subject}@example.test`,
      });
    }
    blobRoot = await mkdtemp(join(tmpdir(), "draft-loop-tenants-"));

    const signingKey = await generateKeyPair("ES256");
    const publicJwk = { ...(await exportJWK(signingKey.publicKey)), kid: "key-1", alg: "ES256" };
    for (const subject of Object.keys(members)) {
      tokens[subject] = await new SignJWT({
        email: `${subject}@example.test`,
        email_verified: true,
      })
        .setProtectedHeader({ alg: "ES256", kid: "key-1" })
        .setIssuer(issuer)
        .setAudience(audience)
        .setSubject(subject)
        .setExpirationTime("5m")
        .sign(signingKey.privateKey);
    }

    const blobs = createFilesystemBlobStorage();
    app = await buildApi({
      ownerToken,
      auth: {
        mode: "oidc",
        issuer,
        audience,
        webClientId: "draft-loop-web",
        allowHttp: false,
        keys: createLocalJWKSet({ keys: [publicJwk] }),
        resolveSignIn: directory.resolveSignIn,
      },
      tenants: {
        budgetCeiling,
        recordAccessFor: (tenantId) => tenancy.forTenant(tenantId).candidateRecords,
        knowledgeOwnersFor: (tenantId) => tenancy.forTenant(tenantId).knowledgeBaseOwners,
        applicationFor: (tenantId) =>
          composeHostedApplication({
            storage: tenancy.forTenant(tenantId),
            blobs,
            tenantId,
            budgetCeiling,
            enqueueRun: async (workspaceId, runId) => {
              queued.push({ tenantId, workspaceId, runId });
            },
            knowledgeLocation: (versionId) => join(blobRoot, tenantId, "knowledge", versionId),
          }),
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    await directory?.close();
    await tenancy?.close();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.close();
    await rm(blobRoot, { recursive: true, force: true });
  });

  it("keeps each organisation's workspaces, knowledge, briefs and runs from the other", async () => {
    // The same workspace id names a separate workspace in each tenant.
    expect((await asA("PUT", "/v1/workspaces/shared", { fixtureMode: true })).status).toBe(201);
    expect((await asB("PUT", "/v1/workspaces/shared", { fixtureMode: true })).status).toBe(201);
    expect((await asA("PUT", "/v1/workspaces/a-only", { fixtureMode: true })).status).toBe(201);
    expect((await asB("GET", "/v1/workspaces/a-only")).status).toBe(404);
    expect(
      (await asB("PUT", "/v1/workspaces/a-only/writing-policy", { content: "B" })).status,
    ).toBe(404);

    const policyText = "# Writing policy\n\nKeep each bullet to one sentence.";
    expect(
      (await asA("PUT", "/v1/workspaces/shared/writing-policy", { content: policyText })).status,
    ).toBe(200);
    expect((await asB("GET", "/v1/workspaces/shared/writing-policy")).status).toBe(404);

    // Consent is recorded before any material, and each tenant's ledger is its own.
    const consent = await asA("POST", "/v1/workspaces/shared/consents", {
      kind: "provider-transmission",
      action: "granted",
      basis: "candidate-consent",
      providers: ["anthropic", "openai"],
    });
    expect(consent.status).toBe(201);
    expect(consent.body.recordedBy).toMatchObject({ kind: "member" });
    const storage = await asA("POST", "/v1/workspaces/shared/consents", {
      kind: "material-storage",
      action: "granted",
      basis: "contract",
    });
    expect(storage.status).toBe(201);
    expect((await asA("GET", "/v1/workspaces/shared/consents")).body.history).toEqual([
      consent.body,
      storage.body,
    ]);
    expect((await asB("GET", "/v1/workspaces/shared/consents")).body.history).toEqual([]);
    expect((await asB("GET", "/v1/workspaces/a-only/consents")).status).toBe(404);

    // Knowledge bases, their sources and their rules.
    const base = await asA("POST", "/v1/knowledge-bases", {
      displayName: "Career",
      workspaceId: "shared",
    });
    expect(base.status).toBe(201);
    const upload = await app.inject({
      method: "POST",
      url: `/v1/knowledge-bases/${base.body.id}/sources?name=career.md`,
      headers: { authorization: `Bearer ${tokens["person-a"]}`, "content-type": "text/markdown" },
      payload: career,
    });
    expect(upload.statusCode).toBe(201);
    const rulesPath = `/v1/knowledge-bases/${base.body.id}/sensitivity-rules`;
    expect(
      (
        await asA("POST", rulesPath, {
          tier: "never-share",
          match: { kind: "heading-contains", text: "Private notes" },
        })
      ).status,
    ).toBe(201);

    expect((await asB("GET", "/v1/knowledge-bases")).body.knowledgeBases).toEqual([]);
    expect((await asB("GET", `/v1/knowledge-bases/${base.body.id}/sources`)).status).toBe(404);
    expect((await asB("GET", rulesPath)).status).toBe(404);
    const intrusion = await app.inject({
      method: "POST",
      url: `/v1/knowledge-bases/${base.body.id}/sources?name=other.md`,
      headers: { authorization: `Bearer ${tokens["person-b"]}`, "content-type": "text/markdown" },
      payload: career,
    });
    expect(intrusion.statusCode).toBe(404);
    expect(
      (
        await asB("PUT", "/v1/workspaces/shared/knowledge-selection", {
          knowledgeBaseIds: [base.body.id],
        })
      ).status,
    ).toBe(404);
    expect((await asA("GET", "/v1/knowledge-bases")).body.knowledgeBases).toHaveLength(1);

    // A reviewed brief, then a run.
    expect(
      (
        await asA("PUT", "/v1/workspaces/shared/knowledge-selection", {
          knowledgeBaseIds: [base.body.id],
        })
      ).status,
    ).toBe(200);
    const created = await asA("POST", "/v1/workspaces/shared/opportunities", {
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
    const briefPath = `/v1/workspaces/shared/opportunities/${briefId}`;
    const edited = await asA("PATCH", briefPath, {
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
    expect((await asB("GET", briefPath)).status).toBe(404);
    expect(
      (
        await asB("PATCH", briefPath, {
          expectedVersion: edited.body.brief.version,
          patch: { employer: null },
        })
      ).status,
    ).toBe(404);
    const reviewed = await asA("POST", `${briefPath}/review`, {
      expectedVersion: edited.body.brief.version,
    });
    expect(reviewed.status).toBe(200);

    const run = await asA("POST", "/v1/workspaces/shared/runs", {
      opportunityBrief: { briefId, version: reviewed.body.brief.version },
    });
    expect(run.status).toBe(201);
    const runId = run.body.runId as string;
    expect(queued).toEqual([{ tenantId: "org-a", workspaceId: "shared", runId }]);
    expect((await asA("GET", `/v1/workspaces/shared/runs/${runId}`)).status).toBe(200);

    // To B, A's run answers exactly as a run that was never begun: nothing of it shows.
    const runPath = `/v1/workspaces/shared/runs/${runId}`;
    const unknownPath = "/v1/workspaces/shared/runs/run-0000000000000-00000000";
    const runCalls: [Parameters<typeof call>[1], string, object?][] = [
      ["GET", ""],
      ["GET", "/exports"],
      ["POST", "/exports", { format: "markdown" }],
      ["GET", "/usage"],
      ["GET", "/review"],
      ["POST", "/stop", {}],
    ];
    for (const [method, suffix, payload] of runCalls) {
      const intruding = await asB(method, `${runPath}${suffix}`, payload);
      const unknown = await asB(method, `${unknownPath}${suffix}`, payload);
      expect(intruding.status, `${method} ${suffix}`).toBe(404);
      expect(intruding.body.error?.code, `${method} ${suffix}`).toBe("not_found");
      expect({ status: intruding.status, code: intruding.body.error?.code }).toEqual({
        status: unknown.status,
        code: unknown.body.error?.code,
      });
    }
    expect((await asA("GET", `${runPath}/review`)).status).toBe(200);

    // Each tenant's listing of its own `shared` workspace shows only its own records.
    const listedByA = await asA("GET", "/v1/workspaces/shared/applications");
    expect(listedByA.body.applications[0].runs.map((item: { id: string }) => item.id)).toEqual([
      runId,
    ]);
    const listedByB = await asB("GET", "/v1/workspaces/shared/applications");
    expect(listedByB.status).toBe(200);
    for (const application of listedByB.body.applications) {
      expect(application.briefs).toEqual([]);
      expect(application.runs).toEqual([]);
    }
  });

  it("reaches no tenant with the owner token in sign-in mode", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/knowledge-bases",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(response.statusCode).toBe(401);
  });
});
