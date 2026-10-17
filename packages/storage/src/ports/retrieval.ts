import type {
  CandidateKnowledgeLexicalChunkInput,
  CandidateKnowledgeLexicalIndexIdentity,
  CandidateKnowledgeLexicalIndexIdentityInput,
  CandidateKnowledgeLexicalRetrievalRequestInput,
  CandidateKnowledgeLexicalRetrievalResult,
  CandidateKnowledgeRetrievalScope,
  CandidateKnowledgeRetrievalScopeInput,
  CandidateKnowledgeRetrievalSourceVersionReferenceInput,
  CandidateKnowledgeRetrievalStatus,
  CandidateKnowledgeRetrievalTrace,
  CandidateKnowledgeRetrievalTraceInput,
  RetrievalOptions,
  RetrievalPort,
  ScoredEvidenceChunk,
} from "@draft-loop/domain";

/** Complete replacement of one CKB's deterministic lexical projection. */
export interface CandidateKnowledgeLexicalIndexRebuildInput {
  readonly scope: CandidateKnowledgeRetrievalScopeInput;
  readonly index: CandidateKnowledgeLexicalIndexIdentityInput;
  readonly chunks: readonly CandidateKnowledgeLexicalChunkInput[];
  readonly createdAt: string;
}

/** Incremental replacement of chunks in the current exact CKB projection. */
export interface CandidateKnowledgeLexicalIndexUpsertInput {
  readonly scope: CandidateKnowledgeRetrievalScopeInput;
  readonly index: CandidateKnowledgeLexicalIndexIdentityInput;
  readonly chunks: readonly CandidateKnowledgeLexicalChunkInput[];
}

export type CandidateKnowledgeLexicalSourceVersionDeletionInput =
  CandidateKnowledgeRetrievalSourceVersionReferenceInput;

export interface CandidateKnowledgeLexicalIndexRecord {
  readonly scope: CandidateKnowledgeRetrievalScope;
  readonly index: CandidateKnowledgeLexicalIndexIdentity;
  readonly indexedChunkCount: number;
  readonly createdAt: string;
  readonly stale: boolean;
}

export type CandidateKnowledgeLexicalIndexInspectionStatus = Extract<
  CandidateKnowledgeRetrievalStatus,
  "matched" | "stale" | "not-indexed"
>;

export interface CandidateKnowledgeLexicalIndexInspection {
  readonly status: CandidateKnowledgeLexicalIndexInspectionStatus;
  readonly requestedScope: CandidateKnowledgeRetrievalScope;
  readonly index: CandidateKnowledgeLexicalIndexIdentity | null;
  readonly indexedScope: CandidateKnowledgeRetrievalScope | null;
  readonly indexedChunkCount: number;
}

export interface CandidateKnowledgeRetrievalTraceListOptions {
  readonly operationId?: string;
  readonly limit?: number;
}

export interface CandidateKnowledgeLexicalStoragePort {
  readonly rebuildCandidateKnowledgeLexicalIndex: (
    input: CandidateKnowledgeLexicalIndexRebuildInput,
  ) => Promise<CandidateKnowledgeLexicalIndexRecord>;
  readonly upsertCandidateKnowledgeLexicalChunks: (
    input: CandidateKnowledgeLexicalIndexUpsertInput,
  ) => Promise<CandidateKnowledgeLexicalIndexRecord>;
  readonly deleteCandidateKnowledgeLexicalSourceVersion: (
    input: CandidateKnowledgeLexicalSourceVersionDeletionInput,
  ) => Promise<void>;
  readonly inspectCandidateKnowledgeLexicalIndex: (
    scope: CandidateKnowledgeRetrievalScopeInput,
    index?: CandidateKnowledgeLexicalIndexIdentityInput,
  ) => Promise<CandidateKnowledgeLexicalIndexInspection>;
  readonly queryCandidateKnowledge: (
    request: CandidateKnowledgeLexicalRetrievalRequestInput,
  ) => Promise<CandidateKnowledgeLexicalRetrievalResult>;
  readonly appendCandidateKnowledgeRetrievalTrace: (
    input: CandidateKnowledgeRetrievalTraceInput,
  ) => Promise<CandidateKnowledgeRetrievalTrace>;
  readonly getCandidateKnowledgeRetrievalTrace: (
    workspaceId: string,
    traceId: string,
  ) => Promise<CandidateKnowledgeRetrievalTrace | undefined>;
  readonly listCandidateKnowledgeRetrievalTraces: (
    workspaceId: string,
    options?: CandidateKnowledgeRetrievalTraceListOptions,
  ) => Promise<readonly CandidateKnowledgeRetrievalTrace[]>;
}

export interface EvidenceSourceRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly path: string;
  readonly mediaType: string;
  readonly checksum: string;
  readonly createdAt: string;
}

export interface EvidenceChunkRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly sourceId: string;
  readonly ordinal: number;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly checksum: string;
  readonly text: string;
  readonly createdAt: string;
}

export type { RetrievalOptions, RetrievalPort, ScoredEvidenceChunk };
export type EvidenceSearchHit = ScoredEvidenceChunk;
export type EvidenceSearchOptions = RetrievalOptions;
