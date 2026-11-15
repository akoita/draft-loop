import type { ApplicationService, WorkspaceDescriptor } from "@draft-loop/application";
import { createWorkJournalService } from "@draft-loop/application/work-journal";
import { resolveEntitlements } from "@draft-loop/schemas/entitlements";
import type { CandidateRecordAccess } from "@draft-loop/storage/candidate-records";
import type { ConsentLedger, ConsentState } from "@draft-loop/storage/consent-ledger";
import type { KnowledgeBaseOwners } from "@draft-loop/storage/knowledge-base-owners";
import { createMemoryWorkJournalNoteStore } from "@draft-loop/storage/work-journal-notes";
import type { FastifyInstance } from "fastify";
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { buildApi } from "./app.js";
import type { TenantEntitlements } from "./entitlement-gate.js";
import type { TenantApplication } from "./tenant-context.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const issuer = "https://id.example.test/realms/draft-loop";
const audience = "draft-loop-api";
const notes = "/v1/workspaces/ws-1/work-journal/notes";
const intake = "/v1/workspaces/ws-1/work-journal/intake";

// Fictional project and links only.
const note = {
  title: "Card payments for the Fernhill booking site",
  summary:
    "Added card payments to the booking flow with a hosted checkout page, webhook handling for paid and refunded bookings, and retries for failed deliveries.",
  period: { start: "2026-10-12", end: "2026-10-30" },
  project: { name: "Fernhill bookings", visibility: "private", repository: "fernhill/bookings" },
  technologies: ["TypeScript", "Stripe", "Postgres"],
  category: "payments",
  candidate_role: ["implemented"],
  links: [{ kind: "pull-request", url: "https://git.example.test/fernhill/bookings/pull/42" }],
};

const descriptor = { id: "ws-1", root: "ws-1" } as WorkspaceDescriptor;

const entitlements: NonNullable<Awaited<ReturnType<TenantEntitlements["entitlements"]>>> = {
  ...resolveEntitlements("pro"),
  modelTiers: ["economy", "standard"],
  concurrentRuns: null,
  runsPerDay: null,
};

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;
let signingKey: KeyPair;
let publicJwk: JWK;
let app: FastifyInstance | undefined;

beforeAll(async () => {
  signingKey = await generateKeyPair("ES256");
  publicJwk = { ...(await exportJWK(signingKey.publicKey)), kid: "key-1", alg: "ES256" };
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function person() {
  const token = await new SignJWT({
    email: "ada@example.test",
    email_verified: true,
    azp: "draft-loop-web",
  })
    .setProtectedHeader({ alg: "ES256", kid: "key-1" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("person-1")
    .setExpirationTime("5m")
    .sign(signingKey.privateKey);
  return { authorization: `Bearer ${token}` };
}

/** An API in sign-in mode over one record, `ws-1`, which owns the base `kb-own`. */
async function signInApi(consent: { storage: boolean }): Promise<FastifyInstance> {
  const service = { readWorkspace: async () => descriptor } as unknown as ApplicationService;
  const state = (
    consent.storage ? { "material-storage": { action: "granted" } } : {}
  ) as ConsentState;
  const journal = createWorkJournalService({
    store: createMemoryWorkJournalNoteStore(),
    tenantId: "org-1",
  });
  app = await buildApi({
    ownerToken,
    logger: false,
    auth: {
      mode: "oidc",
      issuer,
      audience,
      webClientId: "draft-loop-web",
      allowHttp: false,
      resolveSignIn: async () => ({ tenantId: "org-1", memberId: "member-1", role: "admin" }),
      keys: createLocalJWKSet({ keys: [publicJwk] }),
    },
    tenants: {
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      applicationFor: () => ({
        service,
        workspaceRoot: (workspaceId) => `/tenants/org-1/workspaces/${workspaceId}`,
        enqueueRun: async () => undefined,
        monthUsage: async () => [],
        consents: { current: async () => state } as unknown as ConsentLedger,
        knowledgeIntake: {} as TenantApplication["knowledgeIntake"],
        knowledgeStore: { id: "knowledge", reference: "knowledge" },
        sensitivityRules: {} as TenantApplication["sensitivityRules"],
        recordArchives: {} as TenantApplication["recordArchives"],
        workJournal: journal,
      }),
      recordAccessFor: () =>
        ({
          listRecords: async () => ["ws-1"],
          listMemberRecords: async () => [{ workspaceId: "ws-1" }],
        }) as unknown as CandidateRecordAccess,
      knowledgeOwnersFor: () =>
        ({
          ownerOf: async (id: string) =>
            ({ "kb-own": "ws-1", "kb-other": "ws-2" })[id] ?? undefined,
          basesOwnedBy: async () => ["kb-own"],
        }) as unknown as KnowledgeBaseOwners,
      entitlementsFor: () => ({
        entitlements: async () => entitlements,
        assignment: vi.fn(),
        ledger: { reserve: vi.fn(), refund: vi.fn(), balance: vi.fn() },
      }),
    },
  });
  return app;
}

async function call(
  api: FastifyInstance,
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: object,
) {
  return api.inject({
    method,
    url,
    headers: await person(),
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

describe("work journal in sign-in mode (#2783)", () => {
  it("lets a member turn intake on and keep a note with storage consent", async () => {
    const api = await signInApi({ storage: true });

    const read = await call(api, "GET", intake);
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ enabled: false, agent_tokens: false });
    expect((await call(api, "PUT", intake, { enabled: true })).json().enabled).toBe(true);
    const recorded = await call(api, "POST", notes, note);
    expect(recorded.statusCode).toBe(201);
    expect(recorded.json().status).toBe("pending");
    const listed = await call(api, "GET", `${notes}?status=pending`);
    expect(listed.json().notes).toHaveLength(1);
  });

  it("refuses to turn intake on or keep a note without the record's storage consent", async () => {
    const api = await signInApi({ storage: false });

    const on = await call(api, "PUT", intake, { enabled: true });
    expect(on.statusCode).toBe(409);
    expect(on.json().error.code).toBe("storage_consent_required");
    expect((await call(api, "PUT", intake, { enabled: false })).statusCode).toBe(200);
    const recorded = await call(api, "POST", notes, note);
    expect(recorded.statusCode).toBe(409);
    expect(recorded.json().error.code).toBe("storage_consent_required");
  });

  it("approves a note only into a base the same record owns", async () => {
    const api = await signInApi({ storage: true });
    await call(api, "PUT", intake, { enabled: true });
    const noteId = (await call(api, "POST", notes, note)).json().note_id as string;
    const review = (knowledgeBaseId: string) =>
      call(api, "POST", `${notes}/${noteId}/review`, {
        action: "approve",
        knowledge_base_id: knowledgeBaseId,
      });

    for (const base of ["kb-other", "kb-unknown"]) {
      const refused = await review(base);
      expect(refused.statusCode, base).toBe(404);
      expect(refused.json().error.code, base).toBe("knowledge_base_not_found");
    }
    // The base passes the checks; this stub server has nowhere to publish, which the route says.
    expect((await review("kb-own")).json().error.code).not.toBe("knowledge_base_not_found");
  });
});
