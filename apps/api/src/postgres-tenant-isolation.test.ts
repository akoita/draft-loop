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
import { assignInternalPlan } from "./test-plan.js";

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
  let blobs: ReturnType<typeof createFilesystemBlobStorage>;
  let app: FastifyInstance;
  /** Organisation A's ids, kept by the first test for the route sweep (#2935). */
  const ofA: Record<string, string> = {};

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
      await assignInternalPlan(tenancy, organisationId);
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

    blobs = createFilesystemBlobStorage();
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
        entitlementsFor: hostedEntitlementsFor(tenancy),
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
    ofA.knowledgeBaseId = base.body.id as string;
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
    // A career profile, derived as the worker derives it, then read and reviewed through the API.
    const tenantA = composeHostedApplication({
      storage: tenancy.forTenant("org-a"),
      blobs,
      tenantId: "org-a",
      budgetCeiling,
      enqueueRun: async () => undefined,
      knowledgeLocation: (versionId) => join(blobRoot, "org-a", "knowledge", versionId),
    });
    await tenantA.service.deriveCanonicalCandidateProfile({
      root: tenantA.workspaceRoot("shared"),
      profileId: "career",
      allowProviderData: true,
    });
    const profilePath = "/v1/workspaces/shared/profiles/career";
    const profile = await asA("GET", profilePath);
    expect(profile.status).toBe(200);
    expect(profile.body.profile).toMatchObject({ id: "career", version: 1, status: "draft" });
    // The view names the workspace the client addressed, so the shared screens can check it.
    expect(profile.body.workspaceId).toBe("shared");
    expect((await asB("GET", profilePath)).status).toBe(404);
    expect((await asB("GET", "/v1/workspaces/shared/profiles")).body.versions).toEqual([]);
    expect((await asB("GET", "/v1/workspaces/a-only/profiles")).status).toBe(404);
    expect(
      (await asB("POST", `${profilePath}/review`, { expectedVersion: 1 })).body.error.code,
    ).toBe("not_found");
    // Open issues block a review until the person acknowledges them, as on the desktop.
    const openIssues = profile.body.profile.issues as { status: string }[];
    expect(openIssues.length).toBeGreaterThan(0);
    expect(
      (await asA("POST", `${profilePath}/review`, { expectedVersion: 1 })).body.error.code,
    ).toBe("profile_rule");
    const acknowledged = await asA("PATCH", profilePath, {
      expectedVersion: 1,
      patch: { issues: openIssues.map((issue) => ({ ...issue, status: "acknowledged" })) },
    });
    expect(acknowledged.status).toBe(200);
    expect(
      (await asB("PATCH", profilePath, { expectedVersion: 2, patch: { issues: [] } })).status,
    ).toBe(404);
    expect(
      (await asA("POST", `${profilePath}/review`, { expectedVersion: 1 })).body.error.code,
    ).toBe("profile_version_stale");
    const profileReview = await asA("POST", `${profilePath}/review`, { expectedVersion: 2 });
    expect(profileReview.status).toBe(200);
    expect(profileReview.body.profile).toMatchObject({ version: 3, status: "reviewed" });
    expect((await asA("GET", "/v1/workspaces/shared/profiles")).body.versions).toHaveLength(3);
    expect((await asA("GET", `${profilePath}/freshness`)).body).toEqual({
      state: "up-to-date",
      version: 3,
    });
    // This deployment queues no derivation, so a start says so rather than pretending.
    expect(
      (await asA("POST", `${profilePath}/derivation`, { providerDataApproved: true })).body.error
        .code,
    ).toBe("derivation_unavailable");

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
    ofA.briefId = briefId;
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
      candidateProfile: { profileId: "career", version: 3 },
    });
    expect(run.status).toBe(201);
    const runId = run.body.runId as string;
    ofA.runId = runId;
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
    ofA.applicationId = listedByA.body.applications[0].id as string;
    const listedByB = await asB("GET", "/v1/workspaces/shared/applications");
    expect(listedByB.status).toBe(200);
    for (const application of listedByB.body.applications) {
      expect(application.briefs).toEqual([]);
      expect(application.runs).toEqual([]);
    }
  });

  it("refuses every route organisation A's ids reach when B calls it (#2935)", async () => {
    // A named application of A's own, since every workspace has a "default" one.
    const named = await asA("POST", "/v1/workspaces/shared/applications", {
      name: "Sweep target at Example Ledger",
      jobText: "Platform Engineer at Example Ledger: build TypeScript services.",
    });
    expect(named.status).toBe(201);
    const applicationId = named.body.id as string;

    // The routes come from the API's own route table, so a new route is swept without an edit.
    const document = app.swagger() as { paths: Record<string, Record<string, unknown>> };
    const markers = [
      "Example Ledger",
      "Keep each bullet",
      "person-a@example.test",
      "org-a",
      ofA.knowledgeBaseId,
      ofA.briefId,
      ofA.runId,
      applicationId,
    ].filter((marker): marker is string => typeof marker === "string" && marker !== "");
    expect(markers).toHaveLength(8);
    const ids: Readonly<Record<string, string>> = {
      ...ofA,
      applicationId,
      opportunityId: ofA.briefId ?? "",
    };
    /**
     * Routes not called, each with its reason. Every other route is called by B with A's ids.
     */
    const notCalled: Readonly<Record<string, string>> = {
      "PUT /v1/workspaces/{workspaceId}":
        "Workspace ids are names within an organisation: B's PUT creates B's own workspace of that name, and the sweep would then reach that empty workspace instead of refusals.",
    };
    const problems: string[] = [];
    let swept = 0;
    for (const [template, operations] of Object.entries(document.paths)) {
      if (!template.startsWith("/v1/")) continue;
      const params = [...template.matchAll(/\{(\w+)\}/gu)].map((match) => match[1] ?? "");
      // Workspace and profile ids are names each organisation chooses for itself, so B may hold
      // its own of the same name. A path naming one of A's generated ids must refuse B outright.
      const namesAResource = params.some((name) => name !== "workspaceId" && name !== "profileId");
      for (const verb of Object.keys(operations)) {
        const method = verb.toUpperCase() as Parameters<typeof call>[1];
        if (notCalled[`${method} ${template}`] !== undefined) continue;
        // "a-only" is A's alone; "shared" exists in both, so A's ids below it must still refuse.
        for (const workspaceId of ["a-only", "shared"]) {
          if (workspaceId === "shared" && !namesAResource) continue;
          const path = template.replaceAll(/\{(\w+)\}/gu, (_, name: string) =>
            encodeURIComponent(
              name === "workspaceId"
                ? workspaceId
                : name === "profileId"
                  ? "career"
                  : (ids[name] ?? `${name}-of-org-a`),
            ),
          );
          const response = await app.inject({
            method,
            url: path,
            headers: {
              authorization: `Bearer ${tokens["person-b"]}`,
              "idempotency-key": `sweep-${String(swept).padStart(6, "0")}`,
            },
            ...(method === "GET" || method === "DELETE" ? {} : { payload: {} }),
          });
          swept += 1;
          const label = `${method} ${template} (${workspaceId})`;
          for (const marker of markers) {
            if (response.body.includes(marker)) problems.push(`${label} shows ${marker}`);
          }
          // A refusal of any kind shows nothing; a success or a crash on A's resource is a leak
          // or an unchecked path. Ids the sweep does not hold are refused by their schema (400).
          const status = response.statusCode;
          if (status >= 500 || (namesAResource && status < 400) || status === 401) {
            problems.push(`${label} answered ${status}: ${response.body.slice(0, 160)}`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
    expect(swept).toBeGreaterThan(100);

    // Nothing B sent changed A's data.
    expect((await asA("GET", `/v1/workspaces/shared/runs/${ofA.runId}`)).status).toBe(200);
    expect(
      (await asA("GET", `/v1/workspaces/shared/opportunities/${ofA.briefId}`)).body.brief.id,
    ).toBe(ofA.briefId);
    expect((await asA("GET", `/v1/workspaces/shared/applications/${applicationId}`)).status).toBe(
      200,
    );
    expect(
      (await asA("GET", `/v1/knowledge-bases/${ofA.knowledgeBaseId}/sources`)).body.sources,
    ).toHaveLength(1);
    expect((await asA("GET", "/v1/workspaces/a-only")).status).toBe(200);
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
