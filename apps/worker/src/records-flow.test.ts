import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApi, composeHostedApplication, hostedKnowledgeLocation } from "@draft-loop/api";
import { createFilesystemBlobStorage } from "@draft-loop/storage/blobs";
import {
  createPostgresTenantDirectory,
  grantPostgresStorageAccess,
  migratePostgresStorage,
  openPostgresTenancy,
  type PostgresTenancy,
  type PostgresTenantDirectory,
} from "@draft-loop/storage-postgres";
import {
  type ApiClient,
  ApiRequestError,
  archiveRequest,
  assignableMembers,
  assignMemberRequest,
  canExportAndDelete,
  canManageMembers,
  createApiClient,
  createRecordMemory,
  currentRecordId,
  defaultWorkspaceForm,
  deleteRecordRequest,
  deleteRefusal,
  newRecordIdProblem,
  recordIds,
  unassignMemberRequest,
  withoutRecord,
  workspaceRequestBody,
} from "@draft-loop/web";
import type { FastifyInstance } from "fastify";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  filesystemBlobErasure,
  injectFetch,
  runtimeRole,
  runtimeUrl,
  tenantKeyBlobs,
} from "./hosted-test-support.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const issuer = "https://id.example.test/realms/draft-loop";
const audience = "draft-loop-api";
const budgetCeiling = { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 };
const organisationId = "org-alder";

/** A fictional organisation: its owner and one member the owner invites. */
const people = {
  owner: { subject: "person-ada", email: "ada@alder.example.test" },
  member: { subject: "person-cy", email: "cy@alder.example.test" },
} as const;
type Person = keyof typeof people;

const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: { status?: number }) => error.status,
  );

describe.runIf(connectionString !== undefined)("candidate records in the web screen", () => {
  const url = connectionString ?? "";
  const schema = `records_flow_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: url });
  const tokens: Partial<Record<Person, string>> = {};
  let blobRoot: string;
  let tenancy: PostgresTenancy;
  let directory: PostgresTenantDirectory;
  let api: FastifyInstance;

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
    blobRoot = await mkdtemp(join(tmpdir(), "draft-loop-records-flow-"));
    tenancy = await openPostgresTenancy({ connectionString: runtimeUrl(url), schema });
    directory = await createPostgresTenantDirectory({ connectionString: runtimeUrl(url), schema });

    const signingKey = await generateKeyPair("ES256");
    const publicJwk = { ...(await exportJWK(signingKey.publicKey)), kid: "key-1", alg: "ES256" };
    for (const person of ["owner", "member"] as const) {
      const { subject, email } = people[person];
      tokens[person] = await new SignJWT({ email, email_verified: true })
        .setProtectedHeader({ alg: "ES256", kid: "key-1" })
        .setIssuer(issuer)
        .setAudience(audience)
        .setSubject(subject)
        .setExpirationTime("10m")
        .sign(signingKey.privateKey);
    }
    const blobs = tenantKeyBlobs(blobRoot, createFilesystemBlobStorage());
    api = await buildApi({
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
        recordAccessFor: (tenantId) => tenancy.forTenant(tenantId).candidateRecords,
        knowledgeOwnersFor: (tenantId) => tenancy.forTenant(tenantId).knowledgeBaseOwners,
        erasureFor: (tenantId) => ({
          records: tenancy.forTenant(tenantId).recordErasure,
          blobs: filesystemBlobErasure(blobRoot, tenantId),
          organisation: tenancy.forTenant(tenantId).organisationErasure,
          objectPrefix: `tenants/${tenantId}/`,
        }),
        applicationFor: (tenantId) =>
          composeHostedApplication({
            storage: tenancy.forTenant(tenantId),
            blobs,
            tenantId,
            budgetCeiling,
            enqueueRun: async () => undefined,
            knowledgeLocation: (versionId) => hostedKnowledgeLocation(tenantId, versionId),
          }),
      },
    });
  });

  afterAll(async () => {
    await api?.close();
    await directory?.close();
    await tenancy?.close();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
    await rm(blobRoot, { recursive: true, force: true });
  });

  const clientFor = (person: Person): ApiClient => {
    const token = tokens[person];
    if (token === undefined) throw new Error("Tokens are signed before the test.");
    return createApiClient({ token, fetch: injectFetch(api) });
  };

  /** The records the person's picker lists. */
  const listed = async (person: Person) =>
    recordIds(await clientFor(person).call("GET /v1/workspaces", {}));

  it("lets an owner create records and assign a member, who then reaches only those", async () => {
    const operator = createApiClient({ token: ownerToken, fetch: injectFetch(api) });
    await operator.call("POST /v1/operator/organisations", {
      body: { organisationId, name: "Alder Coaching", firstOwnerEmail: people.owner.email },
    });
    const owner = clientFor("owner");
    expect(canManageMembers(await owner.call("GET /v1/me", {}))).toBe(true);
    const invited = await owner.call("POST /v1/organisation/members", {
      body: { email: people.member.email, role: "member" },
    });

    // The owner names two records in the picker and sets each up in the Workspace step.
    expect(await listed("owner")).toEqual([]);
    for (const recordId of ["candidate-ana", "candidate-ben"]) {
      expect(newRecordIdProblem(recordId, await listed("owner"))).toBeUndefined();
      await owner.call("PUT /v1/workspaces/{workspaceId}", {
        path: { workspaceId: recordId },
        body: workspaceRequestBody({ ...defaultWorkspaceForm, fixtureMode: true }),
      });
    }
    expect(newRecordIdProblem("candidate-ana", await listed("owner"))).toContain("exists already");
    const ownerRecords = await listed("owner");
    expect(ownerRecords).toEqual(["candidate-ana", "candidate-ben"]);
    const memory = createRecordMemory(() => undefined);
    memory.remember("candidate-ben");
    expect(currentRecordId(ownerRecords, memory.read())).toBe("candidate-ben");

    // The member signs in and reaches no record yet, and cannot assign anyone.
    const member = clientFor("member");
    const me = await member.call("GET /v1/me", {});
    expect(me).toMatchObject({ kind: "member", role: "member" });
    expect(canManageMembers(me)).toBe(false);
    expect(await listed("member")).toEqual([]);

    // The owner assigns the member to one record, choosing among the unassigned members.
    const { members: organisation } = await owner.call("GET /v1/organisation/members", {});
    const before = await owner.call("GET /v1/workspaces/{workspaceId}/members", {
      path: { workspaceId: "candidate-ben" },
    });
    expect(before.members.map((item) => item.email)).toEqual([people.owner.email]);
    const offered = assignableMembers(organisation, before.members);
    expect(offered.map((item) => item.memberId)).toEqual([invited.memberId]);
    await owner.call(
      "PUT /v1/workspaces/{workspaceId}/members/{memberId}",
      assignMemberRequest("candidate-ben", invited.memberId),
    );

    // The member's picker lists that record alone; the other answers as a missing one.
    expect(await listed("member")).toEqual(["candidate-ben"]);
    expect(currentRecordId(await listed("member"), "candidate-ana")).toBe("candidate-ben");
    const { members } = await member.call("GET /v1/workspaces/{workspaceId}/members", {
      path: { workspaceId: "candidate-ben" },
    });
    expect(members.map((item) => item.email)).toEqual([people.owner.email, people.member.email]);
    expect(
      await refusal(
        member.call("GET /v1/workspaces/{workspaceId}", { path: { workspaceId: "candidate-ana" } }),
      ),
    ).toBe(404);
    expect(
      await refusal(
        member.call(
          "DELETE /v1/workspaces/{workspaceId}/members/{memberId}",
          unassignMemberRequest("candidate-ben", invited.memberId),
        ),
      ),
    ).toBe(403);

    // A record the member creates is theirs; once removed from the other, it is gone from the list.
    await member.call("PUT /v1/workspaces/{workspaceId}", {
      path: { workspaceId: "candidate-cy" },
      body: workspaceRequestBody({ ...defaultWorkspaceForm, fixtureMode: true }),
    });
    await owner.call(
      "DELETE /v1/workspaces/{workspaceId}/members/{memberId}",
      unassignMemberRequest("candidate-ben", invited.memberId),
    );
    expect(await listed("member")).toEqual(["candidate-cy"]);
    expect(await listed("owner")).toEqual(["candidate-ana", "candidate-ben", "candidate-cy"]);
  }, 60_000);

  it("lets an owner export and delete a record, which a member can do neither of", async () => {
    // The first test left three records in the organisation; the member is assigned to none.
    const owner = clientFor("owner");
    const member = clientFor("member");
    expect(canExportAndDelete(await owner.call("GET /v1/me", {}))).toBe(true);
    expect(canExportAndDelete(await member.call("GET /v1/me", {}))).toBe(false);

    // Export everything: the archive is a zip, and only owners and admins download one.
    const archive = await owner.call(
      "GET /v1/workspaces/{workspaceId}/archive",
      archiveRequest("candidate-ana"),
    );
    expect(new TextDecoder().decode((await archive.arrayBuffer()).slice(0, 2))).toBe("PK");
    expect(
      await refusal(
        member.call("GET /v1/workspaces/{workspaceId}/archive", archiveRequest("candidate-cy")),
      ),
    ).toBe(403);

    // Delete record: a mistyped id never reaches the API; a member is refused.
    expect(deleteRecordRequest("candidate-ana", "candidate-ben")).toHaveProperty("problem");
    const confirmed = (recordId: string) => {
      const found = deleteRecordRequest(recordId, recordId);
      if ("problem" in found) throw new Error(found.problem);
      return found.request;
    };
    const refused = await member
      .call("DELETE /v1/workspaces/{workspaceId}", confirmed("candidate-cy"))
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(refused).toBeInstanceOf(ApiRequestError);
    expect(deleteRefusal(refused)).toContain("owners and admins");

    // The owner deletes it; the screen returns to the remaining records.
    const before = await listed("owner");
    await owner.call("DELETE /v1/workspaces/{workspaceId}", confirmed("candidate-ana"));
    expect(await listed("owner")).toEqual(withoutRecord(before, "candidate-ana"));
    expect(
      await refusal(
        owner.call("GET /v1/workspaces/{workspaceId}", { path: { workspaceId: "candidate-ana" } }),
      ),
    ).toBe(404);
  }, 60_000);
});
