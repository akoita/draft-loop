import { createHash, randomUUID } from "node:crypto";
import type { BlobStoragePort } from "@draft-loop/storage";
import type { BlobErasure } from "@draft-loop/storage/record-erasure";
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
import { composeHostedApplication, hostedKnowledgeLocation } from "./hosted-application.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const runtimeRole = "draft_loop_test_app";
const ownerToken = "owner-token-for-tests-0123456789abcdef";
const issuer = "https://id.example.test/realms/draft-loop";
const audience = "draft-loop-api";
const budgetCeiling = { maxRounds: 3, maxCostUsd: 3, maxDurationMs: 1_800_000 };
const tenantId = "org-erasure";
const career =
  "# Experience\n\n## Platform Engineer, Example Ledger (2020-2024)\n\nBuilt TypeScript services with deterministic testing.\n";

const people = ["owner", "coach"] as const;
type Person = (typeof people)[number];
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** The tenant's own rows, which outlive any one record. */
const tenantWideTables = new Set([
  "schema_migrations",
  "organisations",
  "organisation_members",
  "candidate_knowledge_stores",
]);

function runtimeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.username = runtimeRole;
  parsed.password = runtimeRole;
  return parsed.toString();
}

/** Objects by key, as a bucket keeps them, with erasure's unconditional removal. */
function memoryBucket() {
  const objects = new Map<string, Uint8Array>();
  const sha256 = (content: Uint8Array) => createHash("sha256").update(content).digest("hex");
  const blobs: BlobStoragePort = {
    put: async (location, content) => {
      objects.set(location, content);
      return { location, checksum: sha256(content), sizeBytes: content.byteLength };
    },
    get: async (reference) => {
      const content = objects.get(reference.location);
      return content !== undefined && sha256(content) === reference.checksum ? content : undefined;
    },
    exists: async (reference) => objects.has(reference.location),
    delete: async (reference) => objects.delete(reference.location),
  };
  const erasure: BlobErasure = { removeObject: async (key) => objects.delete(key) };
  return { objects, blobs, erasure };
}

describe.runIf(connectionString !== undefined)("candidate record erasure through the API", () => {
  const url = connectionString ?? "";
  const schema = `erasure_${randomUUID().replaceAll("-", "")}`;
  const admin = createSqlClient({ connectionString: url, schema, maxConnections: 1 });
  const tokens = {} as Record<Person, string>;
  const bucket = memoryBucket();
  /** Fails the next erase after its objects are deleted, as a lost connection would. */
  const interruption = { next: false };
  let tenancy: PostgresTenancy;
  let directory: PostgresTenantDirectory;
  let app: FastifyInstance;

  const call = async (person: Person, method: Method, path: string, payload?: object) => {
    const response = await app.inject({
      method,
      url: path,
      headers: { authorization: `Bearer ${tokens[person]}`, "idempotency-key": randomUUID() },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
    const body = response.body === "" ? null : response.json();
    return { status: response.statusCode, body, code: body?.error?.code as string | undefined };
  };

  /** Every row of every table but the tenant-wide ones, as sorted JSON text per table. */
  const snapshot = async () => {
    const tables = await admin.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename",
      [schema],
    );
    const rows: Record<string, string[]> = {};
    for (const { tablename } of tables) {
      if (tenantWideTables.has(String(tablename))) continue;
      const found = await admin.query(`SELECT to_jsonb(t)::text AS row FROM ${tablename} t`);
      rows[String(tablename)] = found.map((row) => String(row.row)).sort();
    }
    return rows;
  };

  /** A record with an owned base, an uploaded source, consent and a begun run. */
  const prepareRecord = async (id: string) => {
    expect((await call("coach", "PUT", `/v1/workspaces/${id}`, { fixtureMode: true })).status).toBe(
      201,
    );
    const consent = async (kind: string, providers?: string[]) =>
      expect(
        (
          await call("coach", "POST", `/v1/workspaces/${id}/consents`, {
            kind,
            action: "granted",
            basis: kind === "material-storage" ? "contract" : "candidate-consent",
            ...(providers === undefined ? {} : { providers }),
          })
        ).status,
      ).toBe(201);
    const base = await call("coach", "POST", "/v1/knowledge-bases", {
      displayName: "Career material",
      workspaceId: id,
    });
    expect(base.status).toBe(201);
    await consent("material-storage");
    const uploaded = await app.inject({
      method: "POST",
      url: `/v1/knowledge-bases/${base.body.id as string}/sources?name=career.md`,
      headers: { authorization: `Bearer ${tokens.coach}`, "content-type": "text/markdown" },
      payload: `${career}\n${id}\n`,
    });
    expect(uploaded.statusCode).toBe(201);
    expect(
      (
        await call("coach", "PUT", `/v1/workspaces/${id}/knowledge-selection`, {
          knowledgeBaseIds: [base.body.id],
        })
      ).status,
    ).toBe(200);
    const created = await call("coach", "POST", `/v1/workspaces/${id}/opportunities`, {
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
    const reviewed = await call("coach", "POST", `${briefPath}/review`, {
      expectedVersion: edited.body.brief.version,
    });
    expect(reviewed.status).toBe(200);
    await consent("provider-transmission", ["anthropic", "openai"]);
    const begun = await call("coach", "POST", `/v1/workspaces/${id}/runs`, {
      opportunityBrief: { briefId: reviewed.body.brief.id, version: reviewed.body.brief.version },
    });
    expect(begun.status).toBe(201);
    return `/v1/workspaces/${id}/runs/${begun.body.runId as string}`;
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
    tenancy = await openPostgresTenancy({ connectionString: runtimeUrl(url), schema });
    directory = await createPostgresTenantDirectory({ connectionString: runtimeUrl(url), schema });

    const email = (person: Person) => `${person}@erasure.example.test`;
    await directory.createOrganisation({
      organisationId: tenantId,
      name: "Example Erasure Coaching",
      firstOwnerEmail: email("owner"),
    });
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
      directory,
      tenants: {
        budgetCeiling,
        recordAccessFor: (id) => tenancy.forTenant(id).candidateRecords,
        knowledgeOwnersFor: (id) => tenancy.forTenant(id).knowledgeBaseOwners,
        erasureFor: (id) => {
          const records = tenancy.forTenant(id).recordErasure;
          return {
            records: {
              ...records,
              erase: async (workspaceId) => {
                if (interruption.next) {
                  interruption.next = false;
                  throw new Error("connection lost");
                }
                return records.erase(workspaceId);
              },
            },
            blobs: bucket.erasure,
          };
        },
        applicationFor: (id) =>
          composeHostedApplication({
            storage: tenancy.forTenant(id),
            blobs: bucket.blobs,
            tenantId: id,
            budgetCeiling,
            enqueueRun: async () => undefined,
            knowledgeLocation: (versionId) => hostedKnowledgeLocation(id, versionId),
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
  });

  it("erases a stopped record's objects and rows, finishing an interrupted erasure", async () => {
    // Both people sign in, and another record exists, before the baseline.
    for (const person of people) expect((await call(person, "GET", "/v1/me")).status).toBe(200);
    await prepareRecord("r-kept");
    const before = await snapshot();
    const keptObjects = [...bucket.objects.keys()];

    const runPath = await prepareRecord("r-gone");
    expect(bucket.objects.size).toBe(keptObjects.length + 1);
    const erase = (person: Person, confirm = "r-gone") =>
      call(person, "DELETE", "/v1/workspaces/r-gone", { confirm });

    // The begun run is queued: the caller stops it first.
    expect(await erase("owner")).toMatchObject({ status: 409, code: "run_active" });
    expect((await call("owner", "GET", "/v1/workspaces/r-gone")).status).toBe(200);
    expect((await erase("coach")).code).toBe("forbidden");
    expect((await erase("owner", "r-kept")).code).toBe("confirmation_mismatch");
    expect((await call("coach", "POST", `${runPath}/pause`, {})).status).toBe(200);

    // Interrupted after the objects were deleted: the record is closed to every route.
    interruption.next = true;
    expect((await erase("owner")).status).toBe(500);
    expect([...bucket.objects.keys()]).toEqual(keptObjects);
    expect(await call("owner", "GET", "/v1/workspaces/r-gone")).toMatchObject({
      status: 404,
      code: "not_found",
    });
    expect((await call("coach", "GET", `${runPath}`)).status).toBe(404);
    expect((await call("owner", "GET", "/v1/workspaces")).body).toEqual({
      workspaces: [{ id: "r-kept" }],
    });

    // Calling again finishes it; then the record is simply gone.
    expect((await erase("owner")).status).toBe(204);
    expect(await snapshot()).toEqual(before);
    expect([...bucket.objects.keys()]).toEqual(keptObjects);
    expect(await erase("owner")).toMatchObject({ status: 404, code: "not_found" });
    expect((await call("owner", "GET", "/v1/workspaces/r-kept")).status).toBe(200);
  }, 60_000);
});
