import { t } from "@lingui/core/macro";
/**
 * The guided career interview's view model (#1030, #2189): the shapes the screen reads, the words
 * for each turn and each refusal. The host fills them from its API; nothing here calls a server.
 */

export type CareerInterviewTopicStatus = "proposed" | "declined" | "open" | "summarised" | "closed";

export interface CareerInterviewTurnView {
  readonly role: "interviewer" | "candidate";
  readonly text: string;
  readonly mark?: "skipped" | "unknown" | undefined;
}

export interface CareerInterviewTopicView {
  readonly key: string;
  readonly kind: string;
  readonly reason: string;
  /** A short name from the record's own words (#2403); older sessions have none. */
  readonly title?: string | undefined;
  readonly status: CareerInterviewTopicStatus;
  readonly turns: readonly CareerInterviewTurnView[];
  readonly summary?: string | undefined;
}

export interface CareerInterviewSessionView {
  readonly id: string;
  readonly status: "open" | "paused" | "closed";
  readonly topics: readonly CareerInterviewTopicView[];
  readonly model?: { readonly provider: string; readonly model: string } | undefined;
  /** False when the server has no interviewer model, so no question can be asked. */
  readonly interviewerAvailable?: boolean | undefined;
  /** True when the server offers the live voice conversation on an open topic. */
  readonly liveVoiceAvailable?: boolean | undefined;
}

export interface CareerInterviewConflictView {
  readonly summaryValue: string;
  readonly factValue: string;
}

export type CareerInterviewTier = "normal" | "sensitive" | "never-share";

export type CareerInterviewAction =
  | { readonly action: "accept"; readonly topic_key: string }
  | { readonly action: "decline"; readonly topic_key: string }
  | { readonly action: "own_subject"; readonly subject: string }
  | { readonly action: "answer"; readonly topic_key: string; readonly text: string }
  | {
      readonly action: "answer";
      readonly topic_key: string;
      readonly mark: "skipped" | "unknown";
    }
  | {
      readonly action: "confirm";
      readonly topic_key: string;
      readonly knowledge_base_id: string;
      readonly tier: CareerInterviewTier;
      readonly summary?: string;
    }
  | { readonly action: "set_aside"; readonly topic_key: string }
  | { readonly action: "pause" }
  | { readonly action: "close" };

/** What a turn reads as on the screen: the speaker and their words, or what they chose. */
export function careerInterviewTurnText(turn: CareerInterviewTurnView): {
  readonly speaker: string;
  readonly text: string;
} {
  const speaker = turn.role === "interviewer" ? t`Interviewer` : t`You`;
  if (turn.mark === "skipped") return { speaker, text: t`Skipped this question.` };
  if (turn.mark === "unknown") return { speaker, text: t`Did not remember.` };
  return { speaker, text: turn.text };
}

const themeNames = (): Readonly<Record<string, string>> => ({
  volunteering: t`Volunteering`,
  mentoring: t`Mentoring`,
  teaching: t`Teaching`,
  speaking: t`Speaking at events`,
  awards: t`Awards`,
  "open source": t`Open source`,
  "side projects": t`Side projects`,
  leadership: t`Leadership`,
});

/**
 * A topic's name on the screen (#2403): its short title worded for its kind in the screen's
 * language, or its reason when an older session has no title.
 */
export function careerInterviewTopicTitle(topic: CareerInterviewTopicView): string {
  const title = topic.title;
  if (title === undefined || title.trim() === "") return topic.reason;
  switch (topic.kind) {
    case "untold-period":
      return t`The period ${title}`;
    case "untold-theme":
      return themeNames()[title] ?? title;
    case "application-relevance":
      return t`Asked in a job post: ${title}`;
    default:
      return title;
  }
}

/** The topic being talked through or waiting for confirmation, if any. */
export function careerInterviewActiveTopic(
  session: CareerInterviewSessionView,
): CareerInterviewTopicView | undefined {
  return (
    session.topics.find((topic) => topic.status === "summarised") ??
    session.topics.find((topic) => topic.status === "open")
  );
}

/** What the screen says instead of offering topics when the server has no interviewer model. */
export const careerInterviewUnavailableNotice = () =>
  t`The interviewer is not set up on this server, so it cannot ask questions yet. Whoever runs the server can turn on its Claude route. You can still add career facts by hand.`;

/** How many topics have been confirmed or set aside, of those the candidate took up. */
export function careerInterviewProgress(session: CareerInterviewSessionView): {
  readonly done: number;
  readonly taken: number;
} {
  const taken = session.topics.filter(
    (topic) => topic.status !== "proposed" && topic.status !== "declined",
  );
  return { done: taken.filter((topic) => topic.status === "closed").length, taken: taken.length };
}

const refusals = (): Readonly<Record<string, string>> => ({
  consent_required: t`The interviewer is Claude, by Anthropic, so your answers go to Anthropic to write each question. The interview needs your permission for that.`,
  interview_model_unavailable: t`This server has no model set up for the career interview. Ask whoever runs it to turn on the Claude route.`,
  topic_not_open: t`This topic is no longer being discussed. Reload to see where it stands.`,
  topic_not_summarised: t`This topic has no summary to confirm yet.`,
  too_many_topics: t`This session has enough topics. Finish or set one aside first.`,
  invalid_answer: t`Write your answer in a few words, up to 4,000 characters.`,
  session_not_found: t`This conversation could not be found. Start a new one.`,
});

/** A refused call as the host reports it: the code lets the screen offer a way through. */
export interface CareerInterviewRefused {
  readonly code: string;
  readonly message: string;
}

/** What a host call resolves with: nothing once it succeeded, or what to show. */
export type CareerInterviewProblem = string | CareerInterviewRefused | undefined;

/** The candidate-facing words for a refusal code, or the server's own message. */
export function careerInterviewRefusal(code: string | undefined, message: string): string {
  return (code === undefined ? undefined : refusals()[code]) ?? message;
}
