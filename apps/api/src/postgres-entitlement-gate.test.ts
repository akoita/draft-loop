import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  estimateRunCredits,
  resolveRunCreditTiers,
} from "@draft-loop/application/run-credit-estimate";
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
import { composeHostedApplication, hostedEntitlementsFor } from "./hosted-application.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const runtimeRole = "draft_loop_test_app";
const ownerToken = "owner-token-for-tests-0123456789abcdef";
const issuer = "https://id.example.test/realms/draft-loop";
const audience = "draft-loop-api";
const budgetCeiling = { maxRounds: 3, maxCostUsd: 3, maxDurationMs: 1_800_000 };
const career =
  "# Experience\n\n## Platform Engineer, Example Ledger (2020-2024)\n\nBuilt TypeScript services with deterministic testing.\n";

/** Each organisation has one owner who signs in and starts runs. */
const organisations = {
  "org-credits": "credits-owner",
  "org-caps": "caps-owner",
  "org-bare": "bare-owner",
} as const;
type OrganisationId = keyof typeof organisations;

function runtimeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.username = runtimeRole;
  parsed.password = runtimeRole;
  return parsed.toString();
}

describe.runIf(connectionString !== undefined)("the run-start gate through the API", () => {
  const url = connectionString ?? "";
  const schema = `gate_${randomUUID().replaceAll("-", "")}`;
  const admin = createSqlClient({ connectionString: url, maxConnections: 1 });
  const tokens = {} as Record<OrganisationId, string>;
  const queued: { tenantId: string; runId: string }[] = [];
  let blobRoot: string;
  let tenancy: PostgresTenancy;
  let directory: PostgresTenantDirectory;
  let app: FastifyInstance;

  const call = async (
    organisation: OrganisationId,
    method: "GET" | "POST" | "PUT" | "PATCH",
    path: string,
    payload?: object,
  ) => {
    const response = await app.inject({
      method,
      url: path,
      headers: {
        authorization: `Bearer ${tokens[organisation]}`,
        "idempotency-key": randomUUID(),
      },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
    return { status: response.statusCode, body: response.json() };
  };

  /** A record with consent, an owned base and a reviewed brief, ready to begin; returns the body. */
  const prepareRecord = async (organisation: OrganisationId, id: string) => {
    expect(
      (await call(organisation, "PUT", `/v1/workspaces/${id}`, { fixtureMode: true })).status,
    ).toBe(201);
    const consent = async (kind: string, providers?: string[]) =>
      expect(
        (
          await call(organisation, "POST", `/v1/workspaces/${id}/consents`, {
            kind,
            action: "granted",
            basis: kind === "material-storage" ? "contract" : "candidate-consent",
            ...(providers === undefined ? {} : { providers }),
          })
        ).status,
      ).toBe(201);
    const base = await call(organisation, "POST", "/v1/knowledge-bases", {
      displayName: "Career material",
      workspaceId: id,
    });
    expect(base.status).toBe(201);
    await consent("material-storage");
    const uploaded = await app.inject({
      method: "POST",
      url: `/v1/knowledge-bases/${base.body.id as string}/sources?name=career.md`,
      headers: {
        authorization: `Bearer ${tokens[organisation]}`,
        "content-type": "text/markdown",
      },
      payload: `${career}\n${id}\n`,
    });
    expect(uploaded.statusCode).toBe(201);
    expect(
      (
        await call(organisation, "PUT", `/v1/workspaces/${id}/knowledge-selection`, {
          knowledgeBaseIds: [base.body.id],
        })
      ).status,
    ).toBe(200);
    const created = await call(organisation, "POST", `/v1/workspaces/${id}/opportunities`, {
      sources: [
        {
          id: "posting",
          kind: "pasted-content",
          classification: "job-posting",
          content: "Platform Engineer at Example Ledger: build TypeScript services.",
        },
      ],
    });
    const briefPath = `/v1/workspaces/${id}/opportunities/${created.body.brief.id as string}`;
    const edited = await call(organisation, "PATCH", briefPath, {
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
    const reviewed = await call(organisation, "POST", `${briefPath}/review`, {
      expectedVersion: edited.body.brief.version,
    });
    expect(reviewed.status).toBe(200);
    await consent("provider-transmission", ["anthropic", "openai"]);
    return {
      opportunityBrief: { briefId: reviewed.body.brief.id, version: reviewed.body.brief.version },
    };
  };

  /** What the workspace's models and round limit cost to reserve. */
  const estimateFor = async (organisation: OrganisationId, id: string) => {
    const workspace = (await call(organisation, "GET", `/v1/workspaces/${id}`)).body;
    const tiers = resolveRunCreditTiers({
      configured: { author: workspace.author, critic: workspace.critic },
    });
    if (tiers.status !== "known") throw new Error("The default models should have known tiers.");
    return estimateRunCredits({ ...tiers, maxRounds: workspace.maxRounds }).credits;
  };

  const assign = (organisation: OrganisationId, overrides: object) =>
    tenancy.forTenant(organisation).organisationPlans.assignPlan({
      planId: "pro",
      overrides,
      periodStart: "2026-01-01",
      assignedAt: "2026-01-01T00:00:00.000Z",
    });

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`DO $$
      BEGIN
        CREATE ROLE ${runtimeRole} LOGIN PASSWORD '${runtimeRole}';
      EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
      END $$`);
    await migratePostgresStorage({ connectionString: url, schema });
    await grantPostgresStorageAccess({ connectionString: url, schema }, runtimeRole);
    blobRoot = await mkdtemp(join(tmpdir(), "draft-loop-gate-"));
    tenancy = await openPostgresTenancy({ connectionString: runtimeUrl(url), schema });
    directory = await createPostgresTenantDirectory({ connectionString: runtimeUrl(url), schema });

    const signingKey = await generateKeyPair("ES256");
    const publicJwk = { ...(await exportJWK(signingKey.publicKey)), kid: "key-1", alg: "ES256" };
    for (const [organisationId, subject] of Object.entries(organisations)) {
      await directory.createOrganisation({
        organisationId,
        name: `Example ${organisationId}`,
        firstOwnerEmail: `${subject}@gate.example.test`,
      });
      tokens[organisationId as OrganisationId] = await new SignJWT({
        email: `${subject}@gate.example.test`,
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
        recordAccessFor: (id) => tenancy.forTenant(id).candidateRecords,
        knowledgeOwnersFor: (id) => tenancy.forTenant(id).knowledgeBaseOwners,
        entitlementsFor: hostedEntitlementsFor(tenancy),
        applicationFor: (id) =>
          composeHostedApplication({
            storage: tenancy.forTenant(id),
            blobs,
            tenantId: id,
            budgetCeiling,
            enqueueRun: async (_workspaceId, runId) => {
              queued.push({ tenantId: id, runId });
            },
            knowledgeLocation: (versionId) => join(blobRoot, id, "knowledge", versionId),
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
    if (blobRoot !== undefined) await rm(blobRoot, { recursive: true, force: true });
  });

  it("starts one of two concurrent runs on a balance that covers one, and refuses the other", async () => {
    const organisation = "org-credits";
    const begin = await prepareRecord(organisation, "r1");
    const estimate = await estimateFor(organisation, "r1");
    // The period's allowance is exactly one run's estimate.
    await assign(organisation, {
      creditsPerPeriod: estimate,
      concurrentRuns: null,
      runsPerDay: null,
    });

    const [first, second] = await Promise.all([
      call(organisation, "POST", "/v1/workspaces/r1/runs", begin),
      call(organisation, "POST", "/v1/workspaces/r1/runs", begin),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 402]);
    const refused = first.status === 402 ? first : second;
    const started = first.status === 201 ? first : second;
    expect(refused.body.error).toMatchObject({
      code: "credits_insufficient",
      estimate,
      remaining: 0,
    });
    // The refused start saved and queued nothing; the started run holds the whole balance.
    expect(queued.filter((entry) => entry.tenantId === organisation)).toEqual([
      { tenantId: organisation, runId: started.body.runId },
    ]);
    const ledger = tenancy.forTenant(organisation).creditLedger;
    expect(await ledger.openReservationCount()).toBe(1);
    expect(await ledger.reservationFor(started.body.runId)).toMatchObject({
      credits: estimate,
      state: "open",
    });
    const read = await call(organisation, "GET", `/v1/workspaces/r1/runs/${started.body.runId}`);
    expect(read.status).toBe(200);
  });

  it("starts one of two concurrent runs when the plan allows one at a time", async () => {
    const organisation = "org-caps";
    const begin = await prepareRecord(organisation, "r2");
    await assign(organisation, { creditsPerPeriod: 100, concurrentRuns: 1, runsPerDay: null });

    const [first, second] = await Promise.all([
      call(organisation, "POST", "/v1/workspaces/r2/runs", begin),
      call(organisation, "POST", "/v1/workspaces/r2/runs", begin),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 429]);
    const refused = first.status === 429 ? first : second;
    expect(refused.body.error).toMatchObject({
      code: "run_cap_reached",
      cap: "concurrent",
      limit: 1,
    });
    expect(queued.filter((entry) => entry.tenantId === organisation)).toHaveLength(1);
    expect(await tenancy.forTenant(organisation).creditLedger.openReservationCount()).toBe(1);
  });

  it("refuses an organisation the operator has not given a plan, reserving nothing", async () => {
    const organisation = "org-bare";
    const begin = await prepareRecord(organisation, "r3");

    const refused = await call(organisation, "POST", "/v1/workspaces/r3/runs", begin);

    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("plan_required");
    expect(queued.filter((entry) => entry.tenantId === organisation)).toEqual([]);
    expect(await tenancy.forTenant(organisation).creditLedger.openReservationCount()).toBe(0);
  });
});
