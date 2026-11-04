import {
  type CareerInterviewSession,
  careerInterviewSessionSchema,
} from "@draft-loop/schemas/career-interview";

/**
 * One tenant's guided career interview sessions (#2175): topics, turns and where each session
 * stopped, so a candidate resumes across days. This module holds the port, its errors and an
 * in-memory implementation for tests and single-process stacks; Postgres implements it too.
 */

export type CareerInterviewStoreErrorCode =
  /** A session with that id already exists. */
  | "duplicate_session"
  /** No session with that id in that workspace. */
  | "session_not_found"
  | "invalid_session";

export class CareerInterviewStoreError extends Error {
  readonly code: CareerInterviewStoreErrorCode;

  constructor(code: CareerInterviewStoreErrorCode, message: string) {
    super(message);
    this.name = "CareerInterviewStoreError";
    this.code = code;
  }
}

export interface CareerInterviewSessionStore {
  insert(session: CareerInterviewSession): Promise<void>;
  /** Replaces a session's state; its id, workspace and creation time never change. */
  replace(session: CareerInterviewSession): Promise<void>;
  get(workspaceId: string, id: string): Promise<CareerInterviewSession | undefined>;
  /** Newest first. */
  list(workspaceId: string, limit: number): Promise<readonly CareerInterviewSession[]>;
  /** The newest session not closed, which a returning candidate resumes. */
  latestUnfinished(workspaceId: string): Promise<CareerInterviewSession | undefined>;
  /** Keys of every topic the candidate declined in the workspace, across sessions. */
  declinedTopicKeys(workspaceId: string): Promise<ReadonlySet<string>>;
}

/** Parses a session before it is stored or after it is read, so a store never holds a bad one. */
export function requireCareerInterviewSession(value: unknown): CareerInterviewSession {
  const parsed = careerInterviewSessionSchema.safeParse(value);
  if (!parsed.success) {
    throw new CareerInterviewStoreError("invalid_session", "The interview session is invalid.");
  }
  return parsed.data;
}

const newestFirst = (left: CareerInterviewSession, right: CareerInterviewSession) =>
  right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id);

/** An in-memory store for one tenant. */
export function createMemoryCareerInterviewSessionStore(): CareerInterviewSessionStore {
  const sessions = new Map<string, CareerInterviewSession>();
  const ofWorkspace = (workspaceId: string) =>
    [...sessions.values()]
      .filter((session) => session.workspace_id === workspaceId)
      .sort(newestFirst);

  return {
    insert: async (input) => {
      const session = requireCareerInterviewSession(input);
      if (sessions.has(session.id)) {
        throw new CareerInterviewStoreError("duplicate_session", "The session already exists.");
      }
      sessions.set(session.id, session);
    },
    replace: async (input) => {
      const session = requireCareerInterviewSession(input);
      const stored = sessions.get(session.id);
      if (stored === undefined || stored.workspace_id !== session.workspace_id) {
        throw new CareerInterviewStoreError("session_not_found", "No such interview session.");
      }
      sessions.set(session.id, { ...session, created_at: stored.created_at });
    },
    get: async (workspaceId, id) => {
      const session = sessions.get(id);
      return session?.workspace_id === workspaceId ? session : undefined;
    },
    list: async (workspaceId, limit) => ofWorkspace(workspaceId).slice(0, limit),
    latestUnfinished: async (workspaceId) =>
      ofWorkspace(workspaceId).find((session) => session.status !== "closed"),
    declinedTopicKeys: async (workspaceId) =>
      new Set(
        ofWorkspace(workspaceId).flatMap((session) =>
          session.topics.filter((topic) => topic.status === "declined").map((topic) => topic.key),
        ),
      ),
  };
}
