import { randomBytes } from "node:crypto";
import type { SourceSensitivityTier } from "@draft-loop/domain/source-sensitivity";
import {
  type CareerInterviewConversationTopic,
  type CareerInterviewerPort,
  careerInterviewShouldClose,
  nextCareerInterviewTurn,
} from "@draft-loop/orchestrator";
import {
  type CareerInterviewSession,
  type CareerInterviewSessionTopic,
  type CareerInterviewTurn,
  maximumCareerInterviewSummaryCharacters,
  maximumCareerInterviewTopicsPerSession,
  maximumCareerInterviewTurnCharacters,
} from "@draft-loop/schemas/career-interview";
import type { CareerInterviewSessionStore } from "@draft-loop/storage/career-interview-sessions";

import {
  type CareerInterviewConflict,
  type CareerInterviewPublish,
  type CareerInterviewPublished,
  careerInterviewConflicts,
} from "./career-interview-evidence.js";
import {
  type CareerInterviewFact,
  type CareerInterviewRequirement,
  type CareerInterviewTopic,
  findCareerInterviewTopics,
} from "./career-interview-topics.js";
import { careerInterviewTopicContext } from "./career-interviewer-model.js";

/**
 * The guided career interview's session service (#2177): start or resume a session with topics
 * from the finder, accept, decline or bring an own subject, answer, and confirm or set aside each
 * topic's summary. Only a confirmed summary becomes evidence; nothing in the record is overwritten.
 */

export type CareerInterviewErrorCode =
  | "session_not_found"
  | "topic_not_found"
  | "topic_not_open"
  | "topic_not_summarised"
  | "too_many_topics"
  | "invalid_answer";

export class CareerInterviewError extends Error {
  readonly code: CareerInterviewErrorCode;

  constructor(code: CareerInterviewErrorCode, message: string) {
    super(message);
    this.name = "CareerInterviewError";
    this.code = code;
  }
}

/** What the record holds for one workspace, read when a session starts or a summary is checked. */
export interface CareerInterviewRecord {
  readonly facts: readonly CareerInterviewFact[];
  readonly requirements: readonly CareerInterviewRequirement[];
  /** The host's sensitivity rules: whether a fact may reach the provider. */
  readonly mayTransmit: (fact: CareerInterviewFact) => boolean;
}

export interface CareerInterviewServiceOptions {
  readonly store: CareerInterviewSessionStore;
  readonly loadRecord: (workspaceId: string) => Promise<CareerInterviewRecord>;
  readonly interviewer: (workspaceId: string, sessionId: string) => CareerInterviewerPort;
  readonly publish: CareerInterviewPublish;
  readonly now?: () => string;
  readonly newId?: () => string;
  /** The conversation's language (the screen's): the safe turns and evidence follow it (#2419). */
  readonly language?: string | undefined;
  /** Topics offered at the start of a session; two by default, as the method guide says. */
  readonly topicsPerProposal?: number;
}

export type CareerInterviewAnswer =
  | { readonly text: string }
  | { readonly mark: "skipped" | "unknown" };

export interface CareerInterviewConfirmInput {
  readonly knowledgeBaseId: string;
  readonly tier: SourceSensitivityTier;
  /** The candidate's edit of the summary; the interviewer's stands when absent. */
  readonly summary?: string;
}

export interface CareerInterviewService {
  /** The newest unfinished session, or a new one proposing the finder's top topics. */
  start(workspaceId: string): Promise<CareerInterviewSession>;
  get(workspaceId: string, sessionId: string): Promise<CareerInterviewSession>;
  list(workspaceId: string, limit?: number): Promise<readonly CareerInterviewSession[]>;
  accept(workspaceId: string, sessionId: string, topicKey: string): Promise<CareerInterviewSession>;
  decline(
    workspaceId: string,
    sessionId: string,
    topicKey: string,
  ): Promise<CareerInterviewSession>;
  /** The candidate brings their own subject instead of a proposed one. */
  ownSubject(
    workspaceId: string,
    sessionId: string,
    subject: string,
  ): Promise<CareerInterviewSession>;
  answer(
    workspaceId: string,
    sessionId: string,
    topicKey: string,
    answer: CareerInterviewAnswer,
  ): Promise<CareerInterviewSession>;
  /** Summary statements that disagree with the record, shown beside it before confirmation. */
  conflicts(
    workspaceId: string,
    sessionId: string,
    topicKey: string,
  ): Promise<readonly CareerInterviewConflict[]>;
  confirm(
    workspaceId: string,
    sessionId: string,
    topicKey: string,
    input: CareerInterviewConfirmInput,
  ): Promise<{
    readonly session: CareerInterviewSession;
    readonly published: CareerInterviewPublished;
  }>;
  setAside(
    workspaceId: string,
    sessionId: string,
    topicKey: string,
  ): Promise<CareerInterviewSession>;
  pause(workspaceId: string, sessionId: string): Promise<CareerInterviewSession>;
  close(workspaceId: string, sessionId: string): Promise<CareerInterviewSession>;
}

function defaultSessionId(): string {
  return `cis_${randomBytes(12).toString("base64url")}`;
}

function sessionTopic(topic: CareerInterviewTopic): CareerInterviewSessionTopic {
  return {
    key: topic.key,
    kind: topic.kind,
    reason: topic.reason,
    ...(topic.title === undefined ? {} : { title: topic.title }),
    ...(topic.missing === undefined || topic.missing.length === 0
      ? {}
      : { missing: [...topic.missing] }),
    status: "proposed",
    fact_ids: [...topic.factIds],
    requirement_ids: [...topic.requirementIds],
    turns: [],
  };
}

export function createCareerInterviewService(
  options: CareerInterviewServiceOptions,
): CareerInterviewService {
  const { store } = options;
  const now = options.now ?? (() => new Date().toISOString());
  const newId = options.newId ?? defaultSessionId;
  const perProposal = options.topicsPerProposal ?? 2;

  const requireSession = async (workspaceId: string, sessionId: string) => {
    const session = await store.get(workspaceId, sessionId);
    if (session === undefined) {
      throw new CareerInterviewError("session_not_found", "There is no such interview session.");
    }
    return session;
  };

  const topicIndex = (session: CareerInterviewSession, topicKey: string) => {
    const index = session.topics.findIndex((topic) => topic.key === topicKey);
    if (index < 0) {
      throw new CareerInterviewError("topic_not_found", "The session has no such topic.");
    }
    return index;
  };

  const save = async (
    session: CareerInterviewSession,
    change: Partial<CareerInterviewSession>,
  ): Promise<CareerInterviewSession> => {
    const next = { ...session, ...change, updated_at: now() };
    await store.replace(next);
    return next;
  };

  const withTopic = (
    session: CareerInterviewSession,
    index: number,
    topic: CareerInterviewSessionTopic,
  ): CareerInterviewSessionTopic[] =>
    session.topics.map((existing, position) => (position === index ? topic : existing));

  const conversationTopic = async (
    workspaceId: string,
    topic: CareerInterviewSessionTopic,
  ): Promise<{ topic: CareerInterviewConversationTopic; themes: string[] }> => {
    const record = await options.loadRecord(workspaceId);
    const bounded = careerInterviewTopicContext(
      { kind: topic.kind, reason: topic.reason, factIds: topic.fact_ids },
      record.facts,
      record.mayTransmit,
    );
    const themes = record.requirements
      .filter((requirement) => topic.requirement_ids.includes(requirement.id))
      .map((requirement) => requirement.text);
    return { topic: bounded, themes };
  };

  /** Appends the interviewer's next turn, closing the topic with a summary when the policy does. */
  const interviewerTurn = async (
    workspaceId: string,
    session: CareerInterviewSession,
    index: number,
    topic: CareerInterviewSessionTopic,
  ): Promise<CareerInterviewSession> => {
    const { topic: bounded, themes } = await conversationTopic(workspaceId, topic);
    const next = await nextCareerInterviewTurn(options.interviewer(workspaceId, session.id), {
      topic: bounded,
      targetThemes: themes,
      turns: topic.turns,
      language: options.language,
    });
    const turn: CareerInterviewTurn = { role: "interviewer", text: next.text, at: now() };
    const closing = next.summary !== undefined;
    const settledAside = !closing && careerInterviewShouldClose(topic.turns);
    const updated: CareerInterviewSessionTopic = {
      ...topic,
      turns: [...topic.turns, turn],
      status: closing ? "summarised" : settledAside ? "closed" : "open",
      ...(closing
        ? { summary: next.summary?.slice(0, maximumCareerInterviewSummaryCharacters) }
        : {}),
    };
    return save(session, {
      topics: withTopic(session, index, updated),
      ...(next.model === undefined ? {} : { model: next.model }),
    });
  };

  return {
    start: async (workspaceId) => {
      const unfinished = await store.latestUnfinished(workspaceId);
      if (unfinished !== undefined) {
        return unfinished.status === "paused" ? save(unfinished, { status: "open" }) : unfinished;
      }
      const record = await options.loadRecord(workspaceId);
      const declinedTopicKeys = await store.declinedTopicKeys(workspaceId);
      const topics = findCareerInterviewTopics({
        facts: record.facts,
        requirements: record.requirements,
        declinedTopicKeys,
        maximumTopics: perProposal,
      });
      const at = now();
      const session: CareerInterviewSession = {
        id: newId(),
        workspace_id: workspaceId,
        status: "open",
        topics: topics.map(sessionTopic),
        created_at: at,
        updated_at: at,
      };
      await store.insert(session);
      return session;
    },
    get: requireSession,
    list: (workspaceId, limit = 20) => store.list(workspaceId, limit),
    accept: async (workspaceId, sessionId, topicKey) => {
      const session = await requireSession(workspaceId, sessionId);
      const index = topicIndex(session, topicKey);
      const topic = session.topics[index] as CareerInterviewSessionTopic;
      if (topic.status !== "proposed") {
        throw new CareerInterviewError("topic_not_open", "Only a proposed topic can be accepted.");
      }
      return interviewerTurn(workspaceId, session, index, { ...topic, status: "open" });
    },
    decline: async (workspaceId, sessionId, topicKey) => {
      const session = await requireSession(workspaceId, sessionId);
      const index = topicIndex(session, topicKey);
      const topic = session.topics[index] as CareerInterviewSessionTopic;
      if (topic.status !== "proposed") {
        throw new CareerInterviewError("topic_not_open", "Only a proposed topic can be declined.");
      }
      return save(session, { topics: withTopic(session, index, { ...topic, status: "declined" }) });
    },
    ownSubject: async (workspaceId, sessionId, subject) => {
      const session = await requireSession(workspaceId, sessionId);
      const text = subject.trim();
      if (text === "" || text.length > 300) {
        throw new CareerInterviewError("invalid_answer", "Name the subject in a few words.");
      }
      if (session.topics.length >= maximumCareerInterviewTopicsPerSession) {
        throw new CareerInterviewError("too_many_topics", "This session has enough topics.");
      }
      const topic: CareerInterviewSessionTopic = {
        key: `candidate-subject:${session.topics.length + 1}:${text.toLowerCase().slice(0, 80)}`,
        kind: "candidate-subject",
        reason: `You chose to talk about: ${text}`,
        title: text.length <= 200 ? text : `${text.slice(0, 199)}…`,
        status: "open",
        fact_ids: [],
        requirement_ids: [],
        turns: [],
      };
      const added = { ...session, topics: [...session.topics, topic] };
      return interviewerTurn(workspaceId, added, added.topics.length - 1, topic);
    },
    answer: async (workspaceId, sessionId, topicKey, answer) => {
      const session = await requireSession(workspaceId, sessionId);
      const index = topicIndex(session, topicKey);
      const topic = session.topics[index] as CareerInterviewSessionTopic;
      if (topic.status !== "open") {
        throw new CareerInterviewError("topic_not_open", "This topic is not being discussed.");
      }
      let turn: CareerInterviewTurn;
      if ("mark" in answer) {
        turn = { role: "candidate", text: "", mark: answer.mark, at: now() };
      } else {
        const text = answer.text.trim();
        if (text === "" || text.length > maximumCareerInterviewTurnCharacters) {
          throw new CareerInterviewError(
            "invalid_answer",
            `Answer in up to ${maximumCareerInterviewTurnCharacters} characters.`,
          );
        }
        turn = { role: "candidate", text, at: now() };
      }
      return interviewerTurn(workspaceId, session, index, {
        ...topic,
        turns: [...topic.turns, turn],
      });
    },
    conflicts: async (workspaceId, sessionId, topicKey) => {
      const session = await requireSession(workspaceId, sessionId);
      const topic = session.topics[topicIndex(session, topicKey)] as CareerInterviewSessionTopic;
      if (topic.summary === undefined || topic.kind !== "role-gap") return [];
      const record = await options.loadRecord(workspaceId);
      const read = new Set(topic.fact_ids);
      return careerInterviewConflicts(
        topic.summary,
        record.facts.filter((fact) => read.has(fact.id)),
      );
    },
    confirm: async (workspaceId, sessionId, topicKey, input) => {
      const session = await requireSession(workspaceId, sessionId);
      const index = topicIndex(session, topicKey);
      const topic = session.topics[index] as CareerInterviewSessionTopic;
      if (topic.status !== "summarised") {
        throw new CareerInterviewError(
          "topic_not_summarised",
          "Only a summarised topic can be confirmed.",
        );
      }
      const summary = input.summary?.trim() || topic.summary;
      if (summary === undefined || summary.length > maximumCareerInterviewSummaryCharacters) {
        throw new CareerInterviewError("invalid_answer", "The summary is empty or too long.");
      }
      const confirmed = { ...topic, summary, status: "closed" as const };
      const pending = { ...session, topics: withTopic(session, index, confirmed) };
      const published = await options.publish({
        session: pending,
        topicIndex: index,
        knowledgeBaseId: input.knowledgeBaseId,
        tier: input.tier,
      });
      return { session: await save(session, { topics: pending.topics }), published };
    },
    setAside: async (workspaceId, sessionId, topicKey) => {
      const session = await requireSession(workspaceId, sessionId);
      const index = topicIndex(session, topicKey);
      const topic = session.topics[index] as CareerInterviewSessionTopic;
      return save(session, { topics: withTopic(session, index, { ...topic, status: "closed" }) });
    },
    pause: async (workspaceId, sessionId) =>
      save(await requireSession(workspaceId, sessionId), { status: "paused" }),
    close: async (workspaceId, sessionId) =>
      save(await requireSession(workspaceId, sessionId), { status: "closed" }),
  };
}
