import type { CandidateKnowledgeStoreService } from "@draft-loop/application";
import { describe, expect, it } from "vitest";

import { serializeKnowledgeStoreReads } from "./knowledge-store-reads.js";

/** A store whose open fails when another open of the same root overlaps, like the writer lease. */
function lockingService() {
  const open = new Set<string>();
  const openStore = async (command: { storeRoot: string }) => {
    if (open.has(command.storeRoot)) throw new Error("lease held");
    open.add(command.storeRoot);
    await new Promise((resolve) => setTimeout(resolve, 5));
    open.delete(command.storeRoot);
    return { root: command.storeRoot };
  };
  const service = {
    openStore,
    createKnowledgeBase: openStore,
  } as unknown as CandidateKnowledgeStoreService;
  return { service };
}

describe("serialized candidate knowledge store reads", () => {
  it("lets overlapping reads of one store all succeed", async () => {
    const { service } = lockingService();
    await expect(
      Promise.all(Array.from({ length: 5 }, () => service.openStore({ storeRoot: "/store" }))),
    ).rejects.toThrow("lease held");

    const serialized = serializeKnowledgeStoreReads(lockingService().service);
    await expect(
      Promise.all(Array.from({ length: 5 }, () => serialized.openStore({ storeRoot: "/store" }))),
    ).resolves.toHaveLength(5);
  });

  it("does not queue other operations or other stores behind a read", async () => {
    const { service } = lockingService();
    const serialized = serializeKnowledgeStoreReads(service);
    expect(serialized.createKnowledgeBase).toBe(service.createKnowledgeBase);
    await expect(
      Promise.all([
        serialized.openStore({ storeRoot: "/one" }),
        serialized.openStore({ storeRoot: "/two" }),
      ]),
    ).resolves.toHaveLength(2);
  });

  it("keeps the queue moving after a failed read", async () => {
    let calls = 0;
    const service = {
      openStore: async () => {
        calls += 1;
        if (calls === 1) throw new Error("first fails");
        return { root: "/store" };
      },
    } as unknown as CandidateKnowledgeStoreService;
    const serialized = serializeKnowledgeStoreReads(service);
    const first = serialized.openStore({ storeRoot: "/store" });
    const second = serialized.openStore({ storeRoot: "/store" });
    await expect(first).rejects.toThrow("first fails");
    await expect(second).resolves.toEqual({ root: "/store" });
  });
});
