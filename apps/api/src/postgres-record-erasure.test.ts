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
const otherTenantId = "org-other";
const career =
  "# Experience\n\n## Platform Engineer, Example Ledger (2020-2024)\n\nBuilt TypeScript services with deterministic testing.\n";

/** Two people of the organisation, and the owner of another one. */
const people = ["owner", "coach", "other-owner"] as const;
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
  const erasure: BlobErasure = {
    removeObject: async (key) => objects.delete(key),
    removePrefix: async (keyPrefix) => {
      const keys = [...objects.keys()].filter((key) => key.startsWith(keyPrefix));
      for (const key of keys) objects.delete(key);
      return keys.length;
    },
  };
  return { objects, blobs, erasure };
}

describe.runIf(connectionString !== undefined)("candidate record erasure through the API", () => {
  const url = connectionString ?? "";
  const schema = `erasure_${randomUUID().replaceAll("-", "")}`;
  const admin = createSqlClient({ connectionString: url, schema, maxConnections: 1 });
  const tokens = {} as Record<Person, string>;
  const bucket = memoryBucket();
  /** Fails the next erase after its objects are deleted, as a lost connection would. */
  const interruption = { next: false, prefix: false };
  let tenancy: PostgresTenancy;
  let directory: PostgresTenantDirectory;
  let app: FastifyInstance;
  /** The kept record's run, still queued after the first test. */
  let keptRun: string;

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

  /** One tenant's rows in every table that names a tenant, as sorted JSON text per table. */
  const tenantRows = async (tenant: string) => {
    const tables = await admin.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = $1 AND (column_name = 'tenant_id'
         OR (table_name = 'organisations' AND column_name = 'id'))
       ORDER BY table_name`,
      [schema],
    );
    const rows: Record<string, string[]> = {};
    for (const { table_name: table, column_name: column } of tables) {
      const found = await admin.query(
        `SELECT to_jsonb(t)::text AS row FROM ${String(table)} t WHERE ${String(column)} = $1`,
        [tenant],
      );
      if (found.length > 0) rows[String(table)] = found.map((row) => String(row.row)).sort();
    }
    return rows;
  };
  const objectsOf = (tenant: string) =>
    [...bucket.objects.keys()].filter((key) => key.startsWith(`tenants/${tenant}/`)).sort();

  /** A record with an owned base, an uploaded source, consent and a begun run. */
  const prepareRecord = async (id: string, person: Person = "coach") => {
    expect((await call(person, "PUT", `/v1/workspaces/${id}`, { fixtureMode: true })).status).toBe(
      201,
    );
    const consent = async (kind: string, providers?: string[]) =>
      expect(
        (
          await call(person, "POST", `/v1/workspaces/${id}/consents`, {
            kind,
            action: "granted",
            basis: kind === "material-storage" ? "contract" : "candidate-consent",
            ...(providers === undefined ? {} : { providers }),
          })
        ).status,
      ).toBe(201);
    const base = await call(person, "POST", "/v1/knowledge-bases", {
      displayName: "Career material",
      workspaceId: id,
    });
    expect(base.status).toBe(201);
    await consent("material-storage");
    const uploaded = await app.inject({
      method: "POST",
      url: `/v1/knowledge-bases/${base.body.id as string}/sources?name=career.md`,
      headers: { authorization: `Bearer ${tokens[person]}`, "content-type": "text/markdown" },
      payload: `${career}\n${id}\n`,
    });
    expect(uploaded.statusCode).toBe(201);
    expect(
      (
        await call(person, "PUT", `/v1/workspaces/${id}/knowledge-selection`, {
          knowledgeBaseIds: [base.body.id],
        })
      ).status,
    ).toBe(200);
    const created = await call(person, "POST", `/v1/workspaces/${id}/opportunities`, {
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
    const edited = await call(person, "PATCH", briefPath, {
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
    const reviewed = await call(person, "POST", `${briefPath}/review`, {
      expectedVersion: edited.body.brief.version,
    });
    expect(reviewed.status).toBe(200);
    await consent("provider-transmission", ["anthropic", "openai"]);
    const begun = await call(person, "POST", `/v1/workspaces/${id}/runs`, {
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
    await directory.createOrganisation({
      organisationId: otherTenantId,
      name: "Example Other Coaching",
      firstOwnerEmail: email("other-owner"),
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
            blobs: {
              ...bucket.erasure,
              removePrefix: async (keyPrefix) => {
                if (interruption.prefix) {
                  interruption.prefix = false;
                  throw new Error("connection lost");
                }
                return bucket.erasure.removePrefix(keyPrefix);
              },
            },
            organisation: tenancy.forTenant(id).organisationErasure,
            objectPrefix: `tenants/${id}/`,
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
    keptRun = await prepareRecord("r-kept");
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

  it("deletes the owner's organisation, then the operator deletes another", async () => {
    // The first test left a record in this organisation; the other one gets its own.
    expect((await call("other-owner", "GET", "/v1/me")).status).toBe(200);
    const otherRun = await prepareRecord("r-other", "other-owner");
    expect((await call("other-owner", "POST", `${otherRun}/pause`, {})).status).toBe(200);
    const otherRows = await tenantRows(otherTenantId);
    const otherObjects = objectsOf(otherTenantId);
    expect(otherObjects).toHaveLength(1);
    // An object no row names, as an upload interrupted before its row, goes with the prefix.
    await bucket.blobs.put(`tenants/${tenantId}/knowledge/knowledge/orphan`, new Uint8Array([1]));
    expect(objectsOf(tenantId)).toHaveLength(2);

    const deleteOwn = (person: Person, confirm = tenantId) =>
      call(person, "DELETE", "/v1/organisation", { confirm });
    expect((await deleteOwn("coach")).code).toBe("forbidden");
    expect((await deleteOwn("owner", otherTenantId)).code).toBe("confirmation_mismatch");
    // The kept record's run is still queued: nothing is deleted until it stops.
    expect(await deleteOwn("owner")).toMatchObject({ status: 409, code: "run_active" });
    expect((await call("owner", "GET", "/v1/workspaces/r-kept")).status).toBe(200);
    expect((await call("coach", "POST", `${keptRun}/pause`, {})).status).toBe(200);

    // Interrupted after the records were erased: the organisation is closing, so a member can
    // neither create a record nor upload material meanwhile; the repeated delete finishes.
    interruption.prefix = true;
    expect((await deleteOwn("owner")).status).toBe(500);
    expect(
      await call("coach", "PUT", "/v1/workspaces/r-late", { fixtureMode: true }),
    ).toMatchObject({ status: 409, code: "organisation_closing" });
    const late = await app.inject({
      method: "POST",
      url: "/v1/knowledge-bases/any-base/sources?name=late.md",
      headers: { authorization: `Bearer ${tokens.owner}`, "content-type": "text/markdown" },
      payload: career,
    });
    expect(late.statusCode).toBe(409);
    expect(late.json().error.code).toBe("organisation_closing");
    expect((await call("owner", "GET", "/v1/workspaces")).code).toBe("organisation_closing");
    expect(objectsOf(tenantId)).toHaveLength(1);
    expect((await call("other-owner", "GET", "/v1/workspaces")).status).toBe(200);
    expect((await deleteOwn("owner")).status).toBe(204);

    expect(await tenantRows(tenantId)).toEqual({});
    expect(objectsOf(tenantId)).toEqual([]);
    expect(await tenantRows(otherTenantId)).toEqual(otherRows);
    expect(objectsOf(otherTenantId)).toEqual(otherObjects);
    // The people's sign-ins no longer reach any organisation.
    expect((await call("owner", "GET", "/v1/workspaces")).status).toBe(403);

    const operator = (organisationId: string) =>
      app.inject({
        method: "DELETE",
        url: `/v1/operator/organisations/${organisationId}`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { confirm: organisationId },
      });
    expect((await operator(otherTenantId)).statusCode).toBe(204);
    expect(await tenantRows(otherTenantId)).toEqual({});
    expect(bucket.objects.size).toBe(0);
    expect((await operator(otherTenantId)).statusCode).toBe(404);
  }, 60_000);
});
