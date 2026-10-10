import type { ContextSnapshot } from "@draft-loop/domain";
import type { CanonicalCandidateProfileStoragePort, SqliteStorage } from "@draft-loop/storage";

import {
  type CandidateKnowledgeRuntimeConfig,
  candidateKnowledgeRuntimeRetrieval,
} from "./candidate-knowledge-retrieval.js";
import type { CandidateKnowledgeSensitivityExclusions } from "./candidate-knowledge-sensitivity-exclusion.js";
import { CliUserError } from "./cli-user-error.js";
import {
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
 * Build a run's candidate-knowledge retrieval with the workspace evidence and retrieval modes in
 * force. Both are read here, once, when a run starts or resumes, and fail closed when a setting
 * cannot be read. Lexical retrieval, the default, takes exactly the path it always did. When the
 * run's context pins a reviewed candidate profile, that exact version is loaded and verified here
 * too, and its facts lead the evidence (see run-profile-fact-retrieval).
 */
export async function openRunCandidateRetrieval(
  storage: Pick<SqliteStorage, "appendCandidateKnowledgeRetrievalTrace"> &
    Partial<Pick<SqliteStorage, "candidateKnowledgeSemanticRetrievalTrace">> &
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
    withheld,
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
