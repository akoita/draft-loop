import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildApi,
  composeHostedApplication,
  hostedEntitlementsFor,
  hostedKnowledgeLocation,
  hostedOperatorFor,
} from "@draft-loop/api";
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
  briefEdit,
  briefPatchBody,
  createApiClient,
  createBriefBody,
  ownerWorkspaceId,
  selectionRequest,
  startRunBody,
} from "@draft-loop/web";
import type { FastifyInstance } from "fastify";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { scriptedGateway } from "./gateway-test-support.js";
import { injectFetch, runtimeRole, runtimeUrl, tenantKeyBlobs } from "./hosted-test-support.js";
import { readModelGatewayConfig, workerProviderOptions } from "./model-routes.js";
import { type RunCreditsClosed, tenantRunCredits } from "./run-credit-settlement.js";
import { createRunJobHandler, type RunJobOutcome } from "./run-job-handler.js";
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
const premiumPair = {
  author: { id: "premium-anthropic-author", version: 1 },
  critic: { id: "premium-openai-critic", version: 1 },
};

/** Two fictional organisations on the Individual plan, each with one owner. */
const organisations = {
  fern: {
    organisationId: "org-fern",
    name: "Fern Careers",
    subject: "person-fern",
    email: "fern@fern.example.test",
    employer: "Example Ledger",
  },
  maple: {
    organisationId: "org-maple",
    name: "Maple Coaching",
    subject: "person-maple",
    email: "maple@maple.example.test",
    employer: "Example Harbour",
  },
} as const;
type Side = keyof typeof organisations;

/** What the credit view and the operator view answer, reduced to the numbers a test compares. */
interface Credits {
  readonly planId: string;
  readonly allowance: number;
  readonly used: number;
  readonly reserved: number;
  readonly remaining: number;
  readonly warning: boolean;
}

describe.runIf(connectionString !== undefined)("plans and credits across two organisations", () => {
  const url = connectionString ?? "";
  const schema = `plans_credits_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: url });
  const tokens: Partial<Record<Side, string>> = {};
  const queued: RunJob[] = [];
  const logLines: string[] = [];
  const closed: RunCreditsClosed[] = [];
  const outcomes: RunJobOutcome[] = [];
  /** While set, the scripted author endpoint refuses the call, as a provider with a bad key does. */
  let authorRefused = false;
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
    blobRoot = await mkdtemp(join(tmpdir(), "draft-loop-plans-credits-"));
    tenancy = await openPostgresTenancy({ connectionString: runtimeUrl(url), schema });
    directory = await createPostgresTenantDirectory({
      connectionString: runtimeUrl(url),
      schema,
    });

    const signingKey = await generateKeyPair("ES256");
    const publicJwk = { ...(await exportJWK(signingKey.publicKey)), kid: "key-1", alg: "ES256" };
    for (const side of ["fern", "maple"] as const) {
      const { subject, email } = organisations[side];
      tokens[side] = await new SignJWT({ email, email_verified: true })
        .setProtectedHeader({ alg: "ES256", kid: "key-1" })
        .setIssuer(issuer)
        .setAudience(audience)
        .setSubject(subject)
        .setExpirationTime("10m")
        .sign(signingKey.privateKey);
    }
    worker = buildWorker();
    const blobs = tenantKeyBlobs(blobRoot, createFilesystemBlobStorage());
    api = await buildApi({
      ownerToken,
      // The alerts read the `message` of a warning line; its fields are ids and numbers only.
      logger: {
        messageKey: "message",
        base: null,
        stream: { write: (line: string) => logLines.push(line) },
      },
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
        operatorFor: hostedOperatorFor(tenancy),
        entitlementsFor: hostedEntitlementsFor(tenancy),
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

  const request = async (
    token: string | undefined,
    method: "GET" | "POST" | "PUT",
    path: string,
    payload?: object,
    headers: Record<string, string> = {},
  ) => {
    const response = await api.inject({
      method,
      url: path,
      headers: { authorization: `Bearer ${token}`, ...headers },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
    return { status: response.statusCode, body: response.json() };
  };
  const operator = (
    method: "GET" | "POST" | "PUT",
    path: string,
    payload?: object,
    headers?: Record<string, string>,
  ) => request(ownerToken, method, `/v1/operator/organisations${path}`, payload, headers);

  /** What the signed-in member sees of the organisation's plan and credits. */
  const creditsOf = async (side: Side): Promise<Credits> => {
    const { status, body } = await request(tokens[side], "GET", "/v1/organisation/credits");
    expect(status).toBe(200);
    return {
      planId: body.planId,
      allowance: body.allowance,
      used: body.used,
      reserved: body.reserved,
      remaining: body.remaining,
      warning: body.warning,
    };
  };

  /** The warnings the usage alerts read for one organisation, in the order they were logged. */
  const thresholdsOf = (side: Side) =>
    logLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter(
        (line) =>
          line.organisationId === organisations[side].organisationId &&
          (line.message === "credit allowance 80% used" ||
            line.message === "credit balance exhausted"),
      );

  /** The worker as a sign-in deployment runs it: scripted providers, with credits settled. */
  const buildWorker = () => {
    const gateway = scriptedGateway(gatewayEnv.DRAFT_LOOP_OPENAI_KEY_SECRET);
    const scriptedFetch = gateway.dependencies.vertex?.fetch;
    const dependencies = {
      ...gateway.dependencies,
      vertex: {
        ...gateway.dependencies.vertex,
        fetch: (async (...args: Parameters<typeof fetch>) =>
          authorRefused
            ? new Response(
                JSON.stringify({ type: "error", error: { type: "authentication_error" } }),
                { status: 401, headers: { "content-type": "application/json" } },
              )
            : scriptedFetch?.(...args)) as typeof fetch,
      },
    };
    const serviceFor = tenantServices({
      tenancy,
      blobsFor: () => tenantKeyBlobs(blobRoot, createFilesystemBlobStorage()),
      local: workerProviderOptions(readModelGatewayConfig(gatewayEnv), dependencies),
    });
    const workspaceRoot = (job: RunJob) => hostedWorkspaceReference(job.tenantId, job.workspaceId);
    return createRunJobHandler({
      serviceFor: (job) => serviceFor(job.tenantId),
      workspaceRoot,
      allowProviderData: true,
      budgetCeiling,
      consentFor: tenantRunConsent({ tenancy, serviceFor, workspaceRoot }),
      credits: tenantRunCredits({ tenancy, onClosed: (entry) => closed.push(entry) }),
      onOutcome: (_job, outcome) => outcomes.push(outcome),
    });
  };
  let worker: ReturnType<typeof buildWorker>;

  /** Runs every queued job until its run needs no more work, or its credits were closed. */
  const drain = async () => {
    for (let job = queued.shift(); job !== undefined; job = queued.shift()) {
      outcomes.length = 0;
      while (
        outcomes.at(-1) !== "settled" &&
        outcomes.at(-1) !== "credits-closed" &&
        outcomes.length < 10
      ) {
        await worker(job, { requeue: async () => undefined });
      }
    }
  };

  /** A set-up candidate record: workspace on the economy pair, consents, material and a reviewed brief. */
  const prepare = async (side: Side) => {
    const client = clientFor(side);
    const workspace = { workspaceId: ownerWorkspaceId };
    await client.call("PUT /v1/workspaces/{workspaceId}", {
      path: workspace,
      body: {
        language: "en",
        maxRounds: 2,
        fixtureMode: false,
        author: { company: "anthropic", model: "claude-sonnet-5-5" },
        critic: { company: "openai", model: "gpt-6-luna" },
      },
    });
    for (const body of [
      { kind: "material-storage", action: "granted", basis: "contract" },
      {
        kind: "provider-transmission",
        action: "granted",
        basis: "candidate-consent",
        providers: ["anthropic", "openai"],
      },
    ] as const) {
      await client.call("POST /v1/workspaces/{workspaceId}/consents", { path: workspace, body });
    }
    const base = await client.call("POST /v1/knowledge-bases", {
      body: { displayName: "Career material", workspaceId: ownerWorkspaceId },
    });
    await client.call("POST /v1/knowledge-bases/{knowledgeBaseId}/sources", {
      path: { knowledgeBaseId: base.id },
      query: { name: "career.md" },
      body: new Blob(
        [
          `# Experience\n\n## Platform Engineer, ${organisations[side].employer} (2020-2024)\n\nBuilt TypeScript services with deterministic testing.\n`,
        ],
        { type: "text/markdown" },
      ),
      contentType: "text/markdown",
    });
    const selection = selectionRequest([base.id], false);
    if ("problem" in selection) throw new Error(selection.problem);
    await client.call("PUT /v1/workspaces/{workspaceId}/knowledge-selection", {
      path: workspace,
      body: selection.body,
    });
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
    return startRunBody(reviewed.brief);
  };

  /** Starts a run as the organisation's owner; the answer is returned, never thrown. */
  const startRun = (side: Side, begin: object, modelProfiles?: object) =>
    request(
      tokens[side],
      "POST",
      `/v1/workspaces/${ownerWorkspaceId}/runs`,
      modelProfiles === undefined ? begin : { ...begin, modelProfiles },
      { "idempotency-key": randomUUID() },
    );

  it("meters, refuses and refunds one organisation while the other is untouched", async () => {
    // The operator creates both organisations and assigns the Individual plan. Fern's gets
    // headroom for the example: a credit allowance of 5, so 80% is a whole number of runs, and
    // no daily cap, so the allowance is what ends the runs.
    for (const side of ["fern", "maple"] as const) {
      const { organisationId, name, email } = organisations[side];
      const created = await operator("POST", "", {
        organisationId,
        name,
        firstOwnerEmail: email,
      });
      expect(created.status).toBe(201);
    }
    const fernPlan = await operator("PUT", "/org-fern/plan", {
      planId: "individual",
      overrides: { creditsPerPeriod: 5, runsPerDay: null },
    });
    expect(fernPlan.status).toBe(200);
    expect(fernPlan.body.entitlements).toMatchObject({
      creditsPerPeriod: 5,
      modelTiers: ["economy"],
      concurrentRuns: 1,
      runsPerDay: null,
    });
    expect((await operator("PUT", "/org-maple/plan", { planId: "individual" })).status).toBe(200);

    const begin = { fern: await prepare("fern"), maple: await prepare("maple") };
    expect(await creditsOf("fern")).toEqual({
      planId: "individual",
      allowance: 5,
      used: 0,
      reserved: 0,
      remaining: 5,
      warning: false,
    });
    const maple = {
      planId: "individual",
      allowance: 4,
      used: 0,
      reserved: 0,
      remaining: 4,
      warning: false,
    };
    expect(await creditsOf("maple")).toEqual(maple);

    // A run reserves its estimate at once and settles when the worker has a draft.
    const first = await startRun("fern", begin.fern);
    expect(first.status).toBe(201);
    expect(await creditsOf("fern")).toMatchObject({ used: 1, reserved: 1, remaining: 4 });
    await drain();
    expect(closed).toMatchObject([
      { organisationId: "org-fern", runId: first.body.runId, credits: 1, outcome: "settled" },
    ]);
    expect(await creditsOf("fern")).toMatchObject({ used: 1, reserved: 0, remaining: 4 });

    // A run that fails before its first draft gives its credit back.
    authorRefused = true;
    const failed = await startRun("fern", begin.fern);
    expect(failed.status).toBe(201);
    await drain();
    authorRefused = false;
    expect(closed.at(-1)).toMatchObject({
      organisationId: "org-fern",
      runId: failed.body.runId,
      outcome: "refunded",
    });
    expect(await creditsOf("fern")).toMatchObject({ used: 1, reserved: 0, remaining: 4 });

    // A premium pair is outside the Individual plan: refused by tier, nothing reserved or queued.
    const refusedTier = await startRun("fern", begin.fern, premiumPair);
    expect(refusedTier.status).toBe(403);
    expect(refusedTier.body.error).toMatchObject({
      code: "model_tier_not_in_plan",
      role: "author",
      tier: "premium",
    });
    expect(queued).toEqual([]);
    expect(await creditsOf("fern")).toMatchObject({ used: 1, reserved: 0, remaining: 4 });

    // One run in flight fills the plan's concurrency cap. The other organisation starts its own.
    const inFlight = await startRun("fern", begin.fern);
    expect(inFlight.status).toBe(201);
    const refusedCap = await startRun("fern", begin.fern);
    expect(refusedCap.status).toBe(429);
    expect(refusedCap.body.error).toMatchObject({
      code: "run_cap_reached",
      cap: "concurrent",
      limit: 1,
    });
    expect(await creditsOf("fern")).toMatchObject({ used: 2, reserved: 1, remaining: 3 });
    const mapleRun = await startRun("maple", begin.maple);
    expect(mapleRun.status).toBe(201);
    await drain();
    expect(await creditsOf("fern")).toMatchObject({ used: 2, reserved: 0, remaining: 3 });
    const mapleAfterItsRun = { ...maple, used: 1, remaining: 3 };
    expect(await creditsOf("maple")).toEqual(mapleAfterItsRun);

    // Runs go on until the allowance is used: the warning at 80%, then exhaustion, then 402.
    expect((await startRun("fern", begin.fern)).status).toBe(201);
    await drain();
    expect(thresholdsOf("fern")).toEqual([]);
    expect((await startRun("fern", begin.fern)).status).toBe(201);
    expect(thresholdsOf("fern")).toMatchObject([
      {
        level: 40,
        message: "credit allowance 80% used",
        allowance: 5,
        used: 4,
        remaining: 1,
      },
    ]);
    expect(await creditsOf("fern")).toMatchObject({ used: 4, remaining: 1, warning: true });
    await drain();
    expect((await startRun("fern", begin.fern)).status).toBe(201);
    expect(thresholdsOf("fern").map((line) => line.message)).toEqual([
      "credit allowance 80% used",
      "credit balance exhausted",
    ]);
    await drain();
    const exhausted = await startRun("fern", begin.fern);
    expect(exhausted.status).toBe(402);
    expect(exhausted.body.error).toEqual({
      code: "credits_insufficient",
      message: "The run needs up to 1 credits and the organisation has 0 left.",
      estimate: 1,
      remaining: 0,
    });
    expect(queued).toEqual([]);
    expect(await creditsOf("fern")).toEqual({
      planId: "individual",
      allowance: 5,
      used: 5,
      reserved: 0,
      remaining: 0,
      warning: true,
    });
    expect(thresholdsOf("fern")).toHaveLength(2);

    // The operator grants credits, once however often the request is retried, and runs resume.
    const grantKey = "grant-fern-goodwill-1";
    const grant = { credits: 2, reason: "goodwill" };
    const granted = await operator("POST", "/org-fern/credit-grants", grant, {
      "idempotency-key": grantKey,
    });
    expect(granted.status).toBe(201);
    const retried = await operator("POST", "/org-fern/credit-grants", grant, {
      "idempotency-key": grantKey,
    });
    expect(retried.body).toEqual(granted.body);
    expect(await creditsOf("fern")).toMatchObject({ remaining: 2 });
    expect((await startRun("fern", begin.fern)).status).toBe(201);
    await drain();
    const operatorView = await operator("GET", "/org-fern/credits");
    expect(operatorView.body).toMatchObject({
      organisationId: "org-fern",
      balance: { allowance: 5, allowanceUsed: 5, reserved: 0, grantsRemaining: 1, remaining: 1 },
    });

    // The other organisation saw none of it: same balance, no warning, no foreign reservation, and
    // it can still start a run while Fern's allowance is gone.
    expect(await creditsOf("maple")).toEqual(mapleAfterItsRun);
    expect(thresholdsOf("maple")).toEqual([]);
    const mapleLedger = tenancy.forTenant("org-maple").creditLedger;
    expect(await mapleLedger.openReservationCount()).toBe(0);
    expect(await mapleLedger.reservationFor(first.body.runId)).toBeUndefined();
    expect(await mapleLedger.reservationFor(mapleRun.body.runId)).toMatchObject({
      state: "settled",
    });
    expect((await operator("GET", "/org-maple/credits")).body.balance).toMatchObject({
      grantsRemaining: 0,
      remaining: 3,
    });
    expect((await startRun("maple", begin.maple)).status).toBe(201);
    await drain();
    expect(await creditsOf("maple")).toMatchObject({ used: 2, remaining: 2, warning: false });
    expect(closed.filter((entry) => entry.organisationId === "org-maple")).toHaveLength(2);
  }, 240_000);
});
