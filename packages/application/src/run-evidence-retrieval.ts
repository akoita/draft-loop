import type { ContextSnapshot } from "@draft-loop/domain";
import type {
  CandidateKnowledgeLexicalStoragePort,
  CanonicalCandidateProfileStoragePort,
  SemanticRetrievalTraceAccessPort,
} from "@draft-loop/storage";
import { createPinnedCandidateKnowledgeSourceReferenceChunkLoader } from "./candidate-experience-body-evidence.js";
import {
  type CandidateKnowledgeRuntimeConfig,
  candidateKnowledgeRuntimeRetrieval,
} from "./candidate-knowledge-retrieval.js";
import {
  type CandidateKnowledgeSensitivityExclusions,
  createCandidateKnowledgeSensitivityExclusions,
} from "./candidate-knowledge-sensitivity-exclusion.js";
import { CliUserError } from "./cli-user-error.js";
import { withFactUsageExclusions } from "./run-fact-usage-exclusions.js";
import {
  loadPinnedProfile,
  runCandidateProfileUnavailableMessage,
  withPinnedProfileFacts,
} from "./run-profile-fact-retrieval.js";
import {
  type RunSemanticRetrievalOptions,
  runEmbeddingModelRoot,
} from "./run-semantic-retrieval.js";
import { readWorkspaceEvidenceMode } from "./workspace-evidence-mode.js";
import { readWorkspaceRetrievalMode } from "./workspace-retrieval-mode.js";

/**
 * The run's withheld-section filter, extended with the source text of the pinned profile's facts
 * the person holds back from a CV (#2304). Unchanged without a pinned selection or profile.
 */
async function heldBackFactsWithheld(
  storage: Partial<Pick<CanonicalCandidateProfileStoragePort, "getCanonicalCandidateProfile">>,
  root: string,
  config: CandidateKnowledgeRuntimeConfig,
  context: ContextSnapshot,
  withheld: CandidateKnowledgeSensitivityExclusions | undefined,
): Promise<CandidateKnowledgeSensitivityExclusions | undefined> {
  const binding = config.candidateKnowledgeSelection;
  const selection = context.candidateKnowledgeSelection;
  const reference = context.candidateProfileReference;
  if (binding === undefined || selection === undefined || reference === undefined) return withheld;
  return withFactUsageExclusions({
    root,
    workspaceId: config.id,
    context,
    profile: await loadPinnedProfile(storage, config.id, reference),
    withheld: withheld ?? createCandidateKnowledgeSensitivityExclusions(binding.entries, selection),
    loadSourceChunks: createPinnedCandidateKnowledgeSourceReferenceChunkLoader(
      binding.entries,
      selection,
    ),
  });
}

/**
 * Build a run's candidate-knowledge retrieval with the workspace evidence and retrieval modes in
 * force. Both are read here, once, when a run starts or resumes, and fail closed when a setting
 * cannot be read. Lexical retrieval, the default, takes exactly the path it always did. When the
 * run's context pins a reviewed candidate profile, that exact version is loaded and verified here
 * too, and its facts lead the evidence (see run-profile-fact-retrieval).
 */
export async function openRunCandidateRetrieval(
  storage: Pick<CandidateKnowledgeLexicalStoragePort, "appendCandidateKnowledgeRetrievalTrace"> &
    Partial<SemanticRetrievalTraceAccessPort> &
    Partial<Pick<CanonicalCandidateProfileStoragePort, "getCanonicalCandidateProfile">>,
  root: string,
  config: CandidateKnowledgeRuntimeConfig,
  context: ContextSnapshot,
  withheld?: CandidateKnowledgeSensitivityExclusions,
  /** Injection point for the model location and embedder; tests use it, runs use the defaults. */
  semanticDependencies: Partial<RunSemanticRetrievalOptions> = {},
) {
  const { mode } = await readWorkspaceEvidenceMode(root);
  const retrieval = await readWorkspaceRetrievalMode(root);
  const semantic: RunSemanticRetrievalOptions | undefined =
    retrieval.mode === "lexical"
      ? undefined
      : {
          modelRoot: runEmbeddingModelRoot(),
          ...semanticDependencies,
          mode: retrieval.mode,
          tier: retrieval.modelTier,
        };
  const runtime = candidateKnowledgeRuntimeRetrieval(
    storage,
    config,
    context,
    await heldBackFactsWithheld(storage, root, config, context, withheld),
    mode,
    semantic,
  );
  if (runtime === undefined) {
    if (context.candidateProfileReference !== undefined) {
      throw new CliUserError(runCandidateProfileUnavailableMessage);
    }
    return undefined;
  }
  return withPinnedProfileFacts(runtime, {
    storage,
    workspaceId: config.id,
    context,
    ...(semantic === undefined ? {} : { semanticOptions: semantic }),
  });
}
