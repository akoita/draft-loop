import { type ApplicationService, HostedKnowledgeIntakeError } from "@draft-loop/application";
import { type ConsentLedger, permitsMaterialStorage } from "@draft-loop/storage/consent-ledger";
import type { FastifyRequest } from "fastify";

import { consentRecordId } from "./consent-routes.js";
import { ConsentRequiredError } from "./errors.js";
import type { KnowledgeOwnersFor } from "./knowledge-access.js";

/**
 * The work journal's checks in sign-in mode (#2783). Record access has already refused a
 * workspace the member does not reach; these add what ADR 0011, D7 asks of stored material: a
 * note is kept, and intake turned on, only with the record's `material-storage` consent, and an
 * approved note goes only into a knowledge base the same record owns.
 */
export interface WorkJournalSignInChecks {
  /** Throws `storage_consent_required` (409) without the record's material-storage consent. */
  requireStorageConsent(workspaceId: string): Promise<void>;
  /** Throws `knowledge_base_not_found` (404) unless the workspace's record owns the base. */
  requireOwnedBase(
    request: FastifyRequest,
    workspaceId: string,
    knowledgeBaseId: string,
  ): Promise<void>;
}

export interface WorkJournalSignInOptions {
  /** The caller's tenant's application, bound to the request like the routes' own. */
  readonly service: Pick<ApplicationService, "readWorkspace">;
  readonly workspaceRoot: (workspaceId: string) => string;
  /** The caller's tenant's consent ledger, bound like the service. */
  readonly consents: Pick<ConsentLedger, "current">;
  readonly knowledgeOwnersFor: KnowledgeOwnersFor;
}

export function createWorkJournalSignInChecks(
  options: WorkJournalSignInOptions,
): WorkJournalSignInChecks {
  const { service, workspaceRoot, consents, knowledgeOwnersFor } = options;
  return {
    requireStorageConsent: async (workspaceId) => {
      const state = await consents.current(
        await consentRecordId(service, workspaceRoot, workspaceId),
      );
      if (!permitsMaterialStorage(state))
        throw new ConsentRequiredError("storage_consent_required");
    },
    requireOwnedBase: async (request, workspaceId, knowledgeBaseId) => {
      const { caller } = request;
      const owner =
        caller?.kind === "member"
          ? await knowledgeOwnersFor(caller.tenantId).ownerOf(knowledgeBaseId)
          : undefined;
      if (owner !== workspaceId) {
        throw new HostedKnowledgeIntakeError("knowledge_base_not_found", "No such knowledge base.");
      }
    },
  };
}
