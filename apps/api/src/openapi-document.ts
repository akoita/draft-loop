import type {
  ApplicationService,
  HostedKnowledgeIntake,
  HostedSensitivityRules,
} from "@draft-loop/application";
import type { CandidateRecordAccess } from "@draft-loop/storage/candidate-records";
import type { ConsentLedger } from "@draft-loop/storage/consent-ledger";
import type { RecordArchives } from "@draft-loop/storage/record-archive";
import type { TenantDirectory } from "@draft-loop/storage/tenant-directory";

import { buildApi } from "./app.js";

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
      }),
    },
    directory: {} as TenantDirectory,
  });
  try {
    await app.ready();
    return `${JSON.stringify(app.swagger(), null, 2)}\n`;
  } finally {
    await app.close();
  }
}
