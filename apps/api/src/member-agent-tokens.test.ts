import type { ApplicationService, WorkspaceDescriptor } from "@draft-loop/application";
import { createWorkJournalService } from "@draft-loop/application/work-journal";
import { resolveEntitlements } from "@draft-loop/schemas/entitlements";
import { createMemoryAgentTokenStore } from "@draft-loop/storage/agent-tokens";
import type { CandidateRecordAccess } from "@draft-loop/storage/candidate-records";
import type { ConsentLedger, ConsentState } from "@draft-loop/storage/consent-ledger";
import type { KnowledgeBaseOwners } from "@draft-loop/storage/knowledge-base-owners";
import type { MemberRecord, TenantDirectory } from "@draft-loop/storage/tenant-directory";
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
const tokenStores = {
  "org-1": createMemoryAgentTokenStore(),
  "org-2": createMemoryAgentTokenStore(),
};
let members: MemberRecord[];
const activeMember: MemberRecord = {
  organisationId: "org-1",
  memberId: "member-1",
  email: "ada@example.test",
  role: "admin",
  status: "active",
  invitedAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

async function signInApi(consent: { storage: boolean }): Promise<FastifyInstance> {
  members = [activeMember];
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
    directory: {
      listMembers: async (organisationId: string) =>
        members.filter((member) => member.organisationId === organisationId),
    } as unknown as TenantDirectory,
    tenants: {
      agentTokensFor: (tenantId) => tokenStores[tenantId as "org-1" | "org-2"],
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

const tokens = "/v1/workspaces/ws-1/agent-tokens";

async function issue(api: FastifyInstance, scopes: string[] = ["journal"]) {
  const issued = await call(api, "POST", tokens, { label: "Claude Code", scopes });
  expect(issued.statusCode).toBe(201);
  return issued.json() as { id: string; token: string };
}

function withToken(
  api: FastifyInstance,
  token: string,
  method: "GET" | "POST",
  url: string,
  payload?: object,
) {
  return api.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

describe("agent tokens for signed-in members (#2784)", () => {
  it("issues a member's token that names its tenant and records notes as that member", async () => {
    const api = await signInApi({ storage: true });
    expect((await call(api, "GET", intake)).json().agent_tokens).toBe(true);
    await call(api, "PUT", intake, { enabled: true });
    const { id, token } = await issue(api);

    expect(token).toMatch(/^dlagent_[A-Za-z0-9_-]{43}\.org-1$/u);
    const recorded = await withToken(api, token, "POST", notes, note);
    expect(recorded.statusCode).toBe(201);
    const listed = await call(api, "GET", tokens);
    expect(listed.json().tokens).toEqual([expect.objectContaining({ id, active: true })]);
    // A token never reaches its own settings.
    expect((await withToken(api, token, "GET", tokens)).statusCode).toBe(403);
    expect(
      (await withToken(api, token, "GET", "/v1/workspaces/ws-2/work-journal/notes")).statusCode,
    ).toBe(403);
  });

  it("stops a token once its member leaves, or when it is revoked", async () => {
    const api = await signInApi({ storage: true });
    const first = await issue(api);
    const second = await issue(api);

    members = [];
    expect((await withToken(api, first.token, "GET", notes)).statusCode).toBe(401);
    members = [activeMember];
    expect((await withToken(api, first.token, "GET", notes)).statusCode).toBe(200);
    const revoke = await api.inject({
      method: "DELETE",
      url: `${tokens}/${second.id}`,
      headers: await person(),
    });
    expect(revoke.statusCode).toBe(204);
    expect((await withToken(api, second.token, "GET", notes)).statusCode).toBe(401);
  });

  it("refuses a token that names another tenant or none", async () => {
    const api = await signInApi({ storage: true });
    const { token } = await issue(api);
    const secret = token.slice(0, token.indexOf("."));

    expect((await withToken(api, `${secret}.org-2`, "GET", notes)).statusCode).toBe(401);
    expect((await withToken(api, secret, "GET", notes)).statusCode).toBe(401);
  });
});
