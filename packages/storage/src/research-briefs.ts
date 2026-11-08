import { type ResearchBrief, researchBriefSchema } from "@draft-loop/schemas/research-brief";

/**
 * One tenant's research briefs (#2542). This module holds the port, its error and an in-memory
 * implementation for tests and single-process stacks; Postgres implements it too. A brief never
 * changes: a new research run is a new brief.
 */

export type ResearchBriefStoreErrorCode = "duplicate_brief" | "invalid_brief";

export class ResearchBriefStoreError extends Error {
  readonly code: ResearchBriefStoreErrorCode;

  constructor(code: ResearchBriefStoreErrorCode, message: string) {
    super(message);
    this.name = "ResearchBriefStoreError";
    this.code = code;
  }
}

export interface ResearchBriefStore {
  insert(brief: ResearchBrief): Promise<void>;
  get(workspaceId: string, id: string): Promise<ResearchBrief | undefined>;
  /** One application's briefs, newest first. */
  list(
    workspaceId: string,
    applicationId: string,
    options?: { readonly limit?: number },
  ): Promise<readonly ResearchBrief[]>;
  /** True when a brief was removed. */
  delete(workspaceId: string, id: string): Promise<boolean>;
}

/** The most briefs one list returns. */
export const researchBriefListLimit = 20;

/** Parses a brief before it is stored or after it is read, so a store never holds a bad one. */
export function requireResearchBrief(value: unknown): ResearchBrief {
  const parsed = researchBriefSchema.safeParse(value);
  if (!parsed.success) {
    throw new ResearchBriefStoreError("invalid_brief", "The research brief is invalid.");
  }
  return parsed.data;
}

const newestFirst = (left: ResearchBrief, right: ResearchBrief) =>
  right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id);

/** An in-memory store for one tenant. */
export function createMemoryResearchBriefStore(): ResearchBriefStore {
  const briefs = new Map<string, ResearchBrief>();
  return {
    insert: async (input) => {
      const brief = requireResearchBrief(input);
      if (briefs.has(brief.id)) {
        throw new ResearchBriefStoreError("duplicate_brief", "The research brief already exists.");
      }
      briefs.set(brief.id, brief);
    },
    get: async (workspaceId, id) => {
      const brief = briefs.get(id);
      return brief?.workspace_id === workspaceId ? brief : undefined;
    },
    list: async (workspaceId, applicationId, options = {}) =>
      [...briefs.values()]
        .filter(
          (brief) => brief.workspace_id === workspaceId && brief.application_id === applicationId,
        )
        .sort(newestFirst)
        .slice(0, options.limit ?? researchBriefListLimit),
    delete: async (workspaceId, id) =>
      briefs.get(id)?.workspace_id === workspaceId && briefs.delete(id),
  };
}
