import {
  type ApplicationService,
  createApplicationService,
  createHostedApplicationDriver,
  type LocalApplicationDriverOptions,
  WorkspaceNotFoundError,
} from "@draft-loop/application";
import type { RunJob } from "@draft-loop/run-queue";
import type { BlobStoragePort } from "@draft-loop/storage";
import { permitsTransmission } from "@draft-loop/storage/consent-ledger";
import { hostedApplicationPorts, type PostgresTenancy } from "@draft-loop/storage-postgres";

/** The ids every queued job names: its tenant and its workspace, the candidate record. */
export type WorkspaceJob = Pick<RunJob, "tenantId" | "workspaceId">;

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

export interface TenantConsentOptions<Job extends WorkspaceJob = WorkspaceJob> {
  readonly tenancy: Pick<PostgresTenancy, "forTenant">;
  readonly serviceFor: (tenantId: string) => Pick<ApplicationService, "readWorkspace">;
  readonly workspaceRoot: (job: Job) => string;
}

/**
 * Whether a job's candidate record's current provider transmission consent names every company
 * its workspace's author and critic models call (ADR 0011, D7), read from the job's tenant's
 * consent ledger, which keys by the workspace's record id as the API's consent routes do.
 */
export function tenantRunConsent<Job extends WorkspaceJob>(
  options: TenantConsentOptions<Job>,
): (job: Job) => Promise<boolean> {
  return async (job) => {
    const workspace = await options
      .serviceFor(job.tenantId)
      .readWorkspace(options.workspaceRoot(job));
    const state = await options.tenancy.forTenant(job.tenantId).consentLedger.current(workspace.id);
    return permitsTransmission(state, workspace);
  };
}

export interface TenantRecordErasureOptions<Job extends WorkspaceJob = WorkspaceJob> {
  readonly tenancy: Pick<PostgresTenancy, "forTenant">;
  readonly serviceFor: (tenantId: string) => Pick<ApplicationService, "readWorkspace">;
  readonly workspaceRoot: (job: Job) => string;
}

/**
 * Whether a job's candidate record is erased: its organisation or the record closed for erasure, or
 * its workspace gone, as after an erasure finished (ADR 0011, D7). The record is the workspace's
 * API id, as the job names it.
 */
export function tenantRecordErased<Job extends WorkspaceJob>(
  options: TenantRecordErasureOptions<Job>,
): (job: Job) => Promise<boolean> {
  return async (job) => {
    const tenant = options.tenancy.forTenant(job.tenantId);
    if (await tenant.organisationErasure.isClosing()) return true;
    if (await tenant.recordErasure.isClosed(job.workspaceId)) return true;
    try {
      await options.serviceFor(job.tenantId).readWorkspace(options.workspaceRoot(job));
      return false;
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) return true;
      throw error;
    }
  };
}
