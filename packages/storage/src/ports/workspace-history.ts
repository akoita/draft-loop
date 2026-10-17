import type { RetrievalPort } from "@draft-loop/domain";
import type { RunHistoryStorage } from "./history.js";
import type {
  CandidateKnowledgeLexicalStoragePort,
  EvidenceChronologyStoragePort,
  EvidenceStoragePort,
  SemanticRetrievalTraceAccessPort,
} from "./retrieval.js";
import type {
  CanonicalCandidateProfileStoragePort,
  OpportunityBriefStoragePort,
  WritingPolicyStoragePort,
} from "./versioned-records.js";
import type { ClosableStoragePort, WorkspaceApplicationsStoragePort } from "./workspace.js";

/**
 * One workspace's history as the application layer opens it: run history, versioned records,
 * applications and retrieval. The local driver backs it with SQLite; a server driver supplies
 * another implementation of the same ports.
 */
export type WorkspaceHistoryStorage = RunHistoryStorage &
  OpportunityBriefStoragePort &
  CanonicalCandidateProfileStoragePort &
  WritingPolicyStoragePort &
  WorkspaceApplicationsStoragePort &
  RetrievalPort &
  EvidenceStoragePort &
  EvidenceChronologyStoragePort &
  CandidateKnowledgeLexicalStoragePort &
  SemanticRetrievalTraceAccessPort &
  ClosableStoragePort;
