/**
 * The organisation erasure flow (ADR 0011, D7), over the storage ports only, so the API's
 * `DELETE /v1/organisation` and the worker's beta retention job (#2463) erase the same way.
 */

import type { BlobErasure, CandidateRecordErasure, OrganisationErasure } from "./record-erasure.js";

/** One tenant's erasure: its records' rows, its objects, and what the tenant itself holds. */
export interface TenantErasure {
  readonly records: CandidateRecordErasure;
  readonly blobs: BlobErasure;
  readonly organisation: OrganisationErasure;
  /** The key prefix every one of the tenant's objects sits under, ending in `/`. */
  readonly objectPrefix: string;
}

export type OrganisationErasureOutcome =
  | { readonly state: "missing" }
  | { readonly state: "run-active" }
  | {
      readonly state: "erased";
      readonly records: number;
      readonly objectsRemoved: number;
      readonly rowsRemoved: number;
    };

/**
 * Erases one organisation: the organisation is marked closing first, so no member request creates
 * anything meanwhile; then each record is closed and erased in turn, its objects by key, then every
 * object left under the tenant's prefix, then the tenant's remaining rows, the directory last. An
 * interruption leaves the organisation closing in the directory, so the next call finishes it.
 *
 * An unregistered tenant, the owner token's, has no organisation to mark and no members to refuse:
 * its erasure goes straight to the records, each of which still refuses while its run is active,
 * and a repeated call finishes an interrupted one the same way.
 */
export async function eraseOrganisation(
  erasure: TenantErasure,
  unregistered = false,
): Promise<OrganisationErasureOutcome> {
  const { organisation, records, blobs } = erasure;
  const closure = await organisation.close();
  if (closure.state === "run-active") return closure;
  if (closure.state === "missing" && !unregistered) return closure;
  let erasedRecords = 0;
  let objectsRemoved = 0;
  let rowsRemoved = 0;
  for (const workspaceId of await organisation.listRecords()) {
    const recordClosure = await records.close(workspaceId);
    if (recordClosure.state === "run-active") return { state: "run-active" };
    if (recordClosure.state === "missing") continue;
    for (const key of recordClosure.objectKeys) {
      if (await blobs.removeObject(key)) objectsRemoved += 1;
    }
    rowsRemoved += (await records.erase(workspaceId)).rowsRemoved;
    erasedRecords += 1;
  }
  objectsRemoved += await blobs.removePrefix(erasure.objectPrefix);
  rowsRemoved += (await organisation.eraseRemainder()).rowsRemoved;
  return { state: "erased", records: erasedRecords, objectsRemoved, rowsRemoved };
}
