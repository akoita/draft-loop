import { AsyncLocalStorage } from "node:async_hooks";
import {
  type CandidateKnowledgeStoreHandle,
  openCandidateKnowledgeStore,
} from "@draft-loop/storage/knowledge-store";

/** Opens the candidate knowledge store a workspace's selection names by its store reference. */
export type KnowledgeStoreOpener = (storeRoot: string) => Promise<CandidateKnowledgeStoreHandle>;

const activeOpener = new AsyncLocalStorage<KnowledgeStoreOpener>();

/**
 * Opens a store for the driver call in progress. Locally the reference is the store's folder. A
 * driver that keeps knowledge elsewhere wraps each call in `withKnowledgeStoreOpener`, as it does
 * for settings, and the run's selection, retrieval and sensitivity reads all go through it.
 */
export function openKnowledgeStore(storeRoot: string): Promise<CandidateKnowledgeStoreHandle> {
  return (activeOpener.getStore() ?? openCandidateKnowledgeStore)(storeRoot);
}

export function withKnowledgeStoreOpener<Result>(
  opener: KnowledgeStoreOpener,
  action: () => Promise<Result>,
): Promise<Result> {
  return activeOpener.run(opener, action);
}
