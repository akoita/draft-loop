import { mkdir, readdir } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  CandidateKnowledgeStoreService,
  CandidateKnowledgeStoreView,
} from "@draft-loop/application";

/** The base name shown to the person; the application's default base uses the same name. */
export const defaultKnowledgeBaseDisplayName = "Career evidence";

export interface EnsuredDefaultKnowledgeBase {
  readonly view: CandidateKnowledgeStoreView;
  readonly knowledgeBaseId: string;
  readonly displayName: string;
  /** True when this call created the store or the base. */
  readonly created: boolean;
}

async function storeDirectoryIsAbsent(storeRoot: string): Promise<boolean> {
  try {
    return (await readdir(storeRoot)).length === 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

/**
 * Makes sure the default candidate knowledge store and an active base exist at `storeRoot`.
 *
 * The store is created without a dialog because the location belongs to the host. An existing
 * store is reused, never replaced: its default base (or its first active base) is returned, and a
 * base is added only when the store has no active one.
 */
export async function ensureDefaultKnowledgeBase(input: {
  readonly knowledgeService: Pick<
    CandidateKnowledgeStoreService,
    "initializeStore" | "openStore" | "createKnowledgeBase"
  >;
  readonly storeRoot: string;
}): Promise<EnsuredDefaultKnowledgeBase> {
  const { knowledgeService, storeRoot } = input;
  if (await storeDirectoryIsAbsent(storeRoot)) {
    // The per-user data directory may not exist yet on a first run.
    await mkdir(dirname(storeRoot), { recursive: true });
    const view = await knowledgeService.initializeStore({
      storeRoot,
      displayName: defaultKnowledgeBaseDisplayName,
    });
    const base = view.knowledgeBases.find((candidate) => candidate.state === "active");
    if (base === undefined) throw new Error("The new knowledge store has no active base.");
    return { view, knowledgeBaseId: base.id, displayName: base.displayName, created: true };
  }
  const view = await knowledgeService.openStore({ storeRoot });
  const active = view.knowledgeBases.filter((candidate) => candidate.state === "active");
  const base = active.find((candidate) => candidate.isDefault) ?? active[0];
  if (base !== undefined) {
    return { view, knowledgeBaseId: base.id, displayName: base.displayName, created: false };
  }
  const withBase = await knowledgeService.createKnowledgeBase({
    storeRoot,
    displayName: defaultKnowledgeBaseDisplayName,
  });
  const created = withBase.knowledgeBases.find(
    (candidate) =>
      candidate.state === "active" &&
      !view.knowledgeBases.some((known) => known.id === candidate.id),
  );
  if (created === undefined) throw new Error("The knowledge base was not created.");
  return {
    view: withBase,
    knowledgeBaseId: created.id,
    displayName: created.displayName,
    created: true,
  };
}
