import type { ContextSnapshot } from "@draft-loop/domain";
import type { SqliteStorage } from "@draft-loop/storage";

import {
  type CandidateKnowledgeRuntimeConfig,
  candidateKnowledgeRuntimeRetrieval,
} from "./candidate-knowledge-retrieval.js";
import type { CandidateKnowledgeSensitivityExclusions } from "./candidate-knowledge-sensitivity-exclusion.js";
import { readWorkspaceEvidenceMode } from "./workspace-evidence-mode.js";

/**
 * Build a run's candidate-knowledge retrieval with the workspace evidence mode in force.
 * The mode is read here, once, when a run starts or resumes, and fails closed when the setting
 * cannot be read.
 */
export async function openRunCandidateRetrieval(
  storage: Pick<SqliteStorage, "appendCandidateKnowledgeRetrievalTrace">,
  root: string,
  config: CandidateKnowledgeRuntimeConfig,
  context: ContextSnapshot,
  withheld?: CandidateKnowledgeSensitivityExclusions,
) {
  const { mode } = await readWorkspaceEvidenceMode(root);
  return candidateKnowledgeRuntimeRetrieval(storage, config, context, withheld, mode);
}
