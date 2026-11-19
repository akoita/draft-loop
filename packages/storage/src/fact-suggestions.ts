import {
  canMoveFactSuggestion,
  type FactSuggestion,
  type FactSuggestionStatus,
} from "@draft-loop/domain/fact-suggestion";
import { factSuggestionSchema } from "@draft-loop/schemas/fact-suggestion";

/**
 * One tenant's fact suggestions (#3067): proposed career profile changes waiting for a person,
 * and the decisions people made on them. This module holds the port, its errors and an in-memory
 * implementation for tests and single-process stacks; Postgres implements it too. Errors carry
 * codes only, never suggestion content.
 */

export type FactSuggestionStoreErrorCode =
  /** The id is taken, or a suggestion of the profile that is not stale holds the dedupe key. */
  | "duplicate_suggestion"
  /** No suggestion with that id in that workspace. */
  | "suggestion_not_found"
  /** The stored suggestion is no longer pending, or the change is not a decision on it. */
  | "suggestion_conflict"
  | "invalid_suggestion";

export class FactSuggestionStoreError extends Error {
  readonly code: FactSuggestionStoreErrorCode;

  constructor(code: FactSuggestionStoreErrorCode, message: string) {
    super(message);
    this.name = "FactSuggestionStoreError";
    this.code = code;
  }
}

export interface FactSuggestionQuery {
  readonly profileId?: string;
  readonly status?: FactSuggestionStatus;
  readonly limit: number;
}

export interface FactSuggestionStore {
  /** Stores a new pending suggestion; refuses a taken id or a dedupe key already held. */
  insert(workspaceId: string, suggestion: FactSuggestion): Promise<void>;
  /**
   * Records a pending suggestion's outcome: its status, decision and applied change. Everything
   * else keeps the stored value. Refuses a suggestion that is no longer pending.
   */
  decide(workspaceId: string, suggestion: FactSuggestion): Promise<void>;
  get(workspaceId: string, id: string): Promise<FactSuggestion | undefined>;
  /** Newest first. */
  list(workspaceId: string, query: FactSuggestionQuery): Promise<readonly FactSuggestion[]>;
  /**
   * The suggestion of the profile that holds a dedupe key, rejected and accepted ones included,
   * so the same change is not offered twice. A stale suggestion holds no key.
   */
  holderOfKey(
    workspaceId: string,
    profileId: string,
    dedupeKey: string,
  ): Promise<FactSuggestion | undefined>;
  countPending(workspaceId: string, profileId?: string): Promise<number>;
}

/** Parses a suggestion before it is stored or after it is read, so a store never holds a bad one. */
export function requireFactSuggestion(value: unknown): FactSuggestion {
  const parsed = factSuggestionSchema.safeParse(value);
  if (!parsed.success) {
    throw new FactSuggestionStoreError("invalid_suggestion", "The fact suggestion is invalid.");
  }
  return parsed.data;
}

/** The stored suggestion with only its outcome taken from `next`, or a conflict. */
export function decidedFactSuggestion(
  stored: FactSuggestion,
  next: FactSuggestion,
): FactSuggestion {
  if (!canMoveFactSuggestion(stored.status, next.status)) {
    throw new FactSuggestionStoreError(
      "suggestion_conflict",
      "The fact suggestion is no longer pending.",
    );
  }
  const { decision: _decision, appliedChange: _applied, ...unchanged } = stored;
  return requireFactSuggestion({
    ...unchanged,
    status: next.status,
    ...(next.decision === undefined ? {} : { decision: next.decision }),
    ...(next.appliedChange === undefined ? {} : { appliedChange: next.appliedChange }),
  });
}

/** A new suggestion is filed pending; anything else is refused before it reaches a store. */
export function requirePending(suggestion: FactSuggestion): void {
  if (suggestion.status !== "pending") {
    throw new FactSuggestionStoreError("invalid_suggestion", "A new fact suggestion is pending.");
  }
}

const newestFirst = (left: FactSuggestion, right: FactSuggestion) =>
  right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id);

/** An in-memory store for one tenant. */
export function createMemoryFactSuggestionStore(): FactSuggestionStore {
  const suggestions = new Map<string, { workspaceId: string; suggestion: FactSuggestion }>();
  const ofWorkspace = (workspaceId: string) =>
    [...suggestions.values()]
      .filter((entry) => entry.workspaceId === workspaceId)
      .map((entry) => entry.suggestion)
      .sort(newestFirst);
  const holder = (workspaceId: string, profileId: string, dedupeKey: string) =>
    ofWorkspace(workspaceId).find(
      (suggestion) =>
        suggestion.profileId === profileId &&
        suggestion.dedupeKey === dedupeKey &&
        suggestion.status !== "stale",
    );

  return {
    insert: async (workspaceId, input) => {
      const suggestion = requireFactSuggestion(input);
      requirePending(suggestion);
      if (
        suggestions.has(suggestion.id) ||
        holder(workspaceId, suggestion.profileId, suggestion.dedupeKey) !== undefined
      ) {
        throw new FactSuggestionStoreError(
          "duplicate_suggestion",
          "A fact suggestion already holds this id or key.",
        );
      }
      suggestions.set(suggestion.id, { workspaceId, suggestion });
    },
    decide: async (workspaceId, input) => {
      const next = requireFactSuggestion(input);
      const stored = suggestions.get(next.id);
      if (stored === undefined || stored.workspaceId !== workspaceId) {
        throw new FactSuggestionStoreError("suggestion_not_found", "No such fact suggestion.");
      }
      suggestions.set(next.id, {
        workspaceId,
        suggestion: decidedFactSuggestion(stored.suggestion, next),
      });
    },
    get: async (workspaceId, id) => {
      const stored = suggestions.get(id);
      return stored?.workspaceId === workspaceId ? stored.suggestion : undefined;
    },
    list: async (workspaceId, { profileId, status, limit }) =>
      ofWorkspace(workspaceId)
        .filter(
          (suggestion) =>
            (profileId === undefined || suggestion.profileId === profileId) &&
            (status === undefined || suggestion.status === status),
        )
        .slice(0, limit),
    holderOfKey: async (workspaceId, profileId, dedupeKey) =>
      holder(workspaceId, profileId, dedupeKey),
    countPending: async (workspaceId, profileId) =>
      ofWorkspace(workspaceId).filter(
        (suggestion) =>
          suggestion.status === "pending" &&
          (profileId === undefined || suggestion.profileId === profileId),
      ).length,
  };
}
