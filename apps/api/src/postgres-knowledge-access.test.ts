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
import type { ApiAuthOptions } from "./request-auth.js";
import type { TenantApplications } from "./tenant-context.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const runtimeRole = "draft_loop_test_app";
const ownerToken = "owner-token-for-tests-0123456789abcdef";
const issuer = "https://id.example.test/realms/draft-loop";
const audience = "draft-loop-api";
const budgetCeiling = { maxRounds: 3, maxCostUsd: 3, maxDurationMs: 1_800_000 };
const tenantId = "org-coaching";
const career =
  "# Experience\n\n## Platform Engineer, Example Ledger (2020-2024)\n\nBuilt TypeScript services with deterministic testing.\n";

/** The fictional organisation's people, each signing in with a verified email. */
const people = ["owner", "admin", "coach-1", "coach-2"] as const;
type Person = (typeof people)[number];
type Method = "GET" | "POST" | "PUT" | "DELETE";

const unknownBase = {
  status: 404,
  body: { error: { code: "knowledge_base_not_found", message: "No such knowledge base." } },
};
const unknownWorkspace = {
  status: 404,
  body: { error: { code: "not_found", message: "No such workspace." } },
};

function runtimeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.username = runtimeRole;
  parsed.password = runtimeRole;
  return parsed.toString();
}

describe.runIf(connectionString !== undefined)("knowledge base access through the API", () => {
  const url = connectionString ?? "";
  const schema = `knowledge_${randomUUID().replaceAll("-", "")}`;
  const admin = createSqlClient({ connectionString: url, maxConnections: 1 });
  const tokens = {} as Record<Person, string>;
  let blobRoot: string;
  let tenancy: PostgresTenancy;
  let directory: PostgresTenantDirectory;
  let tenants: TenantApplications;
  let signIn: ApiAuthOptions;
  let app: FastifyInstance;

  const call = async (person: Person, method: Method, path: string, payload?: object) => {
    const response = await app.inject({
      method,
      url: path,
      headers: { authorization: `Bearer ${tokens[person]}` },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
    return { status: response.statusCode, body: response.json() };
  };
  const upload = async (person: Person, knowledgeBaseId: string) => {
    const response = await app.inject({
      method: "POST",
      url: `/v1/knowledge-bases/${knowledgeBaseId}/sources?name=career.md`,
      headers: { authorization: `Bearer ${tokens[person]}`, "content-type": "text/markdown" },
      payload: career,
    });
    return { status: response.statusCode, body: response.json() };
  };
  const listed = async (person: Person, query = "") =>
    (await call(person, "GET", `/v1/knowledge-bases${query}`)).body.knowledgeBases.map(
      (base: { id: string }) => base.id,
    );
  const createBase = async (person: Person, workspaceId?: string) =>
    call(person, "POST", "/v1/knowledge-bases", {
      displayName: "Career material",
      ...(workspaceId === undefined ? {} : { workspaceId }),
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
    blobRoot = await mkdtemp(join(tmpdir(), "draft-loop-knowledge-access-"));
    tenancy = await openPostgresTenancy({ connectionString: runtimeUrl(url), schema });
    directory = await createPostgresTenantDirectory({ connectionString: runtimeUrl(url), schema });

    const email = (person: Person) => `${person}@coaching.example.test`;
    await directory.createOrganisation({
      organisationId: tenantId,
      name: "Example Coaching",
      firstOwnerEmail: email("owner"),
    });
    for (const [person, role] of [
      ["admin", "admin"],
      ["coach-1", "member"],
      ["coach-2", "member"],
    ] as const) {
      await directory.inviteMember({ organisationId: tenantId, email: email(person), role });
    }

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
      knowledgeOwnersFor: (id) => tenancy.forTenant(id).knowledgeBaseOwners,
      applicationFor: (id) =>
        composeHostedApplication({
          storage: tenancy.forTenant(id),
          blobs,
          tenantId: id,
          budgetCeiling,
          enqueueRun: async () => undefined,
          knowledgeLocation: (versionId) => join(blobRoot, id, "knowledge", versionId),
        }),
    };
    signIn = {
      mode: "oidc",
      issuer,
      audience,
      webClientId: "draft-loop-web",
      allowHttp: false,
      keys: createLocalJWKSet({ keys: [publicJwk] }),
      resolveSignIn: directory.resolveSignIn,
    };
    app = await buildApi({ ownerToken, auth: signIn, tenants });
  });

  afterAll(async () => {
    await app?.close();
    await directory?.close();
    await tenancy?.close();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.close();
    if (blobRoot !== undefined) await rm(blobRoot, { recursive: true, force: true });
  });

  it("confines each member to the bases their records own", async () => {
    expect((await call("coach-1", "PUT", "/v1/workspaces/r1", { fixtureMode: true })).status).toBe(
      201,
    );
    expect((await call("coach-2", "PUT", "/v1/workspaces/r2", { fixtureMode: true })).status).toBe(
      201,
    );

    // A base is created for a record the caller reaches, and only for one.
    const missing = await createBase("coach-1");
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe("invalid_request");
    expect(await createBase("coach-1", "r2")).toEqual(unknownWorkspace);
    expect(await createBase("coach-1", "never-created")).toEqual(unknownWorkspace);
    expect(await createBase("owner", "never-created")).toEqual(unknownWorkspace);
    const created = await createBase("coach-1", "r1");
    expect(created.status).toBe(201);
    const baseA: string = created.body.id;
    const baseB: string = (await createBase("coach-2", "r2")).body.id;
    expect(await tenancy.forTenant(tenantId).knowledgeBaseOwners.ownerOf(baseA)).toBe("r1");
    // Storing material needs each record's storage consent (#1622).
    for (const [person, workspaceId] of [
      ["coach-1", "r1"],
      ["coach-2", "r2"],
    ] as const) {
      const consent = await call(person, "POST", `/v1/workspaces/${workspaceId}/consents`, {
        kind: "material-storage",
        action: "granted",
        basis: "contract",
      });
      expect(consent.status).toBe(201);
    }
    expect((await upload("coach-1", baseA)).status).toBe(201);
    expect((await upload("coach-2", baseB)).status).toBe(201);

    // Listing follows the records: owners and admins see every base.
    expect(await listed("coach-1")).toEqual([baseA]);
    expect(await listed("coach-2")).toEqual([baseB]);
    expect((await listed("owner")).sort()).toEqual([baseA, baseB].sort());
    expect((await listed("admin")).sort()).toEqual([baseA, baseB].sort());
    expect(await listed("owner", "?workspaceId=r1")).toEqual([baseA]);
    expect(await listed("coach-1", "?workspaceId=r1")).toEqual([baseA]);
    expect(await listed("coach-1", "?workspaceId=r2")).toEqual([]);

    // Another record's base answers exactly as a base that does not exist.
    expect(await call("owner", "GET", "/v1/knowledge-bases/kb-never/sources")).toEqual(unknownBase);
    const rulesPath = `/v1/knowledge-bases/${baseA}/sensitivity-rules`;
    const rule = { tier: "never-share", match: { kind: "heading-contains", text: "Private" } };
    const refusals: [Method, string, object?][] = [
      ["GET", `/v1/knowledge-bases/${baseA}/sources`],
      ["GET", rulesPath],
      ["POST", rulesPath, rule],
      ["DELETE", `${rulesPath}/rule-1`],
    ];
    for (const [method, path, payload] of refusals) {
      expect({
        route: `${method} ${path}`,
        ...(await call("coach-2", method, path, payload)),
      }).toEqual({ route: `${method} ${path}`, ...unknownBase });
    }
    expect(await upload("coach-2", baseA)).toEqual(unknownBase);
    expect(
      await call("coach-2", "PUT", "/v1/workspaces/r2/knowledge-selection", {
        knowledgeBaseIds: [baseA],
      }),
    ).toEqual(unknownBase);

    // The owning record's member reaches its base, and the owner and admin reach every base.
    expect((await call("coach-1", "POST", rulesPath, rule)).status).toBe(201);
    for (const person of ["coach-1", "owner", "admin"] as const) {
      expect((await call(person, "GET", `/v1/knowledge-bases/${baseA}/sources`)).status).toBe(200);
      expect((await call(person, "GET", rulesPath)).status).toBe(200);
    }

    // A workspace selects only its own bases, whoever asks.
    const select = (person: Person, workspaceId: string, knowledgeBaseIds: string[]) =>
      call(person, "PUT", `/v1/workspaces/${workspaceId}/knowledge-selection`, {
        knowledgeBaseIds,
        combinationApproved: knowledgeBaseIds.length > 1,
      });
    expect(await select("owner", "r2", [baseA])).toEqual(unknownBase);
    expect(await select("owner", "r2", [baseB, baseA])).toEqual(unknownBase);
    expect((await select("coach-2", "r2", [baseB])).status).toBe(200);
    expect((await select("coach-1", "r1", [baseA])).status).toBe(200);
  });

  it("leaves owner-token mode with tenant-wide bases", async () => {
    const owner = await buildApi({ ownerToken, tenants: { ...tenants, ownerTenantId: tenantId } });
    try {
      const send = async (method: Method, path: string, payload?: object) => {
        const response = await owner.inject({
          method,
          url: path,
          headers: { authorization: `Bearer ${ownerToken}` },
          ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
        });
        return { status: response.statusCode, body: response.json() };
      };
      const created = await send("POST", "/v1/knowledge-bases", { displayName: "Shared notes" });
      expect(created.status).toBe(201);
      expect(
        await tenancy.forTenant(tenantId).knowledgeBaseOwners.ownerOf(created.body.id),
      ).toBeUndefined();
      // Every base of the tenant, whichever record owns it; the filter is ignored.
      const all = (await send("GET", "/v1/knowledge-bases?workspaceId=r1")).body.knowledgeBases;
      expect(all).toHaveLength(3);
      const baseA = (await listed("coach-1"))[0];
      expect(
        (await send("PUT", "/v1/workspaces/r2/knowledge-selection", { knowledgeBaseIds: [baseA] }))
          .status,
      ).toBe(200);
    } finally {
      await owner.close();
    }
  });

  it("removes a base whose owning record could not be recorded", async () => {
    const failing = new Error("owner write failed");
    const failingApp = await buildApi({
      ownerToken,
      auth: signIn,
      tenants: {
        ...tenants,
        knowledgeOwnersFor: (id) => ({
          ...tenancy.forTenant(id).knowledgeBaseOwners,
          setOwner: async () => {
            throw failing;
          },
        }),
      },
    });
    try {
      const before = await listed("owner");
      const refused = await failingApp.inject({
        method: "POST",
        url: "/v1/knowledge-bases",
        headers: { authorization: `Bearer ${tokens["coach-1"]}` },
        payload: { displayName: "Career material", workspaceId: "r1" },
      });
      expect(refused.statusCode).toBe(500);
      // No base is left that no member can reach.
      expect(await listed("owner")).toEqual(before);
    } finally {
      await failingApp.close();
    }
  });

  it("refuses to serve sign-in mode without knowledge base owners", async () => {
    const { knowledgeOwnersFor: _omitted, ...withoutOwners } = tenants;
    await expect(buildApi({ ownerToken, auth: signIn, tenants: withoutOwners })).rejects.toThrow(
      /owning records/u,
    );
  });
});
