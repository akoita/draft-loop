import type { WritingPolicyVersionRecord } from "@draft-loop/storage";

/** The version and checksum that identify a writing policy in a run's lineage. */
export function policyIdentity(record: WritingPolicyVersionRecord): {
  readonly version: string;
  readonly checksum: string;
} {
  return { version: record.version, checksum: record.checksum };
}
