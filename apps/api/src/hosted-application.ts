import {
  createApplicationService,
  createHostedApplicationDriver,
  createHostedKnowledgeIntake,
  createHostedSensitivityRules,
  type RunBudgetCeiling,
  withRunBudgetDefaults,
} from "@draft-loop/application";
import { openRunQueue } from "@draft-loop/run-queue";
import type { BlobStoragePort } from "@draft-loop/storage";
import {
  createGcsBlobErasure,
  createGcsBlobStorage,
  gcsTenantPrefix,
} from "@draft-loop/storage-gcs";
import {
  hostedApplicationPorts,
  hostedKnowledgeStoreReference,
  hostedWorkspaceReference,
  openPostgresRecordArchives,
  openPostgresTenancy,
  type PostgresTenancy,
  type PostgresTenantStorage,
} from "@draft-loop/storage-postgres";
import { Storage } from "@google-cloud/storage";

import type { BriefExtractions } from "./brief-extraction.js";
import type { HostedStorageConfig } from "./config.js";
import {
  type ContentScreeningSetup,
  createHostedContentScreening,
  rulesScreeningSetup,
} from "./content-screening-service.js";
import type { TenantEntitlementsFor } from "./entitlement-gate.js";
import type { OperatorTenantFor } from "./operator-plan-routes.js";
import { createPostgresIdempotencyStore } from "./postgres-idempotency.js";
import type { ProfileDerivations } from "./profile-routes.js";
import { apiProviderOptions } from "./provider-boundary.js";
import type { TenantApplication, TenantApplications } from "./tenant-context.js";
import { enqueueThenWake, noWake, type WakeWorker } from "./worker-wake.js";

/** The tenant's one candidate knowledge store: knowledge bases belong to the tenant. */
export const hostedKnowledgeStoreId = "knowledge";

export interface HostedTenants {
  readonly tenants: TenantApplications;
  readonly close: () => Promise<void>;
}

export interface HostedApplicationParts {
  /** One tenant's storage ports; the application borrows them. */
  readonly storage: PostgresTenantStorage;
  readonly blobs: BlobStoragePort;
  readonly tenantId: string;
  readonly budgetCeiling: RunBudgetCeiling;
  readonly enqueueRun: (workspaceId: string, runId: string) => Promise<void>;
  /** The worker's extraction of live briefs; a live brief is left for the person without it. */
  readonly briefExtractions?: BriefExtractions;
  /** The worker's derivation of career profiles; a derivation start answers 503 without it. */
  readonly profileDerivations?: ProfileDerivations;
  /** Where a knowledge source version's bytes go in `blobs`. */
  readonly knowledgeLocation: (versionId: string) => string;
  readonly maxSourceBytes?: number;
  /** What the tenant's uploads and job sources are screened with; the rule screener when unset. */
  readonly screening?: ContentScreeningSetup;
}

/**
 * The API's application over one tenant's storage and blobs: the shared hosted driver with no
 * provider wiring, the tenant's knowledge intake and its one store. The server and the API's
 * Postgres tests both build it here.
 */
export function composeHostedApplication(
  parts: HostedApplicationParts,
): TenantApplication & { readonly budgetCeiling: RunBudgetCeiling } {
  const { storage, blobs, tenantId, budgetCeiling } = parts;
  const ports = hostedApplicationPorts({ storage, tenantId, blobs });
  const service = createApplicationService(
    createHostedApplicationDriver({
      ...ports,
      settings: withRunBudgetDefaults(ports.settings, budgetCeiling),
      local: apiProviderOptions(),
    }),
  );
  return {
    service,
    workspaceRoot: (workspaceId) => hostedWorkspaceReference(tenantId, workspaceId),
    enqueueRun: parts.enqueueRun,
    ...(parts.briefExtractions === undefined ? {} : { briefExtractions: parts.briefExtractions }),
    ...(parts.profileDerivations === undefined
      ? {}
      : { profileDerivations: parts.profileDerivations }),
    budgetCeiling,
    monthUsage: storage.monthUsage,
    idempotency: createPostgresIdempotencyStore({ keys: storage.idempotencyKeys }),
    knowledgeIntake: createHostedKnowledgeIntake({
      records: storage,
      blobs,
      storeId: hostedKnowledgeStoreId,
      locate: parts.knowledgeLocation,
      ...(parts.maxSourceBytes === undefined ? {} : { maxSourceBytes: parts.maxSourceBytes }),
    }),
    sensitivityRules: createHostedSensitivityRules({
      records: storage,
      storeId: hostedKnowledgeStoreId,
    }),
    consents: storage.consentLedger,
    contentScreening: createHostedContentScreening({
      store: storage.contentScreening,
      tenantId,
      setup: parts.screening ?? rulesScreeningSetup(),
    }),
    recordArchives: openPostgresRecordArchives({ storage, tenantId, blobs }),
    knowledgeStore: {
      id: hostedKnowledgeStoreId,
      reference: hostedKnowledgeStoreReference(tenantId, hostedKnowledgeStoreId),
    },
  };
}

/** Where a tenant's knowledge source version's bytes go in the shared bucket. */
export function hostedKnowledgeLocation(tenantId: string, versionId: string): string {
  return `tenants/${tenantId}/knowledge/${hostedKnowledgeStoreId}/${versionId}`;
}

/** The operator's reach into any organisation: its plan, its credit ledger and its keys. */
export function hostedOperatorFor(tenancy: PostgresTenancy): OperatorTenantFor {
  return (organisationId) => {
    const storage = tenancy.forTenant(organisationId);
    return {
      plans: storage.organisationPlans,
      ledger: storage.creditLedger,
      idempotency: createPostgresIdempotencyStore({ keys: storage.idempotencyKeys }),
    };
  };
}

/** The organisation's plan entitlements and credit ledger, which a run start is checked against. */
export function hostedEntitlementsFor(tenancy: PostgresTenancy): TenantEntitlementsFor {
  return (tenantId) => {
    const storage = tenancy.forTenant(tenantId);
    return {
      entitlements: storage.organisationPlans.currentEntitlements,
      assignment: storage.organisationPlans.currentPlanAssignment,
      ledger: storage.creditLedger,
    };
  };
}

/**
 * Opens what every tenant's application shares: one Postgres pool, one run queue and one Cloud
 * Storage bucket (ADR 0011, D3). Each tenant's application is composed on its first request over
 * the pool set to that tenant and the bucket under that tenant's prefix. Credentials come from the
 * runtime: the database URL from a secret and Cloud Storage from the service account, or the
 * emulator on the local stack. It holds no provider credential: only the worker calls models.
 */
export async function openHostedTenants(
  config: HostedStorageConfig,
  budgetCeiling: RunBudgetCeiling,
  worker: { readonly wake: WakeWorker; readonly onWakeError: (error: unknown) => void } = {
    wake: noWake,
    onWakeError: () => undefined,
  },
  screening: ContentScreeningSetup = rulesScreeningSetup(),
): Promise<HostedTenants> {
  const tenancy = await openPostgresTenancy({
    connectionString: config.databaseUrl,
    schema: config.databaseSchema,
  });
  try {
    const queue = await openRunQueue({
      connectionString: config.databaseUrl,
      schema: config.queueSchema,
    });
    const bucket = new Storage(
      config.gcsEndpoint === undefined
        ? {}
        : { apiEndpoint: config.gcsEndpoint, projectId: "draft-loop-local" },
    ).bucket(config.blobBucket);
    return {
      tenants: {
        budgetCeiling,
        ...(config.tenantId === undefined ? {} : { ownerTenantId: config.tenantId }),
        ...(config.maxSourceBytes === undefined ? {} : { maxSourceBytes: config.maxSourceBytes }),
        recordAccessFor: (tenantId) => tenancy.forTenant(tenantId).candidateRecords,
        knowledgeOwnersFor: (tenantId) => tenancy.forTenant(tenantId).knowledgeBaseOwners,
        erasureFor: (tenantId) => ({
          records: tenancy.forTenant(tenantId).recordErasure,
          blobs: createGcsBlobErasure({ bucket, tenantId }),
          organisation: tenancy.forTenant(tenantId).organisationErasure,
          objectPrefix: gcsTenantPrefix(tenantId),
        }),
        operatorFor: hostedOperatorFor(tenancy),
        entitlementsFor: hostedEntitlementsFor(tenancy),
        applicationFor: (tenantId) =>
          composeHostedApplication({
            storage: tenancy.forTenant(tenantId),
            blobs: createGcsBlobStorage({ bucket, tenantId }),
            tenantId,
            budgetCeiling,
            enqueueRun: enqueueThenWake(
              (workspaceId, runId) => queue.enqueue({ tenantId, workspaceId, runId }),
              worker.wake,
              worker.onWakeError,
            ),
            briefExtractions: {
              // Queued, then the worker woken as for a run; a wake failure only delays it.
              queue: async (job) => {
                await queue.enqueueBriefExtraction({ tenantId, ...job });
                await worker.wake().catch(worker.onWakeError);
                return true;
              },
              state: (version) => queue.briefExtractionState({ tenantId, ...version }),
            },
            profileDerivations: {
              // Queued, then the worker woken as for a run; a wake failure only delays it.
              queue: async (job) => {
                const queued = await queue.enqueueProfileDerivation({ tenantId, ...job });
                if (queued) await worker.wake().catch(worker.onWakeError);
                return queued;
              },
              state: (address) => queue.profileDerivationState({ tenantId, ...address }),
              cancel: (address) => queue.cancelProfileDerivation({ tenantId, ...address }),
            },
            knowledgeLocation: (versionId) => hostedKnowledgeLocation(tenantId, versionId),
            screening,
            ...(config.maxSourceBytes === undefined
              ? {}
              : { maxSourceBytes: config.maxSourceBytes }),
          }),
      },
      close: async () => {
        await queue.close();
        await tenancy.close();
      },
    };
  } catch (error) {
    await tenancy.close();
    throw error;
  }
}
