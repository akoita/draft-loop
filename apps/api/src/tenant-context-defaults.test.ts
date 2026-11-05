import {
  type ApplicationService,
  defaultHostedKnowledgeSourceMaxBytes,
  type HostedKnowledgeIntake,
} from "@draft-loop/application";
import { WorkJournalError, type WorkJournalService } from "@draft-loop/application/work-journal";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { IdempotencyStore } from "./idempotency.js";
import { ProfileDerivationUnavailableError } from "./profile-errors.js";
import {
  type ApiApplication,
  registerTenantApplications,
  type TenantApplication,
  TenantContextMissingError,
} from "./tenant-context.js";

const budgetCeiling = { maxRounds: 3, maxCostUsd: 3, maxDurationMs: 1_800_000 };

/** A stand-in tenant application with none of the optional services. */
function bareApplication(tenantId: string): TenantApplication {
  return {
    service: {} as ApplicationService,
    workspaceRoot: (workspaceId) => `${tenantId}/${workspaceId}`,
    enqueueRun: vi.fn(async () => undefined),
    monthUsage: async () => [],
    knowledgeIntake: {
      listKnowledgeBases: async () => [],
    } as unknown as HostedKnowledgeIntake,
    knowledgeStore: { id: "knowledge", reference: `${tenantId}/knowledge` },
    sensitivityRules: {} as TenantApplication["sensitivityRules"],
    consents: {} as TenantApplication["consents"],
    recordArchives: {} as TenantApplication["recordArchives"],
  };
}

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/**
 * A server whose every request is a member of `org-a` and runs `check` against the tenant-bound
 * application; it answers what `check` returns, or the error's name and code.
 */
function tenantServer(
  applicationFor: (tenantId: string) => TenantApplication,
  check: (application: ApiApplication) => Promise<unknown>,
  maxSourceBytes?: number,
) {
  const server = Fastify();
  server.decorateRequest("caller", undefined);
  server.addHook("onRequest", async (request) => {
    request.caller = { kind: "member", tenantId: "org-a", memberId: "member-1", role: "member" };
  });
  const application = registerTenantApplications(server, {
    budgetCeiling,
    applicationFor,
    ...(maxSourceBytes === undefined ? {} : { maxSourceBytes }),
  });
  server.get("/check", async () => {
    try {
      return { result: await check(application) };
    } catch (error) {
      const { name, code } = error as { name: string; code?: string };
      return { error: { name, code } };
    }
  });
  app = server;
  return { server, application };
}

async function run(server: FastifyInstance): Promise<unknown> {
  return (await server.inject({ url: "/check" })).json();
}

describe("registerTenantApplications defaults", () => {
  it("refuses a tenant cache without a positive whole size", () => {
    for (const cacheSize of [0, -1, 1.5]) {
      expect(() =>
        registerTenantApplications(Fastify(), {
          budgetCeiling,
          applicationFor: bareApplication,
          cacheSize,
        }),
      ).toThrow(RangeError);
    }
  });

  it("screens nothing and queues no brief for a tenant composed without them", async () => {
    const { server } = tenantServer(bareApplication, async (application) => ({
      screening: application.contentScreening?.mode,
      briefQueued: await application.briefExtractions?.queue({} as never),
    }));

    expect(await run(server)).toEqual({ result: { screening: "off", briefQueued: false } });
  });

  it("refuses profile derivation for a tenant composed without a queue", async () => {
    const { server } = tenantServer(bareApplication, async (application) =>
      application.profileDerivations?.queue({} as never),
    );

    expect(await run(server)).toEqual({
      error: { name: new ProfileDerivationUnavailableError().name },
    });
  });

  it("refuses every work journal call as unavailable for a tenant composed without one", async () => {
    const calls: (keyof WorkJournalService)[] = [
      "record",
      "list",
      "listFull",
      "get",
      "review",
      "intake",
      "setIntake",
    ];
    const { server } = tenantServer(bareApplication, async (application) => {
      const journal = application.workJournal as unknown as Record<string, () => Promise<unknown>>;
      const codes = [];
      for (const call of calls) {
        codes.push(
          await journal[call]?.().then(
            () => "answered",
            (error: unknown) =>
              error instanceof WorkJournalError ? error.code : "unexpected error",
          ),
        );
      }
      return codes;
    });

    expect(await run(server)).toEqual({ result: calls.map(() => "approval_unavailable") });
  });

  it("fails closed when a tenant composed without source evidence kinds is asked for them", async () => {
    const { server } = tenantServer(bareApplication, async (application) =>
      Reflect.get(application.sourceEvidenceKinds as object, "kinds"),
    );

    expect(await run(server)).toEqual({ error: { name: new TenantContextMissingError().name } });
  });

  it("forwards to the tenant's own optional services when it has them", async () => {
    const once = vi.fn(async () => "own-result");
    const own = { once } as unknown as IdempotencyStore;
    const journal = { list: async () => ["note-1"] } as unknown as WorkJournalService;
    const { server } = tenantServer(
      (tenantId) => ({
        ...bareApplication(tenantId),
        idempotency: own,
        workJournal: journal,
        sourceEvidenceKinds: { kinds: ["placeholder-kind"] } as never,
      }),
      async (application) => ({
        once: await application.idempotency?.once("scope", "key", {}, async () => "fresh"),
        notes: await application.workJournal?.list({} as never),
        kinds: Reflect.get(application.sourceEvidenceKinds as object, "kinds"),
      }),
    );

    expect(await run(server)).toEqual({
      result: { once: "own-result", notes: ["note-1"], kinds: ["placeholder-kind"] },
    });
    expect(once).toHaveBeenCalledWith("scope", "key", {}, expect.any(Function));
  });

  it("forwards runs, stores and property checks to the tenant, and fixes the source size limit", async () => {
    const applications = new Map<string, TenantApplication>();
    const applicationFor = (tenantId: string) => {
      const application = bareApplication(tenantId);
      applications.set(tenantId, application);
      return application;
    };
    const { server, application } = tenantServer(applicationFor, async (bound) => {
      await bound.enqueueRun("workspace-1", "run-1");
      const intake = bound.knowledgeIntake as object;
      return {
        hasList: "listKnowledgeBases" in intake,
        hasMissing: "missingMethod" in intake,
        store: bound.knowledgeStore?.reference,
        stores: [bound.sensitivityRules, bound.consents, bound.recordArchives].map(
          (forwarded) => "placeholderMethod" in (forwarded as object),
        ),
      };
    });

    // Routes read the limit as they are registered, outside any request.
    expect(application.knowledgeIntake?.maxSourceBytes).toBe(defaultHostedKnowledgeSourceMaxBytes);
    expect(await run(server)).toEqual({
      result: {
        hasList: true,
        hasMissing: false,
        store: "org-a/knowledge",
        stores: [false, false, false],
      },
    });
    expect(applications.get("org-a")?.enqueueRun).toHaveBeenCalledWith("workspace-1", "run-1");
  });

  it("fixes the deployment's own source size limit when it sets one", () => {
    const { application } = tenantServer(bareApplication, async () => undefined, 2_048);

    expect(application.knowledgeIntake?.maxSourceBytes).toBe(2_048);
  });
});
