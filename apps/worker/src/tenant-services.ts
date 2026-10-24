import {
  type ApplicationService,
  createApplicationService,
  createHostedApplicationDriver,
  type LocalApplicationDriverOptions,
} from "@draft-loop/application";
import type { BlobStoragePort } from "@draft-loop/storage";
import { hostedApplicationPorts, type PostgresTenancy } from "@draft-loop/storage-postgres";

export interface TenantServicesOptions {
  /** The shared pool, opened once at startup, that hands out any tenant's storage. */
  readonly tenancy: Pick<PostgresTenancy, "forTenant">;
  /** The tenant's blob storage, confined to its prefix, such as Cloud Storage's. */
  readonly blobsFor: (tenantId: string) => BlobStoragePort;
  /** Provider wiring, built once and shared: the model routes are the same for every tenant. */
  readonly local?: LocalApplicationDriverOptions;
}

/**
 * Composes the application over one tenant's storage and blobs, for the job that names it
 * (ADR 0011, D3). Composition only wraps the shared pool and provider routes, so it runs per job
 * and keeps nothing between jobs: no cache to bound, and no state one tenant's job could leave for
 * another's. The tenant id is checked before any storage is touched.
 */
export function tenantServices(
  options: TenantServicesOptions,
): (tenantId: string) => ApplicationService {
  return (tenantId) => {
    const storage = options.tenancy.forTenant(tenantId);
    return createApplicationService(
      createHostedApplicationDriver({
        ...hostedApplicationPorts({ storage, tenantId, blobs: options.blobsFor(tenantId) }),
        ...(options.local === undefined ? {} : { local: options.local }),
      }),
    );
  };
}
