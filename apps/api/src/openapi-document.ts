import type {
  ApplicationService,
  HostedKnowledgeIntake,
  HostedSensitivityRules,
} from "@draft-loop/application";
import type { AgentConnectionCapStore } from "@draft-loop/storage/agent-connection-caps";
import type { AgentTokenStore } from "@draft-loop/storage/agent-tokens";
import type { CandidateRecordAccess } from "@draft-loop/storage/candidate-records";
import type { ConsentLedger } from "@draft-loop/storage/consent-ledger";
import type { FeedbackStore } from "@draft-loop/storage/feedback";
import type { MemberSettingsStore } from "@draft-loop/storage/member-settings";
import type { ReadableRecordExports, RecordArchives } from "@draft-loop/storage/record-archive";
import type { RunSpanStore } from "@draft-loop/storage/run-spans";
import type { TenantDirectory } from "@draft-loop/storage/tenant-directory";
import type {
  BetaInvites,
  BetaWaitlist,
  CreditPurchases,
  RecordNames,
} from "@draft-loop/storage-postgres";
import { buildApi } from "./app.js";
import type { TenantEntitlements } from "./entitlement-gate.js";
import type { OperatorTenant } from "./operator-plan-routes.js";
import type { PaymentEventsPort } from "./payment-checkout.js";
import type { TenantErasure } from "./record-erasure-routes.js";
import { readSupportSettings } from "./support-config.js";

/** The committed OpenAPI document, which the drift test keeps equal to the generated one. */
export const openApiDocumentPath = new URL("../openapi.json", import.meta.url);

/**
 * Generates the OpenAPI document of every route. Routes are registered but never called, so the
 * tenant's application and record access are stand-ins.
 */
export async function generateOpenApiDocument(): Promise<string> {
  const app = await buildApi({
    ownerToken: "openapi-generation-token-0123456789abcdef",
    tenants: {
      budgetCeiling: { maxRounds: 1, maxCostUsd: 1, maxDurationMs: 1 },
      recordAccessFor: () => ({}) as CandidateRecordAccess,
      erasureFor: () => ({}) as TenantErasure,
      operatorFor: () => ({}) as OperatorTenant,
      ownerTenantId: "openapi-owner",
      agentTokensFor: () => ({}) as AgentTokenStore,
      agentConnectionCapsFor: () => ({}) as AgentConnectionCapStore,
      runSpansFor: () => ({}) as RunSpanStore,
      creditPurchasesFor: () => ({}) as CreditPurchases,
      recordNamesFor: () => ({}) as RecordNames,
      entitlementsFor: () => ({}) as TenantEntitlements,
      applicationFor: () => ({
        service: {} as ApplicationService,
        workspaceRoot: (workspaceId) => workspaceId,
        enqueueRun: async () => undefined,
        monthUsage: async () => [],
        knowledgeIntake: {} as HostedKnowledgeIntake,
        knowledgeStore: { id: "knowledge", reference: "/knowledge" },
        sensitivityRules: {} as HostedSensitivityRules,
        consents: {} as ConsentLedger,
        recordArchives: {} as RecordArchives,
        readableExports: {} as ReadableRecordExports,
      }),
    },
    directory: {} as TenantDirectory,
    memberSettings: {} as MemberSettingsStore,
    betaInvites: {
      invites: {} as BetaInvites,
      cap: 0,
      prepareInvitedAccount: async () => "exists",
    },
    betaWaitlist: {} as BetaWaitlist,
    feedback: {} as FeedbackStore,
    support: readSupportSettings({}),
    paymentEvents: {} as PaymentEventsPort,
  });
  try {
    await app.ready();
    return `${JSON.stringify(app.swagger(), null, 2)}\n`;
  } finally {
    await app.close();
  }
}
