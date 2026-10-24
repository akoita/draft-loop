import type { ApplicationService, HostedKnowledgeIntake } from "@draft-loop/application";
import {
  type ConsentLedger,
  permitsMaterialStorage,
  permitsTransmission,
} from "@draft-loop/storage/consent-ledger";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";

import { consentRecordId } from "./consent-routes.js";
import { ConsentRequiredError } from "./errors.js";
import type { KnowledgeOwnersFor } from "./knowledge-access.js";

export interface ConsentEnforcementOptions {
  /** The caller's tenant's application, bound to the request before these checks run. */
  readonly service: ApplicationService;
  readonly workspaceRoot: (workspaceId: string) => string;
  /** The caller's tenant's consent ledger, bound like the service. */
  readonly consents: ConsentLedger;
  readonly knowledgeOwnersFor: KnowledgeOwnersFor;
  /** The caller's tenant's knowledge intake, bound like the service; uploads need it. */
  readonly knowledgeIntake?: Pick<HostedKnowledgeIntake, "listKnowledgeBases">;
}

/** The upload that stores a candidate's material. */
const storageRoutes: ReadonlySet<string> = new Set([
  "POST /v1/knowledge-bases/:knowledgeBaseId/sources",
]);

/** The routes that queue work for a worker, which sends approved material to the providers. */
const transmissionRoutes: ReadonlySet<string> = new Set([
  "POST /v1/workspaces/:workspaceId/runs",
  "POST /v1/workspaces/:workspaceId/runs/:runId/revision",
  "POST /v1/workspaces/:workspaceId/runs/:runId/resume",
]);

function param(request: FastifyRequest, name: string): string | undefined {
  const value = (request.params as Record<string, unknown> | undefined)?.[name];
  return typeof value === "string" ? value : undefined;
}

function routeKey(method: string, url: string): string {
  return `${method} ${url}`;
}

/**
 * Refuses, in sign-in mode, to store a candidate's material or to queue a provider call without
 * the candidate record's current consent (ADR 0011, D7). An upload needs a `material-storage`
 * grant on the record that owns the base; a base no record owns, reachable only by owners and
 * admins, carries no consent and is refused, while an unknown base keeps the route's 404. Starting a run, a revision or a resume needs a
 * `provider-transmission` grant that names every company the workspace's author and critic models
 * call. A refusal is a 409 with a stable code. The checks are route-level preHandlers, so they run
 * after record and knowledge access have answered 404 for a record the caller does not reach.
 * Owner-token mode does not register this module; there, `DRAFT_LOOP_ALLOW_PROVIDER_DATA` alone
 * decides, and it stays a ceiling above consent in both modes.
 */
export function registerConsentEnforcement(
  app: FastifyInstance,
  options: ConsentEnforcementOptions,
): void {
  const { service, workspaceRoot, consents, knowledgeOwnersFor, knowledgeIntake } = options;

  /** Whether the tenant has the base; an unknown one is left to the route's own 404. */
  const baseExists = async (knowledgeBaseId: string): Promise<boolean> =>
    (await knowledgeIntake?.listKnowledgeBases())?.some((base) => base.id === knowledgeBaseId) ??
    false;

  const requireStorageConsent: preHandlerHookHandler = async (request) => {
    const { caller } = request;
    const knowledgeBaseId = param(request, "knowledgeBaseId");
    if (caller?.kind !== "member" || knowledgeBaseId === undefined) return;
    const owner = await knowledgeOwnersFor(caller.tenantId).ownerOf(knowledgeBaseId);
    if (owner === undefined) {
      if (!(await baseExists(knowledgeBaseId))) return;
      throw new ConsentRequiredError("storage_consent_required");
    }
    const state = await consents.current(await consentRecordId(service, workspaceRoot, owner));
    if (!permitsMaterialStorage(state)) throw new ConsentRequiredError("storage_consent_required");
  };

  const requireTransmissionConsent: preHandlerHookHandler = async (request) => {
    const workspaceId = param(request, "workspaceId");
    if (request.caller?.kind !== "member" || workspaceId === undefined) return;
    // The descriptor's id is the record id the ledger keys by, as `consentRecordId` reads it.
    const workspace = await service.readWorkspace(workspaceRoot(workspaceId));
    const state = await consents.current(workspace.id);
    if (!permitsTransmission(state, workspace)) {
      throw new ConsentRequiredError("transmission_consent_required");
    }
  };

  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    const keys = methods.map((method) => routeKey(method, route.url));
    const check = keys.some((key) => storageRoutes.has(key))
      ? requireStorageConsent
      : keys.some((key) => transmissionRoutes.has(key))
        ? requireTransmissionConsent
        : undefined;
    if (check === undefined) return;
    const existing = route.preHandler;
    route.preHandler =
      existing === undefined
        ? [check]
        : [...(Array.isArray(existing) ? existing : [existing]), check];
  });
}
