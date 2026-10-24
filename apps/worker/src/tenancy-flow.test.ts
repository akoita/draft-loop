import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApi, composeHostedApplication, hostedKnowledgeLocation } from "@draft-loop/api";
import type { RunJob } from "@draft-loop/run-queue";
import { createFilesystemBlobStorage } from "@draft-loop/storage/blobs";
import {
  createPostgresTenantDirectory,
  grantPostgresStorageAccess,
  hostedWorkspaceReference,
  migratePostgresStorage,
  openPostgresTenancy,
  type PostgresTenancy,
  type PostgresTenantDirectory,
} from "@draft-loop/storage-postgres";
import {
  type ApiClient,
  approveRequest,
  briefEdit,
  briefPatchBody,
  createApiClient,
  createBriefBody,
  defaultWorkspaceForm,
  exportRequestBody,
  ownerWorkspaceId,
  selectionRequest,
  startRunBody,
  workspaceRequestBody,
} from "@draft-loop/web";
import type { FastifyInstance } from "fastify";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { scriptedGateway } from "./gateway-test-support.js";
import { injectFetch, runtimeRole, runtimeUrl, tenantKeyBlobs } from "./hosted-test-support.js";
import { readModelGatewayConfig, workerProviderOptions } from "./model-routes.js";
import {
  createRunJobHandler,
  type QuarantinedRunInput,
  type RunJobOutcome,
} from "./run-job-handler.js";
import { tenantRunQuarantine } from "./tenant-quarantine.js";
import { tenantRunConsent, tenantServices } from "./tenant-services.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const issuer = "https://id.example.test/realms/draft-loop";
const audience = "draft-loop-api";
const budgetCeiling = { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 };
const gatewayEnv = {
  DRAFT_LOOP_VERTEX_PROJECT_ID: "synthetic-project",
  DRAFT_LOOP_VERTEX_LOCATION: "eu",
  DRAFT_LOOP_VERTEX_PRICE_FACTOR: "1.1",
  DRAFT_LOOP_OPENAI_KEY_SECRET: "projects/synthetic/secrets/openai-key/versions/1",
};

/**
 * Two fictional organisations, each with one owner and career material carrying a marker that is
 * not hexadecimal, so no id or checksum can contain it by chance.
 */
const organisations = {
  a: {
    organisationId: "org-alder",
    name: "Alder Coaching",
    subject: "person-ada",
    email: "ada@alder.example.test",
    marker: "alder-quill",
    employer: "Example Ledger",
  },
  b: {
    organisationId: "org-birch",
    name: "Birch Careers",
    subject: "person-ben",
    email: "ben@birch.example.test",
    marker: "birch-otter",
    employer: "Example Harbour",
  },
} as const;
type Side = keyof typeof organisations;

function careerFor(side: Side): string {
  const { marker, employer } = organisations[side];
  return [
    "# Experience",
    "",
    `## Platform Engineer, ${employer} (2020-2024)`,
    "",
    `Built TypeScript services with deterministic testing, codenamed ${marker}.`,
    "",
  ].join("\n");
}

describe.runIf(connectionString !== undefined)("two organisations on one deployment", () => {
  const url = connectionString ?? "";
  const schema = `tenancy_flow_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: url });
  const tokens: Partial<Record<Side, string>> = {};
  const queued: { tenantId: string; workspaceId: string; runId: string }[] = [];
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
    blobRoot = await mkdtemp(join(tmpdir(), "draft-loop-tenancy-flow-"));
    // The API and the worker share one pool for every tenant, as their containers do.
    tenancy = await openPostgresTenancy({ connectionString: runtimeUrl(url), schema });
    directory = await createPostgresTenantDirectory({
      connectionString: runtimeUrl(url),
      schema,
    });

    // The identity provider: one signing key, and a verified email in each member's token.
    const signingKey = await generateKeyPair("ES256");
    const publicJwk = { ...(await exportJWK(signingKey.publicKey)), kid: "key-1", alg: "ES256" };
    for (const side of ["a", "b"] as const) {
      const { subject, email } = organisations[side];
      tokens[side] = await new SignJWT({ email, email_verified: true })
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
        applicationFor: (tenantId) =>
          composeHostedApplication({
            storage: tenancy.forTenant(tenantId),
            blobs,
            tenantId,
            budgetCeiling,
            enqueueRun: async (workspaceId, runId) => {
              queued.push({ tenantId, workspaceId, runId });
            },
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

  const clientFor = (side: Side): ApiClient => {
    const token = tokens[side];
    if (token === undefined) throw new Error("Tokens are signed before the test.");
    return createApiClient({ token, fetch: injectFetch(api) });
  };

  const grantConsents = async (client: ApiClient) => {
    const path = { workspaceId: ownerWorkspaceId };
    await client.call("POST /v1/workspaces/{workspaceId}/consents", {
      path,
      body: { kind: "material-storage", action: "granted", basis: "contract" },
    });
    await client.call("POST /v1/workspaces/{workspaceId}/consents", {
      path,
      body: {
        kind: "provider-transmission",
        action: "granted",
        basis: "candidate-consent",
        providers: ["anthropic", "openai"],
      },
    });
  };

  /**
   * The worker as a sign-in deployment runs it, through the scripted gateway, which records every
   * request body so a test can check what each run sent; each job checks its record's consent and
   * its run's material for quarantine.
   */
  const signInWorker = () => {
    const gateway = scriptedGateway(gatewayEnv.DRAFT_LOOP_OPENAI_KEY_SECRET);
    const serviceFor = tenantServices({
      tenancy,
      blobsFor: () => tenantKeyBlobs(blobRoot, createFilesystemBlobStorage()),
      local: workerProviderOptions(readModelGatewayConfig(gatewayEnv), gateway.dependencies),
    });
    const outcomes: RunJobOutcome[] = [];
    const quarantined: QuarantinedRunInput[] = [];
    const workspaceRoot = (job: RunJob) => hostedWorkspaceReference(job.tenantId, job.workspaceId);
    const worker = createRunJobHandler({
      serviceFor: (job) => serviceFor(job.tenantId),
      workspaceRoot,
      allowProviderData: true,
      budgetCeiling,
      consentFor: tenantRunConsent({ tenancy, serviceFor, workspaceRoot }),
      quarantinedFor: tenantRunQuarantine({ tenancy, serviceFor, workspaceRoot }),
      onQuarantined: (_job, material) => quarantined.push(...material),
      onOutcome: (_job, outcome) => outcomes.push(outcome),
    });
    return { gateway, worker, outcomes, quarantined, serviceFor, workspaceRoot };
  };

  /** A fresh workspace with its consents and one uploaded, selected knowledge base. */
  const setUpWorkspace = async (side: Side) => {
    const client = clientFor(side);
    const workspace = { workspaceId: ownerWorkspaceId };
    await client.call("PUT /v1/workspaces/{workspaceId}", {
      path: workspace,
      body: workspaceRequestBody({
        ...defaultWorkspaceForm,
        authorModel: "claude-sonnet-5-5",
        criticModel: "gpt-6-luna",
      }),
    });
    // The candidate record's consents come before any material is stored or sent (#1622).
    await grantConsents(client);
    const base = await client.call("POST /v1/knowledge-bases", {
      body: { displayName: "Career material", workspaceId: ownerWorkspaceId },
    });
    await client.call("POST /v1/knowledge-bases/{knowledgeBaseId}/sources", {
      path: { knowledgeBaseId: base.id },
      query: { name: "career.md" },
      body: new Blob([careerFor(side)], { type: "text/markdown" }),
      contentType: "text/markdown",
    });
    const selection = selectionRequest([base.id], false);
    if ("problem" in selection) throw new Error(selection.problem);
    await client.call("PUT /v1/workspaces/{workspaceId}/knowledge-selection", {
      path: workspace,
      body: selection.body,
    });
    return base;
  };

  /** A reviewed brief and a queued run in a set-up workspace, as each organisation's owner does it. */
  const beginRun = async (side: Side) => {
    const client = clientFor(side);
    const workspace = { workspaceId: ownerWorkspaceId };
    const pasted = await client.call("POST /v1/workspaces/{workspaceId}/opportunities", {
      path: workspace,
      body: createBriefBody(
        `Platform Engineer at ${organisations[side].employer}: build TypeScript services.`,
        new Date(),
      ),
    });
    const briefPath = { ...workspace, briefId: pasted.brief.id };
    const edited = await client.call("PATCH /v1/workspaces/{workspaceId}/opportunities/{briefId}", {
      path: briefPath,
      body: briefPatchBody(pasted.brief, {
        ...briefEdit(pasted.brief),
        role: "Platform Engineer",
        requirements: [
          {
            id: "typescript-services",
            text: "Build TypeScript services with deterministic testing",
            priority: "critical",
            sourceIds: [pasted.brief.sources[0]?.id ?? "job-posting"],
          },
        ],
      }),
    });
    const reviewed = await client.call(
      "POST /v1/workspaces/{workspaceId}/opportunities/{briefId}/review",
      { path: briefPath, body: { expectedVersion: edited.brief.version } },
    );
    const begun = await client.call("POST /v1/workspaces/{workspaceId}/runs", {
      path: workspace,
      header: { "idempotency-key": randomUUID() },
      body: startRunBody(reviewed.brief),
    });
    return { client, runPath: { ...workspace, runId: begun.runId } };
  };

  it("takes two organisations from sign-up to an exported CV with nothing crossing", async () => {
    // The operator creates both organisations; each first owner joins on their first sign-in.
    const operator = createApiClient({ token: ownerToken, fetch: injectFetch(api) });
    for (const side of ["a", "b"] as const) {
      const { organisationId, name, email } = organisations[side];
      await operator.call("POST /v1/operator/organisations", {
        body: { organisationId, name, firstOwnerEmail: email },
      });
    }
    for (const side of ["a", "b"] as const) {
      const me = await clientFor(side).call("GET /v1/me", {});
      expect(me).toMatchObject({
        kind: "member",
        organisationId: organisations[side].organisationId,
        role: "owner",
      });
    }

    // Both organisations use the same workspace id; each gets its own workspace and run.
    await setUpWorkspace("a");
    const a = await beginRun("a");
    const bBase = await setUpWorkspace("b");
    const b = await beginRun("b");
    expect(queued.map((job) => job.tenantId)).toEqual([
      organisations.a.organisationId,
      organisations.b.organisationId,
    ]);

    // The worker runs each job in the tenant the job names.
    const { gateway, worker, outcomes } = signInWorker();
    const sentBy: Partial<Record<string, string>> = {};
    for (let job = queued.shift(); job !== undefined; job = queued.shift()) {
      const before = gateway.requestBodies.length;
      outcomes.length = 0;
      while (outcomes.at(-1) !== "settled" && outcomes.length < 10) {
        await worker(job, { requeue: async () => undefined });
      }
      sentBy[job.tenantId] = gateway.requestBodies.slice(before).join("\n");
    }
    const sentForA = sentBy[organisations.a.organisationId] ?? "";
    const sentForB = sentBy[organisations.b.organisationId] ?? "";
    expect(sentForA).toContain(organisations.a.marker);
    expect(sentForA).not.toContain(organisations.b.marker);
    expect(sentForB).toContain(organisations.b.marker);
    expect(sentForB).not.toContain(organisations.a.marker);

    // Each owner reviews, approves and exports their own draft.
    for (const [side, own, other] of [
      ["a", a, organisations.b],
      ["b", b, organisations.a],
    ] as const) {
      const review = await own.client.call("GET /v1/workspaces/{workspaceId}/runs/{runId}/review", {
        path: own.runPath,
      });
      expect(review.run.state).toBe("awaiting-approval");
      const approval = approveRequest(review, "Synthetic test run: the owner accepts the checks.");
      if ("problem" in approval) throw new Error(approval.problem);
      await own.client.call("POST /v1/workspaces/{workspaceId}/runs/{runId}/approve", {
        path: own.runPath,
        body: approval.body,
      });
      const exported = await own.client.call(
        "POST /v1/workspaces/{workspaceId}/runs/{runId}/exports",
        {
          path: own.runPath,
          header: { "idempotency-key": randomUUID() },
          body: exportRequestBody("markdown", "modern"),
        },
      );
      const document = await own.client.call(
        "GET /v1/workspaces/{workspaceId}/runs/{runId}/exports/{exportId}/content",
        { path: { ...own.runPath, exportId: exported.id } },
      );
      // The scripted models write the same draft for both, so this checks only what must not be.
      const text = await document.text();
      expect(text, side).toContain("## Experience");
      expect(text, side).not.toContain(other.employer);
      expect(text, side).not.toContain(other.marker);
    }

    // Neither owner reaches the other's run, knowledge base or members.
    // A run outside the caller's tenant answers as a run that was never begun.
    const intrusion = await clientFor("b")
      .call("GET /v1/workspaces/{workspaceId}/runs/{runId}/review", { path: a.runPath })
      .then(
        () => undefined,
        (error: { status?: number }) => error.status,
      );
    expect(intrusion).toBe(404);
    await expect(
      clientFor("a").call("GET /v1/knowledge-bases/{knowledgeBaseId}/sources", {
        path: { knowledgeBaseId: bBase.id },
      }),
    ).rejects.toMatchObject({ status: 404 });
    const { knowledgeBases } = await clientFor("b").call("GET /v1/knowledge-bases", {});
    expect(knowledgeBases.map((base) => base.id)).toEqual([bBase.id]);
    const { members } = await clientFor("a").call("GET /v1/organisation/members", {});
    expect(members.map((member) => member.email)).toEqual([organisations.a.email]);
  }, 180_000);

  it("stops a queued run whose consent was withdrawn before any provider call", async () => {
    // Organisation A, signed up by the first test, begins a second run, which is queued.
    const own = await beginRun("a");
    const job = queued.shift();
    expect(job).toMatchObject({
      tenantId: organisations.a.organisationId,
      runId: own.runPath.runId,
    });
    if (job === undefined) throw new Error("The run was queued.");
    const workspace = { workspaceId: ownerWorkspaceId };
    const transmission = (action: "granted" | "withdrawn") =>
      own.client.call("POST /v1/workspaces/{workspaceId}/consents", {
        path: workspace,
        body:
          action === "granted"
            ? {
                kind: "provider-transmission",
                action,
                basis: "candidate-consent",
                providers: ["anthropic", "openai"],
              }
            : { kind: "provider-transmission", action, basis: "candidate-consent" },
      });

    // The candidate withdraws while the job waits: the worker pauses the run and calls no model.
    await transmission("withdrawn");
    const { gateway, worker, outcomes } = signInWorker();
    await worker(job, { requeue: async () => undefined });
    expect(outcomes).toEqual(["consent-required"]);
    expect(gateway.requestBodies).toEqual([]);
    const held = await own.client.call("GET /v1/workspaces/{workspaceId}/runs/{runId}", {
      path: own.runPath,
    });
    expect(held.state).toBe("paused");

    // The resume needs consent again; after a new grant the run continues through the models.
    const resume = () =>
      own.client.call("POST /v1/workspaces/{workspaceId}/runs/{runId}/resume", {
        path: own.runPath,
        header: { "idempotency-key": randomUUID() },
      });
    await expect(resume()).rejects.toMatchObject({
      status: 409,
      code: "transmission_consent_required",
    });
    expect(queued).toEqual([]);
    await transmission("granted");
    await resume();
    const resumed = queued.shift();
    if (resumed === undefined) throw new Error("The resumed run was queued.");
    outcomes.length = 0;
    while (outcomes.at(-1) !== "settled" && outcomes.length < 10) {
      await worker(resumed, { requeue: async () => undefined });
    }
    expect(outcomes[0]).toBe("advanced");
    expect(gateway.requestBodies.join("\n")).toContain(organisations.a.marker);
  }, 180_000);

  it("pauses a queued run whose material was quarantined after queueing, until it is released", async () => {
    const own = await beginRun("a");
    const job = queued.shift();
    if (job === undefined) throw new Error("The run was queued.");
    const { gateway, worker, outcomes, quarantined, serviceFor, workspaceRoot } = signInWorker();
    const tenantId = organisations.a.organisationId;

    // The run's job source and its knowledge source are flagged while the job waits.
    const service = serviceFor(tenantId);
    const root = workspaceRoot(job);
    const inputs = await service.readRunInputs?.({ root, runId: job.runId });
    if (inputs?.brief == null) throw new Error("The run recorded its brief.");
    const record = await service.getOpportunity({ root, ...inputs.brief });
    const postingId = record?.brief.sources[0]?.id;
    if (record === undefined || postingId === undefined) throw new Error("The brief has a source.");
    const { knowledgeBases } = await own.client.call("GET /v1/knowledge-bases", {});
    const baseId = knowledgeBases[0]?.id;
    if (baseId === undefined) throw new Error("The workspace has a knowledge base.");
    const { sources } = await own.client.call("GET /v1/knowledge-bases/{knowledgeBaseId}/sources", {
      path: { knowledgeBaseId: baseId },
    });
    const career = sources[0];
    if (career === undefined) throw new Error("The base has a source.");
    const flagged = {
      verdict: "flagged" as const,
      signals: ["instruction-override" as const],
      screeners: [{ id: "rules", version: "1" }],
      screenedAt: new Date().toISOString(),
    };
    const store = tenancy.forTenant(tenantId).contentScreening;
    const posting = await store.recordResult(
      {
        kind: "job-source",
        workspaceId: record.workspaceId,
        briefId: record.brief.id,
        sourceId: postingId,
      },
      flagged,
    );
    const upload = await store.recordResult(
      {
        kind: "knowledge-source-version",
        knowledgeBaseId: baseId,
        sourceId: career.id,
        sourceVersionId: career.versionId,
      },
      flagged,
    );

    // The worker pauses the run before any model call and reports ids and signal codes only.
    await worker(job, { requeue: async () => undefined });
    expect(outcomes).toEqual(["material-quarantined"]);
    expect(gateway.requestBodies).toEqual([]);
    expect(quarantined).toEqual([
      { kind: "job-source", resultId: posting.id, signals: ["instruction-override"] },
      { kind: "knowledge-source-version", resultId: upload.id, signals: ["instruction-override"] },
    ]);
    const runPath = own.runPath;
    const state = async () =>
      (await own.client.call("GET /v1/workspaces/{workspaceId}/runs/{runId}", { path: runPath }))
        .state;
    expect(await state()).toBe("paused");

    const workspace = { workspaceId: ownerWorkspaceId };
    const release = (resultId: string) =>
      own.client.call("POST /v1/workspaces/{workspaceId}/screening/{resultId}/release", {
        path: { ...workspace, resultId },
        body: { reason: "Synthetic test: the owner checked the text." },
      });
    const resume = async () => {
      await own.client.call("POST /v1/workspaces/{workspaceId}/runs/{runId}/resume", {
        path: runPath,
        header: { "idempotency-key": randomUUID() },
      });
      const resumed = queued.shift();
      if (resumed === undefined) throw new Error("The resumed run was queued.");
      return resumed;
    };

    // One release is not enough while the other source stays quarantined.
    await release(posting.id);
    outcomes.length = 0;
    quarantined.length = 0;
    await worker(await resume(), { requeue: async () => undefined });
    expect(outcomes).toEqual(["material-quarantined"]);
    expect(quarantined.map(({ resultId }) => resultId)).toEqual([upload.id]);
    expect(gateway.requestBodies).toEqual([]);

    // After the last release the resume goes through the models.
    await release(upload.id);
    const resumed = await resume();
    outcomes.length = 0;
    while (outcomes.at(-1) !== "settled" && outcomes.length < 10) {
      await worker(resumed, { requeue: async () => undefined });
    }
    expect(outcomes[0]).toBe("advanced");
    expect(gateway.requestBodies.join("\n")).toContain(organisations.a.marker);
  }, 180_000);
});
