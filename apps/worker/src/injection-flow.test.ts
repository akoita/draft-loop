import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApi, composeHostedApplication, hostedKnowledgeLocation } from "@draft-loop/api";
import {
  type ContentScreeningCorpusCase,
  cleanContentScreeningCases,
  injectedContentScreeningCases,
} from "@draft-loop/ingestion/content-screening-corpus";
import { createRuleContentScreener } from "@draft-loop/ingestion/content-screening-rules";
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
  defaultWorkspaceForm,
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

/** One fictional organisation with one owner, and career material marked with a codename. */
const organisation = {
  organisationId: "org-alder",
  name: "Alder Coaching",
  subject: "person-ada",
  email: "ada@alder.example.test",
  marker: "alder-quill",
  employer: "Example Ledger",
} as const;

const cleanCareer = [
  "# Experience",
  "",
  `## Platform Engineer, ${organisation.employer} (2020-2024)`,
  "",
  `Built TypeScript services with deterministic testing, codenamed ${organisation.marker}.`,
  "",
].join("\n");

const cleanPosting = `Platform Engineer at ${organisation.employer}: build TypeScript services.`;
const releaseReason = "Synthetic test: the owner checked the text.";

/**
 * The corpus is built so the rule screener alone reports exactly the labelled signals for every
 * case (its own test pins that), so no injected case here is model-only.
 */
const injected = injectedContentScreeningCases;
const clean = cleanContentScreeningCases;

describe.runIf(connectionString !== undefined)(
  "prompt injection through job posts and uploads (red team)",
  () => {
    const url = connectionString ?? "";
    const schema = `injection_flow_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Client({ connectionString: url });
    const queued: { tenantId: string; workspaceId: string; runId: string }[] = [];
    const tenantId = organisation.organisationId;
    const workspace = { workspaceId: ownerWorkspaceId };
    let token: string;
    let blobRoot: string;
    let tenancy: PostgresTenancy;
    let directory: PostgresTenantDirectory;
    let api: FastifyInstance;
    let client: ApiClient;

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
      blobRoot = await mkdtemp(join(tmpdir(), "draft-loop-injection-flow-"));
      tenancy = await openPostgresTenancy({ connectionString: runtimeUrl(url), schema });
      directory = await createPostgresTenantDirectory({
        connectionString: runtimeUrl(url),
        schema,
      });

      const signingKey = await generateKeyPair("ES256");
      const publicJwk = { ...(await exportJWK(signingKey.publicKey)), kid: "key-1", alg: "ES256" };
      token = await new SignJWT({ email: organisation.email, email_verified: true })
        .setProtectedHeader({ alg: "ES256", kid: "key-1" })
        .setIssuer(issuer)
        .setAudience(audience)
        .setSubject(organisation.subject)
        .setExpirationTime("10m")
        .sign(signingKey.privateKey);
      const blobs = tenantKeyBlobs(blobRoot, createFilesystemBlobStorage());
      // No screening setup is passed: the hosted application screens with the rule screener, the
      // default mode, so nothing here calls a model.
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
          recordAccessFor: (id) => tenancy.forTenant(id).candidateRecords,
          knowledgeOwnersFor: (id) => tenancy.forTenant(id).knowledgeBaseOwners,
          applicationFor: (id) =>
            composeHostedApplication({
              storage: tenancy.forTenant(id),
              blobs,
              tenantId: id,
              budgetCeiling,
              enqueueRun: async (workspaceId, runId) => {
                queued.push({ tenantId: id, workspaceId, runId });
              },
              knowledgeLocation: (versionId) => hostedKnowledgeLocation(id, versionId),
            }),
        },
      });

      const operator = createApiClient({ token: ownerToken, fetch: injectFetch(api) });
      await operator.call("POST /v1/operator/organisations", {
        body: {
          organisationId: organisation.organisationId,
          name: organisation.name,
          firstOwnerEmail: organisation.email,
        },
      });
      client = createApiClient({ token, fetch: injectFetch(api) });
      await client.call("GET /v1/me", {});
      await client.call("PUT /v1/workspaces/{workspaceId}", {
        path: workspace,
        body: workspaceRequestBody({
          ...defaultWorkspaceForm,
          authorModel: "claude-sonnet-5-5",
          criticModel: "gpt-6-luna",
        }),
      });
      await client.call("POST /v1/workspaces/{workspaceId}/consents", {
        path: workspace,
        body: { kind: "material-storage", action: "granted", basis: "contract" },
      });
      await client.call("POST /v1/workspaces/{workspaceId}/consents", {
        path: workspace,
        body: {
          kind: "provider-transmission",
          action: "granted",
          basis: "candidate-consent",
          providers: ["anthropic", "openai"],
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

    /** A pasted job post, as the opportunities route takes it; the answer shows its screening. */
    const submitJobPost = (text: string) =>
      client.call("POST /v1/workspaces/{workspaceId}/opportunities", {
        path: workspace,
        body: createBriefBody(text, new Date()),
      });

    /** A candidate file, as the knowledge route takes it; the answer shows its screening. */
    const uploadFile = (knowledgeBaseId: string, name: string, text: string) =>
      client.call("POST /v1/knowledge-bases/{knowledgeBaseId}/sources", {
        path: { knowledgeBaseId },
        query: { name },
        body: new Blob([text], { type: "text/markdown" }),
        contentType: "text/markdown",
      });

    const createBase = async (displayName: string) =>
      (
        await client.call("POST /v1/knowledge-bases", {
          body: { displayName, workspaceId: ownerWorkspaceId },
        })
      ).id;

    const selectBases = async (baseIds: readonly string[]) => {
      const selection = selectionRequest([...baseIds], true);
      if ("problem" in selection) throw new Error(selection.problem);
      await client.call("PUT /v1/workspaces/{workspaceId}/knowledge-selection", {
        path: workspace,
        body: selection.body,
      });
    };

    /** A job post taken to a reviewed brief, the state a run starts from. */
    const reviewedBrief = async (text: string) => {
      const pasted = await submitJobPost(text);
      const briefPath = { ...workspace, briefId: pasted.brief.id };
      const edited = await client.call(
        "PATCH /v1/workspaces/{workspaceId}/opportunities/{briefId}",
        {
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
        },
      );
      const reviewed = await client.call(
        "POST /v1/workspaces/{workspaceId}/opportunities/{briefId}/review",
        { path: briefPath, body: { expectedVersion: edited.brief.version } },
      );
      return { brief: reviewed.brief, screening: pasted.screening };
    };

    const startRun = (brief: Parameters<typeof startRunBody>[0]) =>
      client.call("POST /v1/workspaces/{workspaceId}/runs", {
        path: workspace,
        header: { "idempotency-key": randomUUID() },
        body: startRunBody(brief),
      });

    const release = (resultId: string) =>
      client.call("POST /v1/workspaces/{workspaceId}/screening/{resultId}/release", {
        path: { ...workspace, resultId },
        body: { reason: releaseReason },
      });

    /** The worker as a sign-in deployment runs it, through the scripted gateway. */
    const signInWorker = () => {
      const gateway = scriptedGateway(gatewayEnv.DRAFT_LOOP_OPENAI_KEY_SECRET);
      const serviceFor = tenantServices({
        tenancy,
        blobsFor: () => tenantKeyBlobs(blobRoot, createFilesystemBlobStorage()),
        local: workerProviderOptions(readModelGatewayConfig(gatewayEnv), gateway.dependencies),
      });
      const outcomes: RunJobOutcome[] = [];
      const quarantined: QuarantinedRunInput[] = [];
      const workspaceRoot = (job: RunJob) =>
        hostedWorkspaceReference(job.tenantId, job.workspaceId);
      const worker = createRunJobHandler({
        serviceFor: (job) => serviceFor(job.tenantId),
        workspaceRoot,
        allowProviderData: true,
        budgetCeiling,
        consentFor: tenantRunConsent({ tenancy, serviceFor, workspaceRoot }),
        quarantinedFor: tenantRunQuarantine({
          tenancy,
          serviceFor,
          workspaceRoot,
          requireScreening: true,
        }),
        onQuarantined: (_job, material) => quarantined.push(...material),
        onOutcome: (_job, outcome) => outcomes.push(outcome),
      });
      return { gateway, worker, outcomes, quarantined, serviceFor, workspaceRoot };
    };

    /** The screening status of the record: every job source and current upload, latest result. */
    const statuses = async () =>
      (await client.call("GET /v1/workspaces/{workspaceId}/screening", { path: workspace }))
        .statuses;

    it("quarantines every injected job post and upload with the rule screener and clears the clean ones", async () => {
      // The whole synthetic corpus, not a sample: the corpus's own test sets these floors.
      expect(injected.length).toBeGreaterThanOrEqual(20);
      expect(clean.length).toBeGreaterThanOrEqual(15);
      const injectedBase = await createBase("Injected uploads");
      const cleanBase = await createBase("Clean uploads");

      const expectScreened = (
        entry: ContentScreeningCorpusCase,
        how: string,
        screening: { verdict: string; signals: readonly string[] } | undefined,
      ) => {
        const expected = entry.signals.length === 0 ? "clear" : "flagged";
        expect(screening?.verdict, `${how}: ${entry.id}`).toBe(expected);
        // The rule screener reports exactly the labelled signals, in the closed vocabulary.
        expect(screening?.signals, `${how}: ${entry.id}`).toEqual(entry.signals);
      };

      for (const entry of [...injected, ...clean]) {
        const post = await submitJobPost(entry.text);
        expectScreened(entry, "job post", post.screening);
        const base = entry.signals.length === 0 ? cleanBase : injectedBase;
        const upload = await uploadFile(base, `${entry.id}.md`, entry.text);
        expectScreened(entry, "upload", upload.screening);
      }

      // The record's status lists each latest result: quarantined exactly when it was flagged.
      const listed = await statuses();
      expect(listed).toHaveLength(2 * (injected.length + clean.length));
      expect(listed.filter((status) => status.quarantined)).toHaveLength(2 * injected.length);
      for (const status of listed) {
        expect(status.quarantined).toBe(status.verdict === "flagged");
        expect(status.verdict === "clear").toBe(status.signals.length === 0);
        // A status carries ids and codes, never a quote of the screened text.
        for (const entry of injected) {
          expect(JSON.stringify(status)).not.toContain(entry.text.slice(0, 24));
        }
      }
    }, 180_000);

    it("refuses to start a run on a quarantined job post or a selected quarantined upload", async () => {
      const cleanBase = await createBase("Career material");
      await uploadFile(cleanBase, "career.md", cleanCareer);
      await selectBases([cleanBase]);

      // A quarantined job post: the run never begins and nothing is queued.
      const flaggedPost = injected[0];
      if (flaggedPost === undefined) throw new Error("The corpus has injected cases.");
      const { brief, screening } = await reviewedBrief(flaggedPost.text);
      expect(screening?.verdict).toBe("flagged");
      await expect(startRun(brief)).rejects.toMatchObject({
        status: 409,
        code: "material_quarantined",
      });
      expect(queued).toEqual([]);

      // A clean job post on a selected base that holds a quarantined upload is refused as well.
      const poisonedBase = await createBase("Poisoned material");
      const flaggedUpload = injected.at(-1);
      if (flaggedUpload === undefined) throw new Error("The corpus has injected cases.");
      const uploaded = await uploadFile(poisonedBase, "notes.md", flaggedUpload.text);
      expect(uploaded.screening?.verdict).toBe("flagged");
      await selectBases([cleanBase, poisonedBase]);
      const clearPost = await reviewedBrief(cleanPosting);
      expect(clearPost.screening?.verdict).toBe("clear");
      await expect(startRun(clearPost.brief)).rejects.toMatchObject({
        status: 409,
        code: "material_quarantined",
      });
      expect(queued).toEqual([]);

      // With the poisoned base unselected, the same clean post begins.
      await selectBases([cleanBase]);
      await startRun(clearPost.brief);
      expect(queued).toHaveLength(1);
      queued.length = 0;
    }, 180_000);

    it("pauses a queued run on later-flagged material before any model call, and a release lets one run through", async () => {
      const { brief } = await reviewedBrief(cleanPosting);
      const begun = await startRun(brief);
      const job = queued.shift();
      if (job === undefined) throw new Error("The run was queued.");
      const runPath = { ...workspace, runId: begun.runId };
      const { gateway, worker, outcomes, quarantined, serviceFor, workspaceRoot } = signInWorker();

      // While the job waits, an injected job post and an injected upload are recorded against the
      // run's own material, as the rule screener would report them for that text.
      const service = serviceFor(tenantId);
      const root = workspaceRoot(job);
      const inputs = await service.readRunInputs?.({ root, runId: job.runId });
      if (inputs?.brief == null) throw new Error("The run recorded its brief.");
      const record = await service.getOpportunity({ root, ...inputs.brief });
      const postingId = record?.brief.sources[0]?.id;
      if (record === undefined || postingId === undefined)
        throw new Error("The brief has a source.");
      const { knowledgeBases } = await client.call("GET /v1/knowledge-bases", {});
      const career = await Promise.all(
        knowledgeBases.map(async (base) => ({
          base,
          sources: (
            await client.call("GET /v1/knowledge-bases/{knowledgeBaseId}/sources", {
              path: { knowledgeBaseId: base.id },
            })
          ).sources,
        })),
      ).then((bases) =>
        bases.find(({ sources }) => sources.some((s) => s.displayName === "career.md")),
      );
      const source = career?.sources.find((entry) => entry.displayName === "career.md");
      if (career === undefined || source === undefined) throw new Error("The base has career.md.");

      const attack = injected[0];
      if (attack === undefined) throw new Error("The corpus has injected cases.");
      const flagged = await createRuleContentScreener().screen({
        text: attack.text,
        kind: "job-source",
      });
      expect(flagged.verdict).toBe("flagged");
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
          knowledgeBaseId: career.base.id,
          sourceId: source.id,
          sourceVersionId: source.versionId,
        },
        flagged,
      );

      // The worker pauses the run with no author or critic call, and reports ids and codes only.
      await worker(job, { requeue: async () => undefined });
      expect(outcomes).toEqual(["material-quarantined"]);
      expect(gateway.requestBodies).toEqual([]);
      expect(quarantined).toEqual([
        { kind: "job-source", resultId: posting.id, signals: [...flagged.signals] },
        { kind: "knowledge-source-version", resultId: upload.id, signals: [...flagged.signals] },
      ]);
      expect(
        (await client.call("GET /v1/workspaces/{workspaceId}/runs/{runId}", { path: runPath }))
          .state,
      ).toBe("paused");

      // A resume without a release is paused again, still with no model call.
      const resume = async () => {
        await client.call("POST /v1/workspaces/{workspaceId}/runs/{runId}/resume", {
          path: runPath,
          header: { "idempotency-key": randomUUID() },
        });
        const resumed = queued.shift();
        if (resumed === undefined) throw new Error("The resumed run was queued.");
        return resumed;
      };
      outcomes.length = 0;
      await worker(await resume(), { requeue: async () => undefined });
      expect(outcomes).toEqual(["material-quarantined"]);
      expect(gateway.requestBodies).toEqual([]);

      // The owner releases both results, each with a recorded reason, and the run goes through.
      await release(posting.id);
      await release(upload.id);
      const resumed = await resume();
      outcomes.length = 0;
      while (outcomes.at(-1) !== "settled" && outcomes.length < 10) {
        await worker(resumed, { requeue: async () => undefined });
      }
      expect(outcomes[0]).toBe("advanced");
      expect(outcomes.at(-1)).toBe("settled");
      expect(gateway.requestBodies.join("\n")).toContain(organisation.marker);

      // Each release left a content-free audit event on the record's chain.
      const events = (await tenancy.forTenant(tenantId).listAuditEvents(record.workspaceId)).filter(
        (event) => event.eventType === "content-screening.released",
      );
      expect(events.map((event) => event.entityId).sort()).toEqual([posting.id, upload.id].sort());
      for (const event of events) {
        expect(Object.keys(event.payload ?? {}).sort()).toEqual(["memberId", "resultId"]);
      }
      const trail = JSON.stringify(events);
      expect(trail).not.toContain(attack.text.slice(0, 24));
      expect(trail).not.toContain(releaseReason);
      await expect(
        tenancy.forTenant(tenantId).auditEvents.verifyAuditChain(record.workspaceId),
      ).resolves.toMatchObject({ ok: true });
    }, 180_000);
  },
);
