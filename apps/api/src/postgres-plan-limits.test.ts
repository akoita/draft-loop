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
import {
  composeHostedApplication,
  hostedEntitlementsFor,
  hostedKnowledgeLocation,
} from "./hosted-application.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const runtimeRole = "draft_loop_test_app";
const issuer = "https://id.example.test/realms/draft-loop";
const audience = "draft-loop-api";
const budgetCeiling = { maxRounds: 3, maxCostUsd: 3, maxDurationMs: 1_800_000 };

/** One owner signs in per organisation: one with a small plan, one with no plan at all. */
const organisations = { "org-small": "small-owner", "org-bare": "bare-owner" } as const;
type OrganisationId = keyof typeof organisations;
type Method = "GET" | "POST" | "PUT" | "DELETE";

function runtimeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.username = runtimeRole;
  parsed.password = runtimeRole;
  return parsed.toString();
}

describe.runIf(connectionString !== undefined)(
  "seats and candidate records against the plan",
  () => {
    const url = connectionString ?? "";
    const schema = `limits_${randomUUID().replaceAll("-", "")}`;
    const admin = createSqlClient({ connectionString: url, maxConnections: 1 });
    const tokens = {} as Record<OrganisationId, string>;
    let tenancy: PostgresTenancy;
    let directory: PostgresTenantDirectory;
    let app: FastifyInstance;

    const call = async (
      organisation: OrganisationId,
      method: Method,
      path: string,
      payload?: object,
    ) => {
      const response = await app.inject({
        method,
        url: path,
        headers: { authorization: `Bearer ${tokens[organisation]}` },
        ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
      });
      const body = response.body === "" ? null : response.json();
      return { status: response.statusCode, body, error: body?.error };
    };
    const invite = (organisation: OrganisationId, email: string) =>
      call(organisation, "POST", "/v1/organisation/members", { email, role: "member" });
    const members = async (organisation: OrganisationId) =>
      (await call(organisation, "GET", "/v1/organisation/members")).body.members as {
        memberId: string;
        email: string;
      }[];
    const createRecord = (organisation: OrganisationId, id: string) =>
      call(organisation, "PUT", `/v1/workspaces/${id}`, { fixtureMode: true });

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
      directory = await createPostgresTenantDirectory({
        connectionString: runtimeUrl(url),
        schema,
      });

      const signingKey = await generateKeyPair("ES256");
      const publicJwk = { ...(await exportJWK(signingKey.publicKey)), kid: "key-1", alg: "ES256" };
      for (const [organisationId, subject] of Object.entries(organisations)) {
        await directory.createOrganisation({
          organisationId,
          name: `Example ${organisationId}`,
          firstOwnerEmail: `${subject}@limits.example.test`,
        });
        tokens[organisationId as OrganisationId] = await new SignJWT({
          email: `${subject}@limits.example.test`,
          email_verified: true,
        })
          .setProtectedHeader({ alg: "ES256", kid: "key-1" })
          .setIssuer(issuer)
          .setAudience(audience)
          .setSubject(subject)
          .setExpirationTime("5m")
          .sign(signingKey.privateKey);
      }
      // Three seats and two records; the owner already takes one seat.
      await tenancy.forTenant("org-small").organisationPlans.assignPlan({
        planId: "pro",
        overrides: { seats: 3, candidateRecords: 2 },
        periodStart: "2026-01-01",
        assignedAt: "2026-01-01T00:00:00.000Z",
      });

      const blobs = createFilesystemBlobStorage();
      app = await buildApi({
        ownerToken: "owner-token-for-tests-0123456789abcdef",
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
          entitlementsFor: hostedEntitlementsFor(tenancy),
          knowledgeOwnersFor: (id) => tenancy.forTenant(id).knowledgeBaseOwners,
          erasureFor: (id) => ({
            records: tenancy.forTenant(id).recordErasure,
            blobs: { removeObject: async () => false, removePrefix: async () => 0 },
            organisation: tenancy.forTenant(id).organisationErasure,
            objectPrefix: `tenants/${id}/`,
          }),
          applicationFor: (id) =>
            composeHostedApplication({
              storage: tenancy.forTenant(id),
              blobs,
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

    it("counts active and invited members against the seats, and frees a seat on removal", async () => {
      // The owner is invited, then active on first sign-in: either way one seat.
      expect((await call("org-small", "GET", "/v1/me")).status).toBe(200);
      expect((await invite("org-small", "first@limits.example.test")).status).toBe(201);
      expect((await invite("org-small", "second@limits.example.test")).status).toBe(201);

      const full = await invite("org-small", "third@limits.example.test");
      expect(full.status).toBe(409);
      expect(full.error).toMatchObject({ code: "plan_limit_reached", limit: "seats", value: 3 });
      expect(JSON.stringify(full.body)).not.toContain("third@");
      expect(await members("org-small")).toHaveLength(3);

      // An email already invited is refused as such and takes no seat, full or not.
      const again = await invite("org-small", "first@limits.example.test");
      expect(again.status).toBe(409);
      expect(again.error.code).toBe("member_exists");

      const second = (await members("org-small")).find(
        (member) => member.email === "second@limits.example.test",
      );
      expect(
        (await call("org-small", "DELETE", `/v1/organisation/members/${second?.memberId}`)).status,
      ).toBe(204);
      expect((await invite("org-small", "third@limits.example.test")).status).toBe(201);
      expect(await members("org-small")).toHaveLength(3);
    });

    it("lets only the seats that are left through when invitations race", async () => {
      const [first] = (await members("org-small")).filter((member) =>
        member.email.startsWith("first"),
      );
      expect(
        (await call("org-small", "DELETE", `/v1/organisation/members/${first?.memberId}`)).status,
      ).toBe(204);

      const outcomes = await Promise.all(
        ["racer-a", "racer-b", "racer-c"].map((name) =>
          invite("org-small", `${name}@limits.example.test`),
        ),
      );

      expect(outcomes.map(({ status }) => status).sort()).toEqual([201, 409, 409]);
      for (const refused of outcomes.filter(({ status }) => status === 409)) {
        expect(refused.error).toMatchObject({ code: "plan_limit_reached", limit: "seats" });
      }
      expect(await members("org-small")).toHaveLength(3);
    });

    it("holds candidate records to the plan, and an erased record frees its slot", async () => {
      expect((await createRecord("org-small", "r1")).status).toBe(201);
      expect((await createRecord("org-small", "r2")).status).toBe(201);

      const full = await createRecord("org-small", "r3");
      expect(full.status).toBe(409);
      expect(full.error).toMatchObject({
        code: "plan_limit_reached",
        limit: "candidateRecords",
        value: 2,
      });
      // The refused creator keeps no claim on the record, and nothing was saved for it.
      expect((await call("org-small", "GET", "/v1/workspaces")).body).toEqual({
        workspaces: [{ id: "r1" }, { id: "r2" }],
      });
      // An existing record is not created again, full or not.
      expect((await createRecord("org-small", "r1")).error.code).toBe("workspace_exists");

      expect(
        (await call("org-small", "DELETE", "/v1/workspaces/r1", { confirm: "r1" })).status,
      ).toBe(204);
      expect((await createRecord("org-small", "r3")).status).toBe(201);
      expect((await createRecord("org-small", "r4")).error.code).toBe("plan_limit_reached");
    });

    it("refuses an organisation without a plan both ways", async () => {
      const seat = await invite("org-bare", "someone@limits.example.test");
      expect(seat.status).toBe(403);
      expect(seat.error.code).toBe("plan_required");
      const record = await createRecord("org-bare", "r1");
      expect(record.status).toBe(403);
      expect(record.error.code).toBe("plan_required");
      expect((await call("org-bare", "GET", "/v1/workspaces")).body).toEqual({ workspaces: [] });
    });
  },
);
