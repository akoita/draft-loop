import { randomUUID } from "node:crypto";
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

/** The fictional organisation's people, each signing in with a verified email. */
const people = ["owner", "admin", "coach-1", "coach-2"] as const;
type Person = (typeof people)[number];

function runtimeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.username = runtimeRole;
  parsed.password = runtimeRole;
  return parsed.toString();
}

describe.runIf(connectionString !== undefined)("candidate record access through the API", () => {
  const url = connectionString ?? "";
  const schema = `records_${randomUUID().replaceAll("-", "")}`;
  const admin = createSqlClient({ connectionString: url, maxConnections: 1 });
  const tokens = {} as Record<Person, string>;
  const memberIds = {} as Record<Person, string>;
  let tenancy: PostgresTenancy;
  let directory: PostgresTenantDirectory;
  let tenants: TenantApplications;
  let signIn: ApiAuthOptions;
  let app: FastifyInstance;

  const call = async (
    person: Person,
    method: "GET" | "PUT" | "DELETE",
    path: string,
    payload?: object,
  ) => {
    const response = await app.inject({
      method,
      url: path,
      headers: { authorization: `Bearer ${tokens[person]}` },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
    return { status: response.statusCode, body: response.body === "" ? null : response.json() };
  };
  const listed = async (person: Person) =>
    (await call(person, "GET", "/v1/workspaces")).body.workspaces.map(
      (workspace: { id: string }) => workspace.id,
    );

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

    const email = (person: Person) => `${person}@coaching.example.test`;
    const created = await directory.createOrganisation({
      organisationId: tenantId,
      name: "Example Coaching",
      firstOwnerEmail: email("owner"),
    });
    memberIds.owner = created.firstOwner.memberId;
    for (const [person, role] of [
      ["admin", "admin"],
      ["coach-1", "member"],
      ["coach-2", "member"],
    ] as const) {
      memberIds[person] = (
        await directory.inviteMember({ organisationId: tenantId, email: email(person), role })
      ).memberId;
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
          knowledgeLocation: (versionId) => `unused/${versionId}`,
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
    app = await buildApi({ ownerToken, auth: signIn, tenants, directory });
  });

  afterAll(async () => {
    await app?.close();
    await directory?.close();
    await tenancy?.close();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.close();
  });

  it("lets each member reach only their records, and the owner and admin every record", async () => {
    expect((await call("coach-1", "PUT", "/v1/workspaces/r1", { fixtureMode: true })).status).toBe(
      201,
    );
    expect((await call("coach-2", "PUT", "/v1/workspaces/r2", { fixtureMode: true })).status).toBe(
      201,
    );
    // Each creator is assigned to the record they created.
    const records = tenancy.forTenant(tenantId).candidateRecords;
    expect((await records.listRecordMembers("r1")).map(({ memberId }) => memberId)).toEqual([
      memberIds["coach-1"],
    ]);

    expect(await listed("coach-1")).toEqual(["r1"]);
    expect(await listed("coach-2")).toEqual(["r2"]);
    expect(await listed("owner")).toEqual(["r1", "r2"]);
    expect(await listed("admin")).toEqual(["r1", "r2"]);

    // Another member's record answers exactly as a workspace that does not exist.
    const routes: ["GET" | "PUT", string, object?][] = [
      ["GET", ""],
      ["GET", "/writing-policy"],
      ["PUT", "/writing-policy", { content: "# Policy\n\nOne sentence per bullet." }],
      ["GET", "/applications"],
      ["GET", "/opportunities/brief-0000000000000-00000000"],
    ];
    for (const [person, own, other] of [
      ["coach-1", "r1", "r2"],
      ["coach-2", "r2", "r1"],
    ] as const) {
      for (const [method, suffix, payload] of routes) {
        const refused = await call(person, method, `/v1/workspaces/${other}${suffix}`, payload);
        expect({ route: `${method} ${suffix}`, ...refused }).toEqual({
          route: `${method} ${suffix}`,
          status: 404,
          body: { error: { code: "not_found", message: "No such workspace." } },
        });
      }
      expect((await call(person, "GET", `/v1/workspaces/${own}`)).status).toBe(200);
    }
    const unknown = await call("owner", "GET", "/v1/workspaces/never-created");
    expect(unknown).toEqual({
      status: 404,
      body: { error: { code: "not_found", message: "No such workspace." } },
    });
    // Creating over another member's record is refused as unknown too, never as a conflict.
    expect((await call("coach-1", "PUT", "/v1/workspaces/r2", { fixtureMode: true })).status).toBe(
      404,
    );

    for (const person of ["owner", "admin"] as const) {
      for (const id of ["r1", "r2"]) {
        expect((await call(person, "GET", `/v1/workspaces/${id}`)).status).toBe(200);
        expect((await call(person, "GET", `/v1/workspaces/${id}/applications`)).status).toBe(200);
      }
    }

    // The owner's own record lists the owner as its member, and stays out of the members' reach.
    expect((await call("owner", "PUT", "/v1/workspaces/r3", { fixtureMode: true })).status).toBe(
      201,
    );
    expect((await records.listRecordMembers("r3")).map(({ memberId }) => memberId)).toEqual([
      memberIds.owner,
    ]);
    expect((await call("coach-1", "GET", "/v1/workspaces/r3")).status).toBe(404);
    expect(await listed("owner")).toEqual(["r1", "r2", "r3"]);

    // Assigning a member opens the record to them.
    await records.assignMember({ workspaceId: "r2", memberId: memberIds["coach-1"] });
    expect((await call("coach-1", "GET", "/v1/workspaces/r2")).status).toBe(200);
    expect(await listed("coach-1")).toEqual(["r1", "r2"]);
  });

  it("opens a record to an assigned member and closes it at once on removal", async () => {
    const path = `/v1/workspaces/r1/members/${memberIds["coach-2"]}`;
    expect((await call("coach-2", "GET", "/v1/workspaces/r1")).status).toBe(404);
    expect((await call("coach-1", "PUT", path)).status).toBe(403);

    const assigned = await call("admin", "PUT", path);
    expect(assigned).toMatchObject({
      status: 200,
      body: { workspaceId: "r1", memberId: memberIds["coach-2"], role: "member" },
    });
    expect((await call("coach-2", "GET", "/v1/workspaces/r1")).status).toBe(200);
    const listed = await call("coach-2", "GET", "/v1/workspaces/r1/members");
    expect(listed.body.members.map(({ email }: { email: string }) => email)).toEqual([
      "coach-1@coaching.example.test",
      "coach-2@coaching.example.test",
    ]);
    expect((await call("owner", "PUT", "/v1/workspaces/r1/members/no-such-member")).body).toEqual({
      error: { code: "member_not_found", message: "The organisation has no such member." },
    });

    expect((await call("owner", "DELETE", path)).status).toBe(204);
    expect((await call("coach-2", "GET", "/v1/workspaces/r1")).status).toBe(404);
    expect((await call("coach-2", "GET", "/v1/workspaces/r1/members")).status).toBe(404);
    expect((await call("owner", "DELETE", path)).status).toBe(404);
  });

  it("leaves owner-token mode reaching and listing every workspace of its tenant", async () => {
    const owner = await buildApi({
      ownerToken,
      tenants: { ...tenants, ownerTenantId: tenantId },
    });
    try {
      const get = async (path: string) => {
        const response = await owner.inject({
          method: "GET",
          url: path,
          headers: { authorization: `Bearer ${ownerToken}` },
        });
        return { status: response.statusCode, body: response.json() };
      };
      expect((await get("/v1/workspaces")).body).toEqual({
        workspaces: [{ id: "r1" }, { id: "r2" }, { id: "r3" }],
      });
      expect((await get("/v1/workspaces/r1")).status).toBe(200);
    } finally {
      await owner.close();
    }
  });

  it("refuses to serve workspaces in sign-in mode without record access", async () => {
    const { recordAccessFor: _omitted, ...withoutAccess } = tenants;
    await expect(buildApi({ ownerToken, auth: signIn, tenants: withoutAccess })).rejects.toThrow(
      /record access/u,
    );
  });
});
