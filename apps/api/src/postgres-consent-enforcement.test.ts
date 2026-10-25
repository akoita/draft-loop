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
import { composeHostedApplication, hostedEntitlementsFor } from "./hosted-application.js";
import type { TenantApplications } from "./tenant-context.js";
import { assignInternalPlan } from "./test-plan.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const runtimeRole = "draft_loop_test_app";
const ownerToken = "owner-token-for-tests-0123456789abcdef";
const issuer = "https://id.example.test/realms/draft-loop";
const audience = "draft-loop-api";
const budgetCeiling = { maxRounds: 3, maxCostUsd: 3, maxDurationMs: 1_800_000 };
const tenantId = "org-consent";
const career =
  "# Experience\n\n## Platform Engineer, Example Ledger (2020-2024)\n\nBuilt TypeScript services with deterministic testing.\n";

const people = ["owner", "coach"] as const;
type Person = (typeof people)[number];
type Method = "GET" | "POST" | "PUT" | "PATCH";

const storageRequired = {
  status: 409,
  code: "storage_consent_required",
};
const transmissionRequired = {
  status: 409,
  code: "transmission_consent_required",
};

function runtimeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.username = runtimeRole;
  parsed.password = runtimeRole;
  return parsed.toString();
}

describe.runIf(connectionString !== undefined)("consent enforcement through the API", () => {
  const url = connectionString ?? "";
  const schema = `consent_${randomUUID().replaceAll("-", "")}`;
  const admin = createSqlClient({ connectionString: url, maxConnections: 1 });
  const tokens = {} as Record<Person, string>;
  const queued: string[] = [];
  let blobRoot: string;
  let tenancy: PostgresTenancy;
  let directory: PostgresTenantDirectory;
  let tenants: TenantApplications;
  let app: FastifyInstance;

  const call = async (person: Person, method: Method, path: string, payload?: object) => {
    const response = await app.inject({
      method,
      url: path,
      headers: { authorization: `Bearer ${tokens[person]}`, "idempotency-key": randomUUID() },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
    const body = response.json();
    return { status: response.statusCode, body, code: body.error?.code as string | undefined };
  };
  const upload = async (target: FastifyInstance, authorization: string, baseId: string) => {
    const response = await target.inject({
      method: "POST",
      url: `/v1/knowledge-bases/${baseId}/sources?name=career-${randomUUID()}.md`,
      headers: { authorization: `Bearer ${authorization}`, "content-type": "text/markdown" },
      payload: `${career}\n${randomUUID()}\n`,
    });
    return { status: response.statusCode, code: response.json().error?.code };
  };
  const consent = async (kind: string, action: string, providers?: string[]) => {
    const recorded = await call("coach", "POST", "/v1/workspaces/r1/consents", {
      kind,
      action,
      basis: kind === "material-storage" ? "contract" : "candidate-consent",
      ...(providers === undefined ? {} : { providers }),
    });
    expect(recorded.status).toBe(201);
  };
  const outcome = (response: { status: number; code: string | undefined }) => ({
    status: response.status,
    code: response.code,
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
    blobRoot = await mkdtemp(join(tmpdir(), "draft-loop-consent-"));
    tenancy = await openPostgresTenancy({ connectionString: runtimeUrl(url), schema });
    directory = await createPostgresTenantDirectory({ connectionString: runtimeUrl(url), schema });

    const email = (person: Person) => `${person}@consent.example.test`;
    await directory.createOrganisation({
      organisationId: tenantId,
      name: "Example Consent Coaching",
      firstOwnerEmail: email("owner"),
    });
    await assignInternalPlan(tenancy, tenantId);
    await directory.inviteMember({
      organisationId: tenantId,
      email: email("coach"),
      role: "member",
    });

    const signingKey = await generateKeyPair("ES256");
    const publicJwk = { ...(await exportJWK(signingKey.publicKey)), kid: "key-1", alg: "ES256" };
    for (const person of people) {
      tokens[person] = await new SignJWT({ email: email(person), email_verified: true })
        .setProtectedHeader({ alg: "ES256", kid: "key-1" })
        .setIssuer(issuer)
        .setAudience(audience)
        .setSubject(`subject-${person}`)
        .setExpirationTime("5m")
        .sign(signingKey.privateKey);
    }

    const blobs = createFilesystemBlobStorage();
    tenants = {
      budgetCeiling,
      recordAccessFor: (id) => tenancy.forTenant(id).candidateRecords,
      entitlementsFor: hostedEntitlementsFor(tenancy),
      knowledgeOwnersFor: (id) => tenancy.forTenant(id).knowledgeBaseOwners,
      applicationFor: (id) =>
        composeHostedApplication({
          storage: tenancy.forTenant(id),
          blobs,
          tenantId: id,
          budgetCeiling,
          enqueueRun: async (_workspaceId, runId) => {
            queued.push(runId);
          },
          knowledgeLocation: (versionId) => join(blobRoot, id, "knowledge", versionId),
        }),
    };
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
      tenants,
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

  it("stores material and queues provider work only under the record's current consent", async () => {
    expect((await call("coach", "PUT", "/v1/workspaces/r1", { fixtureMode: true })).status).toBe(
      201,
    );
    const base = await call("coach", "POST", "/v1/knowledge-bases", {
      displayName: "Career material",
      workspaceId: "r1",
    });
    expect(base.status).toBe(201);
    const baseId: string = base.body.id;

    // Storage: refused before the attestation, allowed after it, refused again after withdrawal.
    expect(await upload(app, tokens.coach, baseId)).toEqual(storageRequired);
    await consent("material-storage", "granted");
    expect((await upload(app, tokens.coach, baseId)).status).toBe(201);

    // A reviewed brief over the record's base, so a run can begin.
    expect(
      (
        await call("coach", "PUT", "/v1/workspaces/r1/knowledge-selection", {
          knowledgeBaseIds: [baseId],
        })
      ).status,
    ).toBe(200);
    const created = await call("coach", "POST", "/v1/workspaces/r1/opportunities", {
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
    const briefPath = `/v1/workspaces/r1/opportunities/${briefId}`;
    const edited = await call("coach", "PATCH", briefPath, {
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
    const reviewed = await call("coach", "POST", `${briefPath}/review`, {
      expectedVersion: edited.body.brief.version,
    });
    expect(reviewed.status).toBe(200);
    const beginRun = () =>
      call("coach", "POST", "/v1/workspaces/r1/runs", {
        opportunityBrief: { briefId, version: reviewed.body.brief.version },
      });

    const deriveProfile = () =>
      call("coach", "POST", "/v1/workspaces/r1/profiles/career/derivation", {
        providerDataApproved: true,
      });

    // Transmission: refused without a grant, and with one that omits the critic's company.
    expect(outcome(await beginRun())).toEqual(transmissionRequired);
    expect(outcome(await deriveProfile())).toEqual(transmissionRequired);
    await consent("provider-transmission", "granted", ["anthropic"]);
    expect(outcome(await beginRun())).toEqual(transmissionRequired);
    expect(queued).toEqual([]);
    await consent("provider-transmission", "granted", ["anthropic", "openai"]);
    const begun = await beginRun();
    expect(begun.status).toBe(201);
    // Past consent, a deployment without a derivation queue says so.
    expect(outcome(await deriveProfile())).toEqual({
      status: 503,
      code: "derivation_unavailable",
    });
    const runPath = `/v1/workspaces/r1/runs/${begun.body.runId as string}`;
    expect(queued).toEqual([begun.body.runId]);

    // A withdrawal refuses the next run and the resume of a paused one, and queues nothing.
    expect((await call("coach", "POST", `${runPath}/pause`, {})).status).toBe(200);
    await consent("provider-transmission", "withdrawn");
    expect(outcome(await beginRun())).toEqual(transmissionRequired);
    expect(outcome(await call("coach", "POST", `${runPath}/resume`, {}))).toEqual(
      transmissionRequired,
    );
    expect(queued).toHaveLength(1);
    await consent("provider-transmission", "granted", ["anthropic", "openai"]);
    expect((await call("coach", "POST", `${runPath}/resume`, {})).status).toBe(200);
    expect(queued).toHaveLength(2);

    await consent("material-storage", "withdrawn");
    expect(await upload(app, tokens.coach, baseId)).toEqual(storageRequired);
  });

  it("refuses uploads to a base no record owns, and leaves owner-token mode unchanged", async () => {
    const owner = await buildApi({ ownerToken, tenants: { ...tenants, ownerTenantId: tenantId } });
    try {
      const created = await owner.inject({
        method: "POST",
        url: "/v1/knowledge-bases",
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { displayName: "Shared notes" },
      });
      expect(created.statusCode).toBe(201);
      const unowned: string = created.json().id;
      // Owner-token mode keeps its behaviour: no record, no ledger, the upload is stored.
      expect((await upload(owner, ownerToken, unowned)).status).toBe(201);
      // In sign-in mode no record carries consent for it, so even the owner is refused.
      expect(await upload(app, tokens.owner, unowned)).toEqual(storageRequired);
    } finally {
      await owner.close();
    }
  });
});
