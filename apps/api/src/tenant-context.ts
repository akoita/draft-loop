import { AsyncLocalStorage } from "node:async_hooks";

import {
  defaultHostedKnowledgeSourceMaxBytes,
  type RunBudgetCeiling,
} from "@draft-loop/application";
import type { FastifyInstance } from "fastify";

import type { ApiOptions } from "./app.js";
import { noBriefExtractions } from "./brief-extraction.js";
import { noContentScreening } from "./content-screening-service.js";
import type { TenantEntitlementsFor } from "./entitlement-gate.js";
import { createMemoryIdempotencyStore, type IdempotencyStore } from "./idempotency.js";
import type { KnowledgeOwnersFor } from "./knowledge-access.js";
import type { OperatorTenantFor } from "./operator-plan-routes.js";
import type { RecordAccessFor } from "./record-access.js";
import type { TenantErasureFor } from "./record-erasure-routes.js";
import type { Caller } from "./request-auth.js";

/** The application the routes serve: one tenant's, or one that dispatches to the caller's. */
export type ApiApplication = NonNullable<ApiOptions["application"]>;

/** One tenant's application: every route's dependencies, bound to that tenant's data. */
export type TenantApplication = Required<
  Omit<ApiApplication, "budgetCeiling" | "idempotency" | "contentScreening" | "briefExtractions">
> &
  Pick<ApiApplication, "idempotency" | "contentScreening" | "briefExtractions">;

/** How the API serves many tenants over shared pools (ADR 0011, D3 and D6). */
export interface TenantApplications {
  /** The most one run may spend, the same for every tenant of the deployment. */
  readonly budgetCeiling: RunBudgetCeiling;
  /** The largest source file a tenant may upload, the same for every tenant; intake's default when unset. */
  readonly maxSourceBytes?: number;
  /** The tenant the owner token acts in; without it an owner request reaches no tenant's data. */
  readonly ownerTenantId?: string;
  /** Composes a tenant's application; called again only after the cache drops it. */
  readonly applicationFor: (tenantId: string) => TenantApplication;
  /** How many tenants' applications stay composed; the least recently used goes first. */
  readonly cacheSize?: number;
  /**
   * Which members may reach which of a tenant's candidate records. Sign-in mode needs it to serve
   * workspaces; it also serves `GET /v1/workspaces` in both modes.
   */
  readonly recordAccessFor?: RecordAccessFor;
  /** Which candidate record owns each of a tenant's knowledge bases; sign-in mode needs it. */
  readonly knowledgeOwnersFor?: KnowledgeOwnersFor;
  /**
   * Erases a tenant's candidate records and the tenant itself; without it neither
   * `DELETE /v1/workspaces/:id` nor the organisation deletions are served.
   */
  readonly erasureFor?: TenantErasureFor;
  /**
   * Reaches any organisation's plan, credit ledger and idempotency keys for the operator's routes;
   * without it those routes are not served.
   */
  readonly operatorFor?: OperatorTenantFor;
  /**
   * Reaches a tenant's plan entitlements and credit ledger, which a run start is checked against.
   * Sign-in mode requires it; owner-token mode never reads it, since its tenant has no
   * organisation to hold a plan or a ledger.
   */
  readonly entitlementsFor?: TenantEntitlementsFor;
}

export const defaultTenantCacheSize = 100;

/** A route ran with no tenant bound to its request: it fails rather than guess one. */
export class TenantContextMissingError extends Error {
  override readonly name = "TenantContextMissingError";
  constructor() {
    super("The request has no tenant.");
  }
}

/** The tenant a caller acts in: a member's organisation, or the owner token's tenant. */
export function tenantIdOf(
  caller: Caller | undefined,
  ownerTenantId: string | undefined,
): string | undefined {
  if (caller === undefined) return undefined;
  return caller.kind === "member" ? caller.tenantId : ownerTenantId;
}

/** Keeps the most recently used values up to `size`, dropping the least recently used. */
function leastRecentlyUsed<Value>(size: number, create: (key: string) => Value) {
  if (!Number.isInteger(size) || size < 1) throw new RangeError("The cache needs a size of 1+.");
  const entries = new Map<string, Value>();
  return (key: string): Value => {
    const existing = entries.get(key);
    if (existing !== undefined) {
      // Map order is insertion order: re-inserting marks the entry as the newest.
      entries.delete(key);
      entries.set(key, existing);
      return existing;
    }
    const created = create(key);
    entries.set(key, created);
    if (entries.size > size) {
      const oldest = entries.keys().next().value;
      if (oldest !== undefined) entries.delete(oldest);
    }
    return created;
  };
}

/**
 * An object whose every read goes to the value `current` returns at that moment, except the
 * `fixed` properties, which routes read once as they are registered, outside any request.
 */
function forwarding<Target extends object>(
  current: () => Target,
  fixed: Partial<Target> = {},
): Target {
  return new Proxy({} as Target, {
    get: (_target, property) => {
      if (Object.hasOwn(fixed, property)) return Reflect.get(fixed, property);
      const target = current();
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    has: (_target, property) => Reflect.has(current(), property),
  });
}

/** Scopes a shared store's keys by tenant, so one tenant's key never replays another's result. */
function tenantIdempotency(shared: IdempotencyStore, tenantId: string): IdempotencyStore {
  return {
    once: (scope, key, request, produce) =>
      shared.once(`${tenantId}\u0000${scope}`, key, request, produce),
  };
}

/**
 * Serves each request from its caller's tenant. A `preHandler` hook, which runs after sign-in and
 * body parsing, binds the caller's tenant application to the request's async context; the
 * returned application forwards every call to it. A route that runs with no tenant bound throws,
 * so no request ever falls back to another tenant's data.
 */
export function registerTenantApplications(
  app: FastifyInstance,
  tenants: TenantApplications,
): ApiApplication {
  const context = new AsyncLocalStorage<TenantApplication & { idempotency: IdempotencyStore }>();
  // Only for applications without a store of their own, such as in tests without Postgres.
  const sharedIdempotency = createMemoryIdempotencyStore();
  const applicationFor = leastRecentlyUsed(
    tenants.cacheSize ?? defaultTenantCacheSize,
    (tenantId) => {
      const application = tenants.applicationFor(tenantId);
      return {
        ...application,
        idempotency: application.idempotency ?? tenantIdempotency(sharedIdempotency, tenantId),
      };
    },
  );

  app.addHook("preHandler", (request, reply, done) => {
    const tenantId = tenantIdOf(request.caller, tenants.ownerTenantId);
    if (tenantId === undefined) {
      done();
      return;
    }
    // Content-free: the tenant and member ids, never an email or token.
    const log = request.log.child({
      tenantId,
      ...(request.caller?.kind === "member" ? { memberId: request.caller.memberId } : {}),
    });
    request.log = log;
    reply.log = log;
    context.run(applicationFor(tenantId), done);
  });

  const current = () => {
    const application = context.getStore();
    if (application === undefined) throw new TenantContextMissingError();
    return application;
  };
  return {
    service: forwarding(() => current().service),
    workspaceRoot: (workspaceId) => current().workspaceRoot(workspaceId),
    idempotency: {
      once: async (scope, key, request, produce) =>
        current().idempotency.once(scope, key, request, produce),
    },
    enqueueRun: async (workspaceId, runId) => current().enqueueRun(workspaceId, runId),
    budgetCeiling: tenants.budgetCeiling,
    monthUsage: async (month) => current().monthUsage(month),
    knowledgeIntake: forwarding(() => current().knowledgeIntake, {
      maxSourceBytes: tenants.maxSourceBytes ?? defaultHostedKnowledgeSourceMaxBytes,
    }),
    knowledgeStore: forwarding(() => current().knowledgeStore),
    sensitivityRules: forwarding(() => current().sensitivityRules),
    consents: forwarding(() => current().consents),
    recordArchives: forwarding(() => current().recordArchives),
    // An application composed without screening holds none, so nothing is quarantined.
    contentScreening: forwarding(() => current().contentScreening ?? noContentScreening),
    // An application composed without a queue extracts nothing on the worker.
    briefExtractions: forwarding(() => current().briefExtractions ?? noBriefExtractions),
  };
}
