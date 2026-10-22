import {
  createApplicationService,
  createHostedApplicationDriver,
  createHostedKnowledgeIntake,
  type RunBudgetCeiling,
  withRunBudgetDefaults,
} from "@draft-loop/application";
import { openRunQueue } from "@draft-loop/run-queue";
import type { BlobStoragePort } from "@draft-loop/storage";
import { createGcsBlobStorage } from "@draft-loop/storage-gcs";
import {
  hostedApplicationPorts,
  hostedKnowledgeStoreReference,
  hostedWorkspaceReference,
  openPostgresStorage,
  type PostgresStorage,
} from "@draft-loop/storage-postgres";
import { Storage } from "@google-cloud/storage";

import type { ApiOptions } from "./app.js";
import type { HostedStorageConfig } from "./config.js";
import { createPostgresIdempotencyStore } from "./postgres-idempotency.js";
import { apiProviderOptions } from "./provider-boundary.js";
import { enqueueThenWake, noWake, type WakeWorker } from "./worker-wake.js";

/** The tenant's one candidate knowledge store: knowledge bases belong to the tenant. */
export const hostedKnowledgeStoreId = "knowledge";

export interface HostedApplication {
  readonly application: NonNullable<ApiOptions["application"]>;
  readonly close: () => Promise<void>;
}

export interface HostedApplicationParts {
  /** One tenant's open storage; the application borrows it. */
  readonly storage: PostgresStorage;
  readonly blobs: BlobStoragePort;
  readonly tenantId: string;
  readonly budgetCeiling: RunBudgetCeiling;
  readonly enqueueRun: (workspaceId: string, runId: string) => Promise<void>;
  /** Where a knowledge source version's bytes go in `blobs`. */
  readonly knowledgeLocation: (versionId: string) => string;
  readonly maxSourceBytes?: number;
}

/**
 * The API's application over one tenant's storage and blobs: the shared hosted driver with no
 * provider wiring, the tenant's knowledge intake and its one store. The server and the API's
 * Postgres tests both build it here.
 */
export function composeHostedApplication(
  parts: HostedApplicationParts,
): NonNullable<ApiOptions["application"]> {
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
    knowledgeStore: {
      id: hostedKnowledgeStoreId,
      reference: hostedKnowledgeStoreReference(tenantId, hostedKnowledgeStoreId),
    },
  };
}

/**
 * Composes the API's application over the tenant's Postgres storage, Cloud Storage bucket and run
 * queue. Credentials come from the runtime: the database URL from a secret and Cloud Storage from
 * the service account, or the emulator on the local stack. It holds no provider credential: only
 * the worker calls models.
 */
export async function openHostedApplication(
  config: HostedStorageConfig,
  budgetCeiling: RunBudgetCeiling,
  worker: { readonly wake: WakeWorker; readonly onWakeError: (error: unknown) => void } = {
    wake: noWake,
    onWakeError: () => undefined,
  },
): Promise<HostedApplication> {
  const { tenantId } = config;
  const storage = await openPostgresStorage({
    connectionString: config.databaseUrl,
    schema: config.databaseSchema,
    tenantId,
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
    const blobs = createGcsBlobStorage({ bucket, tenantId });
    return {
      application: composeHostedApplication({
        storage,
        blobs,
        tenantId,
        budgetCeiling,
        enqueueRun: enqueueThenWake(
          (workspaceId, runId) => queue.enqueue({ tenantId, workspaceId, runId }),
          worker.wake,
          worker.onWakeError,
        ),
        knowledgeLocation: (versionId) =>
          `tenants/${tenantId}/knowledge/${hostedKnowledgeStoreId}/${versionId}`,
        ...(config.maxSourceBytes === undefined ? {} : { maxSourceBytes: config.maxSourceBytes }),
      }),
      close: async () => {
        await queue.close();
        await storage.close();
      },
    };
  } catch (error) {
    await storage.close();
    throw error;
  }
}
