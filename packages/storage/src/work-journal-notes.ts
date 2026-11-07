import {
  type WorkJournalNoteStatus,
  type WorkJournalStoredNote,
  workJournalStoredNoteSchema,
} from "@draft-loop/schemas/work-journal";

/**
 * One tenant's work journal notes (#2021): notes an agent filed, pending the candidate's
 * review, and each workspace's intake switch. This module holds the port, its errors and an
 * in-memory implementation for tests and single-process stacks; Postgres implements it too.
 */

export type WorkJournalStoreErrorCode =
  /** A non-discarded note of the tenant already holds the dedupe key. */
  | "duplicate_key"
  /** No note with that id, or the note changed since it was read. */
  | "note_not_found"
  | "invalid_note";

export class WorkJournalStoreError extends Error {
  readonly code: WorkJournalStoreErrorCode;

  constructor(code: WorkJournalStoreErrorCode, message: string) {
    super(message);
    this.name = "WorkJournalStoreError";
    this.code = code;
  }
}

/** What a dedupe key is held by: a live note, or a discarded note whose content has aged out. */
export type WorkJournalKeyHolder =
  | { readonly kind: "note"; readonly note: WorkJournalStoredNote }
  | { readonly kind: "forgotten"; readonly noteId: string };

export interface WorkJournalNoteQuery {
  readonly workspaceId: string;
  readonly status?: WorkJournalNoteStatus;
  /** Exact project name, case-insensitive. */
  readonly project?: string;
  /** Notes created at or after this time. */
  readonly since?: string;
  /** Notes this agent token filed or amended. */
  readonly agentTokenId?: string;
  readonly limit: number;
}

/** A workspace's "Accept notes from agents" switch. */
export interface WorkJournalIntake {
  readonly enabled: boolean;
  readonly changedAt?: string;
}

export interface WorkJournalNoteStore {
  /** Stores a new note; refuses a dedupe key a non-discarded note already holds. */
  insert(note: WorkJournalStoredNote): Promise<void>;
  /**
   * Replaces a note's mutable state; its id, scope, creation time and filing agent token never
   * change.
   */
  replace(note: WorkJournalStoredNote): Promise<void>;
  get(workspaceId: string, id: string): Promise<WorkJournalStoredNote | undefined>;
  /** The newest note holding a key, discarded ones included, or the trace an aged one left. */
  holderOfKey(key: string): Promise<WorkJournalKeyHolder | undefined>;
  /** Newest first. */
  list(query: WorkJournalNoteQuery): Promise<readonly WorkJournalStoredNote[]>;
  /** Pending notes of a workspace, newest first, for duplicate marking. */
  pending(workspaceId: string): Promise<readonly WorkJournalStoredNote[]>;
  countCreatedSince(workspaceId: string, since: string): Promise<number>;
  /** Pending notes across the tenant. */
  countPending(): Promise<number>;
  /** Deletes a workspace's pending notes, as when its intake is turned off; returns the count. */
  deletePending(workspaceId: string): Promise<number>;
  /**
   * Deletes discarded notes last changed before `before`, keeping only their dedupe keys, so a
   * discarded note's text ages out while the agent is still told it was discarded.
   */
  forgetDiscarded(before: string): Promise<number>;
  intake(workspaceId: string): Promise<WorkJournalIntake>;
  setIntake(workspaceId: string, enabled: boolean, at: string): Promise<WorkJournalIntake>;
}

/** Parses a note before it is stored or after it is read, so a store never holds a bad one. */
export function requireStoredWorkJournalNote(value: unknown): WorkJournalStoredNote {
  const parsed = workJournalStoredNoteSchema.safeParse(value);
  if (!parsed.success) {
    throw new WorkJournalStoreError("invalid_note", "The work journal note is invalid.");
  }
  return parsed.data;
}

const newestFirst = (left: WorkJournalStoredNote, right: WorkJournalStoredNote) =>
  right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id);

/** An in-memory store for one tenant. */
export function createMemoryWorkJournalNoteStore(): WorkJournalNoteStore {
  const notes = new Map<string, WorkJournalStoredNote>();
  const forgotten = new Map<string, string>();
  const intakes = new Map<string, WorkJournalIntake>();
  const all = () => [...notes.values()].sort(newestFirst);
  const live = (key: string) =>
    all().find((note) => note.dedupe_key === key && note.status !== "discarded");

  return {
    insert: async (input) => {
      const note = requireStoredWorkJournalNote(input);
      if (notes.has(note.id) || live(note.dedupe_key) !== undefined) {
        throw new WorkJournalStoreError("duplicate_key", "A note already holds this key.");
      }
      notes.set(note.id, note);
    },
    replace: async (input) => {
      const note = requireStoredWorkJournalNote(input);
      const stored = notes.get(note.id);
      if (stored === undefined || stored.workspace_id !== note.workspace_id) {
        throw new WorkJournalStoreError("note_not_found", "No such work journal note.");
      }
      const holder = note.status === "discarded" ? undefined : live(note.dedupe_key);
      if (holder !== undefined && holder.id !== note.id) {
        throw new WorkJournalStoreError("duplicate_key", "A note already holds this key.");
      }
      const { agent_token_id: _ignored, ...rest } = note;
      notes.set(note.id, {
        ...rest,
        created_at: stored.created_at,
        tenant_id: stored.tenant_id,
        ...(stored.agent_token_id === undefined ? {} : { agent_token_id: stored.agent_token_id }),
      });
    },
    get: async (workspaceId, id) => {
      const note = notes.get(id);
      return note?.workspace_id === workspaceId ? note : undefined;
    },
    holderOfKey: async (key) => {
      const note = live(key) ?? all().find((candidate) => candidate.dedupe_key === key);
      if (note !== undefined) return { kind: "note", note };
      const noteId = forgotten.get(key);
      return noteId === undefined ? undefined : { kind: "forgotten", noteId };
    },
    list: async ({ workspaceId, status, project, since, agentTokenId, limit }) =>
      all()
        .filter(
          (note) =>
            note.workspace_id === workspaceId &&
            (status === undefined || note.status === status) &&
            (project === undefined ||
              note.content.project.name.toLowerCase() === project.toLowerCase()) &&
            (since === undefined || note.created_at >= since) &&
            (agentTokenId === undefined ||
              note.agent_token_id === agentTokenId ||
              (note.amended_by_agent_token_ids ?? []).includes(agentTokenId)),
        )
        .slice(0, limit),
    pending: async (workspaceId) =>
      all().filter((note) => note.workspace_id === workspaceId && note.status === "pending"),
    countCreatedSince: async (workspaceId, since) =>
      all().filter((note) => note.workspace_id === workspaceId && note.created_at >= since).length,
    countPending: async () => all().filter((note) => note.status === "pending").length,
    deletePending: async (workspaceId) => {
      let count = 0;
      for (const note of all()) {
        if (note.workspace_id === workspaceId && note.status === "pending") {
          notes.delete(note.id);
          count += 1;
        }
      }
      return count;
    },
    forgetDiscarded: async (before) => {
      let count = 0;
      for (const note of all()) {
        if (note.status === "discarded" && note.updated_at < before) {
          notes.delete(note.id);
          forgotten.set(note.dedupe_key, note.id);
          count += 1;
        }
      }
      return count;
    },
    intake: async (workspaceId) => intakes.get(workspaceId) ?? { enabled: false },
    setIntake: async (workspaceId, enabled, at) => {
      const intake = { enabled, changedAt: at };
      intakes.set(workspaceId, intake);
      return intake;
    },
  };
}
