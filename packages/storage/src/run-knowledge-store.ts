import type { CandidateKnowledgeStoreHandle } from "./knowledge-store.js";

/**
 * The candidate-knowledge operations a run uses: the selection's lifecycle check, the sensitivity
 * rules, the derived lexical and vector projections it brings up to date and queries, and the bytes
 * of pinned managed source versions, and the source records a career profile's derivation reads. A
 * hosted store that offers only these can serve runs and profile derivations.
 */
export const candidateKnowledgeRunOperations = [
  "close",
  "withWriterLease",
  "getCandidateKnowledgeBaseLifecycleReadiness",
  "getCandidateKnowledgeSourceSensitivityRules",
  "readManagedCandidateKnowledgeSourceVersion",
  "getCandidateKnowledgeSource",
  "listCandidateKnowledgeSourceEvidenceKindOverrides",
  "inspectCandidateKnowledgeLexicalIndex",
  "queryCandidateKnowledge",
  "rebuildCandidateKnowledgeLexicalIndex",
  "inspectCandidateKnowledgeVectorIndex",
  "queryCandidateKnowledgeVectors",
  "upsertCandidateKnowledgeVectors",
  "deleteCandidateKnowledgeVectorIndex",
] as const satisfies readonly (keyof CandidateKnowledgeStoreHandle)[];

export type CandidateKnowledgeRunOperation = (typeof candidateKnowledgeRunOperations)[number];

export type CandidateKnowledgeRunStore = Pick<
  CandidateKnowledgeStoreHandle,
  "descriptor" | CandidateKnowledgeRunOperation
>;

/** A store operation this store does not offer, such as intake or a local folder binding. */
export class CandidateKnowledgeOperationUnsupportedError extends Error {
  constructor(readonly operation: string) {
    super(`This candidate knowledge store does not support ${operation}.`);
    this.name = "CandidateKnowledgeOperationUnsupportedError";
  }
}

const runOperations: ReadonlySet<string> = new Set(candidateKnowledgeRunOperations);

/**
 * Presents a store that offers only a run's operations as a full store handle, so the application's
 * run path takes it unchanged. Every other operation rejects with
 * `CandidateKnowledgeOperationUnsupportedError`, and local-only state such as the store's folder
 * throws when read; nothing falls back to a local file.
 */
export function runOnlyCandidateKnowledgeStore(
  store: CandidateKnowledgeRunStore,
): CandidateKnowledgeStoreHandle {
  const unsupported = (operation: string) => () =>
    Promise.reject(new CandidateKnowledgeOperationUnsupportedError(operation));
  return new Proxy(Object.freeze({}) as CandidateKnowledgeStoreHandle, {
    get: (_target, property) => {
      if (typeof property !== "string") return undefined;
      if (property === "descriptor") return store.descriptor;
      if (runOperations.has(property)) {
        return store[property as CandidateKnowledgeRunOperation];
      }
      // Promise resolution probes `then`; a handle must not look like a promise.
      if (property === "then") return undefined;
      if (property === "root" || property === "recoveryReport") {
        throw new CandidateKnowledgeOperationUnsupportedError(property);
      }
      return unsupported(property);
    },
    has: (_target, property) =>
      property === "descriptor" || (typeof property === "string" && runOperations.has(property)),
    set: () => false,
  });
}
