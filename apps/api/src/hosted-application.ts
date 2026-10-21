import { createApplicationService, createHostedApplicationDriver } from "@draft-loop/application";
import { openRunQueue } from "@draft-loop/run-queue";
import { createGcsBlobStorage } from "@draft-loop/storage-gcs";
import {
  hostedApplicationPorts,
  hostedWorkspaceReference,
  openPostgresStorage,
} from "@draft-loop/storage-postgres";
import { Storage } from "@google-cloud/storage";

import type { ApiOptions } from "./app.js";
import type { HostedStorageConfig } from "./config.js";

export interface HostedApplication {
  readonly application: NonNullable<ApiOptions["application"]>;
  readonly close: () => Promise<void>;
}

/**
 * Composes the API's application over the tenant's Postgres storage, Cloud Storage bucket and run
 * queue. Credentials come from the runtime: the database URL from a secret and Cloud Storage from
 * the service account, or the emulator on the local stack.
 */
export async function openHostedApplication(
  config: HostedStorageConfig,
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
    const service = createApplicationService(
      createHostedApplicationDriver(hostedApplicationPorts({ storage, tenantId, blobs })),
    );
    return {
      application: {
        service,
        workspaceRoot: (workspaceId) => hostedWorkspaceReference(tenantId, workspaceId),
        enqueueRun: (workspaceId, runId) => queue.enqueue({ tenantId, workspaceId, runId }),
      },
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
