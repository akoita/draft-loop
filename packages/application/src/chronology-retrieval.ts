import type { ContextSnapshot, RetrievalPort, ScoredEvidenceChunk } from "@draft-loop/domain";
import type { SqliteStorage } from "@draft-loop/storage";

/** Shared author/critic retrieval for legacy local-source contexts. */
export function createChronologyRetrieval(
  storage: Pick<SqliteStorage, "queryEvidence" | "readApprovedChronology">,
  context: ContextSnapshot,
): RetrievalPort {
  const approved = new Set<string>(context.evidenceManifest.map((source) => source.id));
  return {
    queryEvidence: async (query, options) => {
      if (!options?.workspaceId) throw new Error("Chronology retrieval requires a workspace.");
      const limit = options.limit ?? 20;
      if (!Number.isInteger(limit) || limit < 1 || limit > 20)
        throw new Error("Provider evidence limit must be from 1 to 20.");
      const headings = await storage.readApprovedChronology(
        options.workspaceId,
        context.evidenceManifest,
      );
      if (headings.length > limit)
        throw new Error("Chronology cannot fit the provider evidence limit.");
      const ranked = await storage.queryEvidence(query, { ...options, limit });
      const result: ScoredEvidenceChunk[] = [];
      const seen = new Set<string>();
      for (const chunk of [...headings, ...ranked]) {
        if (
          !approved.has(chunk.sourceId) ||
          chunk.workspaceId !== options.workspaceId ||
          seen.has(chunk.id)
        )
          continue;
        if (result.length === limit) break;
        seen.add(chunk.id);
        result.push(chunk);
      }
      if (Buffer.byteLength(JSON.stringify(result)) > 131072)
        throw new Error("Provider evidence exceeds the byte limit.");
      return result;
    },
  };
}
