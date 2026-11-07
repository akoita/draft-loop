import type { BlobStoragePort } from "@draft-loop/storage";

import {
  HostedKnowledgeIntakeError,
  type HostedKnowledgeIntakeRecords,
  type HostedKnowledgeSourceView,
} from "./hosted-knowledge-intake.js";

/** A source's latest stored file, as the person downloads it. */
export interface HostedKnowledgeSourceFile extends HostedKnowledgeSourceView {
  readonly bytes: Uint8Array;
}

/** What reading a source's file needs: the source's records and where its bytes are kept. */
export interface HostedKnowledgeSourceFileReaders {
  readonly records: Pick<
    HostedKnowledgeIntakeRecords,
    | "getCandidateKnowledgeBase"
    | "listCandidateKnowledgeSources"
    | "listCandidateKnowledgeSourceVersions"
    | "getManagedCandidateKnowledgeSourceVersion"
  >;
  readonly blobs: Pick<BlobStoragePort, "get">;
}

/**
 * The latest version's stored bytes of one source, checked against the version's recorded
 * checksum and size. An unknown base or source is `source_not_found`; a version whose bytes the
 * service does not hold, or that no longer match, is `source_file_unavailable` and is never sent.
 */
export async function readHostedKnowledgeSourceFile(
  readers: HostedKnowledgeSourceFileReaders,
  knowledgeBaseId: string,
  sourceId: string,
): Promise<HostedKnowledgeSourceFile> {
  const { records, blobs } = readers;
  const notFound = new HostedKnowledgeIntakeError("source_not_found", "No such source.");
  if ((await records.getCandidateKnowledgeBase(knowledgeBaseId)) === undefined) throw notFound;
  const source = (await records.listCandidateKnowledgeSources(knowledgeBaseId)).find(
    (candidate) => candidate.id === sourceId,
  );
  if (source === undefined) throw notFound;
  const latestVersion = (
    await records.listCandidateKnowledgeSourceVersions(knowledgeBaseId, sourceId)
  ).at(-1);
  if (latestVersion === undefined) throw notFound;

  const unavailable = new HostedKnowledgeIntakeError(
    "source_file_unavailable",
    "The stored file is missing or no longer matches what was uploaded.",
  );
  const managed = await records.getManagedCandidateKnowledgeSourceVersion(
    knowledgeBaseId,
    sourceId,
    latestVersion.id,
  );
  if (managed === undefined) throw unavailable;
  const bytes = await blobs.get({
    location: managed.location,
    checksum: latestVersion.checksum,
    sizeBytes: latestVersion.sizeBytes,
  });
  if (bytes === undefined || bytes.byteLength !== latestVersion.sizeBytes) throw unavailable;
  return { source, latestVersion, bytes };
}
