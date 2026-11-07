import { careerInterviewPhrases } from "./career-interview-phrases.js";

export { type CareerInterviewPhrases, careerInterviewPhrases } from "./career-interview-phrases.js";
import {
  type CareerInterviewRule,
  type CareerInterviewTurnRefusal,
  careerInterviewMethodPrompt,
  checkCareerInterviewTurn,
} from "./career-interview-method.js";

/**
 * The guided career interview's conversation (#2176): the turn policy around an interviewer port.
 * Topic proposals are worded here without a model; the port phrases follow-ups and summaries; every
 * model turn passes the method's rule check, is asked again once with the refused rules, and falls
 * back to a plain, safe turn. The port never sees more than the bounded topic context it is given.
 */

export interface CareerInterviewConversationTurn {
  readonly role: "interviewer" | "candidate";
  readonly text: string;
  readonly mark?: "skipped" | "unknown" | undefined;
}

/** A proposed topic as the conversation sees it: its reason and the bounded context it may use. */
export interface CareerInterviewConversationTopic {
  readonly kind: string;
  readonly reason: string;
  /** Record entries the topic read, already filtered to what may reach the provider. */
  readonly context: readonly string[];
}

export interface CareerInterviewerRequest {
  readonly instructions: readonly string[];
  readonly topic: CareerInterviewConversationTopic;
  /** Requirements of the candidate's own job posts, so the interviewer can point out value. */
  readonly targetThemes: readonly string[];
  readonly turns: readonly CareerInterviewConversationTurn[];
  /** Ask for a closing summary instead of another question. */
  readonly closing: boolean;
  /** Rules the previous attempt broke, when this is a second attempt. */
  readonly refusedRules: readonly CareerInterviewRule[];
}

export interface CareerInterviewerReply {
  /** The interviewer's turn: one question, or the summary's confirmation request. */
  readonly text: string;
  /** Present when the interviewer closes the topic: the story in the candidate's terms. */
  readonly summary?: string | undefined;
  readonly model: { readonly provider: string; readonly model: string };
}

export interface CareerInterviewerPort {
  reply(request: CareerInterviewerRequest): Promise<CareerInterviewerReply>;
}

export interface CareerInterviewNextTurn {
  readonly text: string;
  readonly summary?: string;
  /** True when the turn is the policy's safe fallback rather than the model's. */
  readonly fallback: boolean;
  /** Every refusal of this turn's attempts, for the session's user-visible record. */
  readonly refusals: readonly CareerInterviewTurnRefusal[];
  readonly model?: { readonly provider: string; readonly model: string };
}

export const maximumCareerInterviewFollowUps = 6;
const maximumAttempts = 2;

/** The English safe turns; `careerInterviewPhrases` gives them in the conversation's language. */
export const careerInterviewFallbackQuestion = careerInterviewPhrases("en").fallbackQuestion;
export const careerInterviewSummaryRequest = careerInterviewPhrases("en").summaryRequest;

/** The opening proposal, worded without a model so it never suggests a detail. */
export function careerInterviewProposal(
  topics: readonly Pick<CareerInterviewConversationTopic, "reason">[],
): string {
  if (topics.length === 0) {
    return "I have no topic to suggest today. Is there anything from your career you would like to tell me about?";
  }
  if (topics.length === 1) {
    return `${topics[0]?.reason} Would you like to talk about it, or about something else?`;
  }
  const listed = topics
    .slice(0, 2)
    .map((topic, index) => `${index + 1}. ${topic.reason}`)
    .join(" ");
  return `Two things may be worth telling. ${listed} Would you like to talk about one of them, or about something else?`;
}

function candidateWords(turns: readonly CareerInterviewConversationTurn[]): string[] {
  return turns
    .filter((turn) => turn.role === "candidate" && turn.mark === undefined && turn.text !== "")
    .map((turn) => turn.text);
}

/**
 * Whether the topic should close now: the follow-up budget is spent, or the candidate's last two
 * answers were skips or "I don't remember".
 */
export function careerInterviewShouldClose(
  turns: readonly CareerInterviewConversationTurn[],
): boolean {
  const answers = turns.filter((turn) => turn.role === "candidate");
  if (answers.length >= maximumCareerInterviewFollowUps) return true;
  const lastTwo = answers.slice(-2);
  return lastTwo.length === 2 && lastTwo.every((turn) => turn.mark !== undefined);
}

/** A summary made only of the candidate's own words, when the model's cannot be shown. */
function verbatimSummary(turns: readonly CareerInterviewConversationTurn[]): string | undefined {
  const words = candidateWords(turns);
  return words.length === 0 ? undefined : words.join(" ");
}

/**
 * The interviewer's next turn on a topic. Follow-ups pass every rule; a summary may only repeat
 * numbers the candidate or the topic context gave.
 */
export async function nextCareerInterviewTurn(
  port: CareerInterviewerPort,
  input: {
    readonly topic: CareerInterviewConversationTopic;
    readonly targetThemes?: readonly string[];
    readonly turns: readonly CareerInterviewConversationTurn[];
    /** The conversation's language, which the safe turns are said in (#2419); English by default. */
    readonly language?: string | undefined;
  },
): Promise<CareerInterviewNextTurn> {
  const phrases = careerInterviewPhrases(input.language);
  const closing = careerInterviewShouldClose(input.turns);
  const allowedText = [
    input.topic.reason,
    ...input.topic.context,
    ...candidateWords(input.turns),
  ].join("\n");
  const refusals: CareerInterviewTurnRefusal[] = [];
  let refusedRules: CareerInterviewRule[] = [];
  let model: CareerInterviewerReply["model"] | undefined;
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    const reply = await port.reply({
      instructions: careerInterviewMethodPrompt,
      topic: input.topic,
      targetThemes: input.targetThemes ?? [],
      turns: input.turns,
      closing,
      refusedRules,
    });
    model = reply.model;
    const turnRefusals = checkCareerInterviewTurn(reply.text, { allowedText }).refusals;
    const summary = reply.summary?.trim();
    const summaryRefusals =
      summary === undefined || summary === ""
        ? []
        : checkCareerInterviewTurn(summary, { allowedText }).refusals.filter(
            (refusal) => refusal.rule === "suggested-number",
          );
    const wantedSummary = closing && (summary === undefined || summary === "");
    if (turnRefusals.length === 0 && summaryRefusals.length === 0 && !wantedSummary) {
      return {
        text: reply.text.trim(),
        ...(summary === undefined || summary === "" ? {} : { summary }),
        fallback: false,
        refusals,
        model,
      };
    }
    refusals.push(...turnRefusals, ...summaryRefusals);
    refusedRules = [...new Set([...turnRefusals, ...summaryRefusals].map((r) => r.rule))];
  }
  if (closing) {
    const summary = verbatimSummary(input.turns);
    return {
      text: summary === undefined ? phrases.leaveTopic : phrases.summaryRequest,
      ...(summary === undefined ? {} : { summary }),
      fallback: true,
      refusals,
      ...(model === undefined ? {} : { model }),
    };
  }
  return {
    text: phrases.fallbackQuestion,
    fallback: true,
    refusals,
    ...(model === undefined ? {} : { model }),
  };
}
