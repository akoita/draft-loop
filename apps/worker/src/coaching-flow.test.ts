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
  assignMemberRequest,
  briefEdit,
  briefPatchBody,
  consentHistory,
  createApiClient,
  createBriefBody,
  defaultWorkspaceForm,
  recordIds,
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
import { createRunJobHandler, type RunJobOutcome } from "./run-job-handler.js";
import { tenantRunConsent, tenantServices } from "./tenant-services.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const issuer = "https://id.example.test/realms/draft-loop";
const audience = "draft-loop-api";
const budgetCeiling = { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 };
const organisationId = "org-cedar";
const gatewayEnv = {
  DRAFT_LOOP_VERTEX_PROJECT_ID: "synthetic-project",
  DRAFT_LOOP_VERTEX_LOCATION: "eu",
  DRAFT_LOOP_VERTEX_PRICE_FACTOR: "1.1",
  DRAFT_LOOP_OPENAI_KEY_SECRET: "projects/synthetic/secrets/openai-key/versions/1",
};

/** A fictional coaching firm: its owner and two coaches the owner invites. */
const people = {
  owner: { subject: "person-cleo", email: "cleo@cedar.example.test" },
  dara: { subject: "person-dara", email: "dara@cedar.example.test" },
  eli: { subject: "person-eli", email: "eli@cedar.example.test" },
} as const;
type Person = keyof typeof people;
type Coach = Exclude<Person, "owner">;

/**
 * Each coach's candidate record, with career material carrying a marker that is not hexadecimal,
 * so no id or checksum can contain it by chance.
 */
const records = {
  dara: { workspaceId: "candidate-fern", marker: "fern-lantern", employer: "Example Orchard" },
  eli: { workspaceId: "candidate-gale", marker: "gale-thimble", employer: "Example Quarry" },
} as const;

function careerFor(coach: Coach): string {
  const { marker, employer } = records[coach];
  return [
    "# Experience",
    "",
    `## Platform Engineer, ${employer} (2020-2024)`,
    "",
    `Built TypeScript services with deterministic testing, codenamed ${marker}.`,
    "",
  ].join("\n");
}

const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: { status?: number; code?: string }) => ({ status: error.status, code: error.code }),
  );

describe.runIf(connectionString !== undefined)("a coaching firm's records and consents", () => {
  const url = connectionString ?? "";
  const schema = `coaching_flow_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: url });
  const tokens: Partial<Record<Person, string>> = {};
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
    blobRoot = await mkdtemp(join(tmpdir(), "draft-loop-coaching-flow-"));
    tenancy = await openPostgresTenancy({ connectionString: runtimeUrl(url), schema });
    directory = await createPostgresTenantDirectory({ connectionString: runtimeUrl(url), schema });

    const signingKey = await generateKeyPair("ES256");
    const publicJwk = { ...(await exportJWK(signingKey.publicKey)), kid: "key-1", alg: "ES256" };
    for (const person of ["owner", "dara", "eli"] as const) {
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

  const clientFor = (person: Person): ApiClient => {
    const token = tokens[person];
    if (token === undefined) throw new Error("Tokens are signed before the test.");
    return createApiClient({ token, fetch: injectFetch(api) });
  };

  const listed = async (person: Person) =>
    recordIds(await clientFor(person).call("GET /v1/workspaces", {}));

  const consent = (
    client: ApiClient,
    workspaceId: string,
    kind: "material-storage" | "provider-transmission",
    action: "granted" | "withdrawn" = "granted",
  ) =>
    client.call("POST /v1/workspaces/{workspaceId}/consents", {
      path: { workspaceId },
      body:
        kind === "material-storage"
          ? { kind, action, basis: "contract" }
          : action === "granted"
            ? { kind, action, basis: "candidate-consent", providers: ["anthropic", "openai"] }
            : { kind, action, basis: "candidate-consent" },
    });

  /** A reviewed brief in the coach's record, ready to start a run. */
  const reviewedBrief = async (coach: Coach) => {
    const client = clientFor(coach);
    const workspace = { workspaceId: records[coach].workspaceId };
    const pasted = await client.call("POST /v1/workspaces/{workspaceId}/opportunities", {
      path: workspace,
      body: createBriefBody(
        `Platform Engineer at ${records[coach].employer}: build TypeScript services.`,
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
    return reviewed.brief;
  };

  const startRun = async (coach: Coach) => {
    const workspaceId = records[coach].workspaceId;
    const brief = await reviewedBrief(coach);
    return clientFor(coach).call("POST /v1/workspaces/{workspaceId}/runs", {
      path: { workspaceId },
      header: { "idempotency-key": randomUUID() },
      body: startRunBody(brief),
    });
  };

  /** The worker as a sign-in deployment runs it, checking each job's consent before any model. */
  const signInWorker = () => {
    const gateway = scriptedGateway(gatewayEnv.DRAFT_LOOP_OPENAI_KEY_SECRET);
    const serviceFor = tenantServices({
      tenancy,
      blobsFor: () => tenantKeyBlobs(blobRoot, createFilesystemBlobStorage()),
      local: workerProviderOptions(readModelGatewayConfig(gatewayEnv), gateway.dependencies),
    });
    const outcomes: RunJobOutcome[] = [];
    const workspaceRoot = (job: RunJob) => hostedWorkspaceReference(job.tenantId, job.workspaceId);
    const worker = createRunJobHandler({
      serviceFor: (job) => serviceFor(job.tenantId),
      workspaceRoot,
      allowProviderData: true,
      budgetCeiling,
      consentFor: tenantRunConsent({ tenancy, serviceFor, workspaceRoot }),
      onOutcome: (_job, outcome) => outcomes.push(outcome),
    });
    return { gateway, worker, outcomes };
  };

  const knowledgeBases: Partial<Record<Coach, string>> = {};

  it("gives each coach only their record, and stores and sends material only with consent", async () => {
    // The operator creates the firm; its owner invites two coaches and sets up two records.
    const operator = createApiClient({ token: ownerToken, fetch: injectFetch(api) });
    await operator.call("POST /v1/operator/organisations", {
      body: { organisationId, name: "Cedar Coaching", firstOwnerEmail: people.owner.email },
    });
    const owner = clientFor("owner");
    const memberIds: Partial<Record<Coach, string>> = {};
    for (const coach of ["dara", "eli"] as const) {
      const invited = await owner.call("POST /v1/organisation/members", {
        body: { email: people[coach].email, role: "member" },
      });
      memberIds[coach] = invited.memberId;
      const { workspaceId } = records[coach];
      await owner.call("PUT /v1/workspaces/{workspaceId}", {
        path: { workspaceId },
        body: workspaceRequestBody({
          ...defaultWorkspaceForm,
          authorModel: "claude-sonnet-5-5",
          criticModel: "gpt-6-luna",
        }),
      });
      await owner.call(
        "PUT /v1/workspaces/{workspaceId}/members/{memberId}",
        assignMemberRequest(workspaceId, invited.memberId),
      );
    }

    // Each coach lists their own record alone; the other answers as a missing one.
    expect(await listed("dara")).toEqual([records.dara.workspaceId]);
    expect(await listed("eli")).toEqual([records.eli.workspaceId]);
    expect(await listed("owner")).toEqual([records.dara.workspaceId, records.eli.workspaceId]);
    for (const [coach, other] of [
      ["dara", "eli"],
      ["eli", "dara"],
    ] as const) {
      const client = clientFor(coach);
      const path = { workspaceId: records[other].workspaceId };
      expect(await refusal(client.call("GET /v1/workspaces/{workspaceId}", { path }))).toEqual(
        expect.objectContaining({ status: 404 }),
      );
      expect(
        await refusal(client.call("GET /v1/workspaces/{workspaceId}/consents", { path })),
      ).toEqual(expect.objectContaining({ status: 404 }));
      expect(
        await refusal(
          client.call("POST /v1/knowledge-bases", {
            body: { displayName: "Not mine", workspaceId: path.workspaceId },
          }),
        ),
      ).toEqual(expect.objectContaining({ status: 404 }));
    }

    // Each coach adds career material: the upload waits for the storage attestation.
    for (const coach of ["dara", "eli"] as const) {
      const client = clientFor(coach);
      const { workspaceId } = records[coach];
      const base = await client.call("POST /v1/knowledge-bases", {
        body: { displayName: "Career material", workspaceId },
      });
      knowledgeBases[coach] = base.id;
      const upload = () =>
        client.call("POST /v1/knowledge-bases/{knowledgeBaseId}/sources", {
          path: { knowledgeBaseId: base.id },
          query: { name: "career.md" },
          body: new Blob([careerFor(coach)], { type: "text/markdown" }),
          contentType: "text/markdown",
        });
      expect(await refusal(upload())).toEqual({ status: 409, code: "storage_consent_required" });
      await consent(client, workspaceId, "material-storage");
      await upload();
      const selection = selectionRequest([base.id], false);
      if ("problem" in selection) throw new Error(selection.problem);
      await client.call("PUT /v1/workspaces/{workspaceId}/knowledge-selection", {
        path: { workspaceId },
        body: selection.body,
      });
    }

    // Neither coach reaches the other's material; each lists only their own base.
    const daraBase = knowledgeBases.dara ?? "";
    const eliBase = knowledgeBases.eli ?? "";
    expect(
      await refusal(
        clientFor("eli").call("GET /v1/knowledge-bases/{knowledgeBaseId}/sources", {
          path: { knowledgeBaseId: daraBase },
        }),
      ),
    ).toEqual(expect.objectContaining({ status: 404 }));
    const { knowledgeBases: daraLists } = await clientFor("dara").call(
      "GET /v1/knowledge-bases",
      {},
    );
    expect(daraLists.map((base) => base.id)).toEqual([daraBase]);
    const { knowledgeBases: ownerLists } = await owner.call("GET /v1/knowledge-bases", {});
    expect(ownerLists.map((base) => base.id).sort()).toEqual([daraBase, eliBase].sort());

    // A run waits for the candidate's consent to send material to the providers.
    for (const coach of ["dara", "eli"] as const) {
      expect(await refusal(startRun(coach))).toEqual({
        status: 409,
        code: "transmission_consent_required",
      });
      await consent(clientFor(coach), records[coach].workspaceId, "provider-transmission");
      await startRun(coach);
    }
    expect(queued.map((job) => job.workspaceId)).toEqual([
      records.dara.workspaceId,
      records.eli.workspaceId,
    ]);

    // The worker runs both; each run sends its own candidate's material and nothing else.
    const { gateway, worker, outcomes } = signInWorker();
    const sent: Partial<Record<string, string>> = {};
    for (let job = queued.shift(); job !== undefined; job = queued.shift()) {
      const before = gateway.requestBodies.length;
      outcomes.length = 0;
      while (outcomes.at(-1) !== "settled" && outcomes.length < 10) {
        await worker(job, { requeue: async () => undefined });
      }
      expect(outcomes.at(-1)).toBe("settled");
      sent[job.workspaceId] = gateway.requestBodies.slice(before).join("\n");
    }
    const sentForDara = sent[records.dara.workspaceId] ?? "";
    const sentForEli = sent[records.eli.workspaceId] ?? "";
    expect(sentForDara).toContain(records.dara.marker);
    expect(sentForDara).not.toContain(records.eli.marker);
    expect(sentForEli).toContain(records.eli.marker);
    expect(sentForEli).not.toContain(records.dara.marker);
  }, 180_000);

  it("stops the next run once the candidate withdraws consent", async () => {
    const client = clientFor("dara");
    const { workspaceId } = records.dara;

    // A run is queued, then the candidate withdraws: the worker pauses it before any model call.
    await startRun("dara");
    const job = queued.shift();
    if (job === undefined) throw new Error("The run was queued.");
    await consent(client, workspaceId, "provider-transmission", "withdrawn");
    const { gateway, worker, outcomes } = signInWorker();
    await worker(job, { requeue: async () => undefined });
    expect(outcomes).toEqual(["consent-required"]);
    expect(gateway.requestBodies).toEqual([]);

    // A new run is refused at the API, and nothing is queued.
    expect(await refusal(startRun("dara"))).toEqual({
      status: 409,
      code: "transmission_consent_required",
    });
    expect(queued).toEqual([]);

    // The ledger keeps the history, and the other coach's record is untouched.
    const consents = await client.call("GET /v1/workspaces/{workspaceId}/consents", {
      path: { workspaceId },
    });
    expect(consentHistory(consents, "provider-transmission").map((entry) => entry.action)).toEqual([
      "withdrawn",
      "granted",
    ]);
    await startRun("eli");
    expect(queued.map((queuedJob) => queuedJob.workspaceId)).toEqual([records.eli.workspaceId]);
    queued.length = 0;
  }, 180_000);
});
