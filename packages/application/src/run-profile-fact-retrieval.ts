import type { ContextSnapshot, RetrievalPort } from "@draft-loop/domain";
import type { CanonicalCandidateProfileStoragePort } from "@draft-loop/storage";

import type { candidateKnowledgeRuntimeRetrieval } from "./candidate-knowledge-retrieval.js";
import { createCanonicalCandidateProfilePersistenceService } from "./candidate-profile-persistence.js";
import { CliUserError } from "./cli-user-error.js";
import {
  mergeProfileFactEvidence,
  type ProfileFactEvidenceCandidate,
  type ProfileFactSemanticRanking,
  profileFactEvidenceCandidates,
  profileFactEvidenceSlots,
  rankProfileFactEvidence,
} from "./profile-fact-evidence.js";
import { openRunEmbedder, type RunSemanticRetrievalOptions } from "./run-semantic-retrieval.js";

type RunCandidateRetrieval = NonNullable<ReturnType<typeof candidateKnowledgeRuntimeRetrieval>>;

export const runCandidateProfileUnavailableMessage =
  "The run's reviewed candidate profile is missing or no longer matches its recorded checksum. Start a new run with a current reviewed profile.";

/**
 * Load the exact reviewed profile version a run's context pins and verify its checksum. Any
 * mismatch, a missing version, or a corrupt record fails the run before evidence is retrieved.
 */
async function loadPinnedProfile(
  storage: Partial<Pick<CanonicalCandidateProfileStoragePort, "getCanonicalCandidateProfile">>,
  workspaceId: string,
  reference: NonNullable<ContextSnapshot["candidateProfileReference"]>,
) {
  if (storage.getCanonicalCandidateProfile === undefined) {
    throw new CliUserError(runCandidateProfileUnavailableMessage);
  }
  let record: Awaited<
    ReturnType<CanonicalCandidateProfileStoragePort["getCanonicalCandidateProfile"]>
  >;
  try {
    // Only the read is used; the storage keeps its own method binding.
    record = await createCanonicalCandidateProfilePersistenceService(
      storage as CanonicalCandidateProfileStoragePort,
    ).getCanonicalCandidateProfile(workspaceId, reference.profileId, reference.version);
  } catch {
    throw new CliUserError(runCandidateProfileUnavailableMessage);
  }
  if (
    record === undefined ||
    record.checksum !== reference.checksum ||
    record.profile.status !== "reviewed"
  ) {
    throw new CliUserError(runCandidateProfileUnavailableMessage);
  }
  return record.profile;
}

/**
 * Fact-first retrieval for a run whose context pins a reviewed candidate profile. The profile is
 * loaded and verified here, when the run starts or resumes. Each evidence query then ranks the
 * profile's grounded facts against the query with the run's retrieval mode, asks the chunk
 * retrieval for the remaining slots, and merges both (see profile-fact-evidence). A full-source run
 * already sends every eligible chunk, so it is left unchanged, as is a run without a profile.
 */
export async function withPinnedProfileFacts(
  runtime: RunCandidateRetrieval,
  request: {
    readonly storage: Partial<
      Pick<CanonicalCandidateProfileStoragePort, "getCanonicalCandidateProfile">
    >;
    readonly workspaceId: string;
    readonly context: ContextSnapshot;
    readonly semanticOptions?: RunSemanticRetrievalOptions;
  },
): Promise<RunCandidateRetrieval> {
  const reference = request.context.candidateProfileReference;
  if (reference === undefined) return runtime;
  const profile = await loadPinnedProfile(request.storage, request.workspaceId, reference);
  const manifestSourceIds = new Set(request.context.evidenceManifest.map(({ id }) => id));

  let candidates: Promise<readonly ProfileFactEvidenceCandidate[]> | undefined;
  const factCandidates = () => {
    candidates ??= profileFactEvidenceCandidates({
      profile,
      workspaceId: request.workspaceId,
      manifestSourceIds,
      loadSourceChunks: runtime.loadPinnedSourceChunks,
    });
    return candidates;
  };
  let semantic: Promise<ProfileFactSemanticRanking | undefined> | undefined;
  /** The run's embedder, only when its semantic or hybrid mode is actually in effect. */
  const semanticRanking = () => {
    semantic ??= (async () => {
      const options = request.semanticOptions;
      const decision = await runtime.retrievalModeDecision?.();
      if (options === undefined || decision === undefined || decision.effectiveMode === "lexical") {
        return undefined;
      }
      const opened = await openRunEmbedder(options);
      if (!opened.ok) return undefined;
      return {
        mode: decision.effectiveMode,
        embedder: opened.embedder,
        ...(options.relevanceFloor === undefined ? {} : { relevanceFloor: options.relevanceFloor }),
      };
    })();
    return semantic;
  };

  const port: RetrievalPort = {
    queryEvidence: async (text, options) => {
      if ((await runtime.evidenceModeDecision()).effectiveMode === "full-source") {
        return runtime.port.queryEvidence(text, options);
      }
      const limit = options?.limit ?? 20;
      const semanticOptions = await semanticRanking();
      const ranked = await rankProfileFactEvidence({
        candidates: await factCandidates(),
        query: text,
        limit: profileFactEvidenceSlots(limit),
        ...(semanticOptions === undefined ? {} : { semantic: semanticOptions }),
      });
      const facts = ranked.candidates;
      if (facts.length === 0) return runtime.port.queryEvidence(text, options);
      const chunkLimit = limit - facts.length;
      let chunks: Awaited<ReturnType<RetrievalPort["queryEvidence"]>>;
      let reserved: ReadonlySet<string>;
      try {
        chunks = await runtime.port.queryEvidence(text, { ...options, limit: chunkLimit });
        reserved = runtime.reservedEvidenceIds(text, chunkLimit);
      } catch {
        // Reserved evidence that cannot fit beside the facts keeps the chunk-only selection, which
        // fails exactly as a run without a profile would when it cannot fit either.
        return runtime.port.queryEvidence(text, options);
      }
      return mergeProfileFactEvidence({
        facts,
        chunks,
        limit,
        isReserved: ({ id }) => reserved.has(id),
      });
    },
  };
  return { ...runtime, port };
}
