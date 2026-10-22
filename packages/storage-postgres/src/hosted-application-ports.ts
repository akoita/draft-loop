import type {
  BlobReference,
  BlobStoragePort,
  WorkspaceHistoryStorage,
  WorkspaceSettingsPort,
} from "@draft-loop/storage";
import { StorageSecurityError, StorageValidationError } from "@draft-loop/storage/errors";
import type { CandidateKnowledgeStoreHandle } from "@draft-loop/storage/knowledge-store";
import { hostedWorkspaceHistory } from "./hosted-workspace-history.js";
import { openPostgresCandidateKnowledgeStore } from "./postgres-knowledge-store.js";
import type { PostgresStorage } from "./postgres-storage.js";

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function requireIdentifier(value: string, field: string): string {
  if (!identifierPattern.test(value)) throw new StorageValidationError(`Invalid ${field}.`);
  return value;
}

/** The hosted driver's reference for a workspace: an absolute POSIX path that is never a folder. */
export function hostedWorkspaceReference(tenantId: string, workspaceId: string): string {
  return `/tenants/${requireIdentifier(tenantId, "tenant id")}/workspaces/${requireIdentifier(workspaceId, "workspace id")}`;
}

/** The reference a hosted workspace's knowledge selection names a candidate knowledge store by. */
export function hostedKnowledgeStoreReference(tenantId: string, storeId: string): string {
  return `/tenants/${requireIdentifier(tenantId, "tenant id")}/knowledge-stores/${requireIdentifier(storeId, "store id")}`;
}

/**
 * Blobs addressed by workspace reference: the application writes an export at a path under its
 * workspace reference, `/tenants/<tenant>/workspaces/<id>/...`, and the object key is that path
 * without its leading slash, so it sits under the tenant's blob prefix. References keep the
 * application's location, so a recorded export path reads back through the same mapping.
 */
export function workspaceReferenceBlobs(blobs: BlobStoragePort): BlobStoragePort {
  const key = (location: string): string => {
    if (!location.startsWith("/tenants/"))
      throw new StorageSecurityError("An export location must sit under a workspace reference.");
    return location.slice(1);
  };
  const stored = (reference: BlobReference): BlobReference => ({
    ...reference,
    location: key(reference.location),
  });
  return {
    put: async (location, content) => ({ ...(await blobs.put(key(location), content)), location }),
    get: (reference) => blobs.get(stored(reference)),
    exists: (reference) => blobs.exists(stored(reference)),
    delete: (reference) => blobs.delete(stored(reference)),
  };
}

export interface HostedApplicationPortsOptions {
  /** One tenant's open storage, shared by every call. */
  readonly storage: PostgresStorage;
  /** The tenant the storage was opened for; references to any other tenant are refused. */
  readonly tenantId: string;
  /** The tenant's blob storage: managed source bytes and exported documents. */
  readonly blobs: BlobStoragePort;
}

/** What `createHostedApplicationDriver` takes, over one tenant's Postgres and blob storage. */
export interface HostedApplicationPorts {
  readonly settings: WorkspaceSettingsPort;
  readonly storage: {
    readonly open: (reference: string) => Promise<WorkspaceHistoryStorage>;
    readonly exportBlobs: BlobStoragePort;
  };
  readonly openKnowledgeStore: (reference: string) => Promise<CandidateKnowledgeStoreHandle>;
}

/**
 * The hosted application driver's ports over one tenant's storage (ADR 0011, D3, D15). Every
 * workspace shares the tenant's tables, so a history is the shared storage; a knowledge store
 * reference must name this tenant.
 */
export function hostedApplicationPorts(
  options: HostedApplicationPortsOptions,
): HostedApplicationPorts {
  const { storage, blobs } = options;
  const storePrefix = hostedKnowledgeStoreReference(options.tenantId, "store").replace(
    /store$/u,
    "",
  );
  const history = hostedWorkspaceHistory(storage);
  return {
    settings: storage.workspaceSettings,
    storage: { open: async () => history, exportBlobs: workspaceReferenceBlobs(blobs) },
    openKnowledgeStore: async (reference) => {
      if (!reference.startsWith(storePrefix)) {
        throw new StorageSecurityError(
          "A knowledge store reference must name this tenant's store.",
        );
      }
      const storeId = requireIdentifier(reference.slice(storePrefix.length), "store id");
      return openPostgresCandidateKnowledgeStore({ storage, blobs, storeId });
    },
  };
}
