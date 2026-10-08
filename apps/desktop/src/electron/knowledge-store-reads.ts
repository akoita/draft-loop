import { resolve } from "node:path";

import type { CandidateKnowledgeStoreService } from "@draft-loop/application";

/**
 * The store reads the desktop panels issue side by side: the Manage career evidence panel, card
 * 02's readiness line, and the review's source count all open the same store at once.
 *
 * Opening a store takes the store's writer lease with no wait, so two overlapping opens made one
 * of them fail with a lease conflict. The panel then read that failure as an unavailable store and
 * showed no knowledge base while card 02, which won the race, showed the base with its sources.
 */
const serializedReads = [
  "openStore",
  "listKnowledgeBases",
  "getKnowledgeBaseLifecycleReadiness",
  "listKnowledgeSourceManifests",
  "listKnowledgeSourceDuplicateGroups",
] as const satisfies readonly (keyof CandidateKnowledgeStoreService)[];

type StoreRead = (command: { readonly storeRoot: string }) => Promise<unknown>;

/**
 * Returns the service with its read operations queued per store root, so reads of one store never
 * overlap each other. Writes and operations on other stores are not delayed. A failed read does
 * not block the next one in the queue.
 */
export function serializeKnowledgeStoreReads(
  service: CandidateKnowledgeStoreService,
): CandidateKnowledgeStoreService {
  const tails = new Map<string, Promise<unknown>>();
  const queued = (read: StoreRead): StoreRead => {
    return (command) => {
      // A malformed command is left for the service to reject, as it would without the queue.
      if (typeof command?.storeRoot !== "string") return read(command);
      const key = resolve(command.storeRoot);
      const run = (tails.get(key) ?? Promise.resolve()).then(() => read(command));
      const settled = run.then(
        () => undefined,
        () => undefined,
      );
      tails.set(key, settled);
      void settled.then(() => {
        if (tails.get(key) === settled) tails.delete(key);
      });
      return run;
    };
  };
  const wrapped: Record<string, StoreRead> = {};
  for (const name of serializedReads) {
    const read = service[name] as StoreRead | undefined;
    if (read !== undefined) wrapped[name] = queued((command) => read.call(service, command));
  }
  return { ...service, ...wrapped };
}
