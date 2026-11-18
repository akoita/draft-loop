/**
 * The Help panel's Ask conversation (#2883), kept out of the component so tests can run it
 * without a browser. The host fills `HelpSupport` from its API; the panel keeps the turns, since
 * the server stores no conversation until the member hands it to a person.
 */

export type HelpLanguage = "en" | "fr";

export interface HelpSourceRef {
  readonly id: string;
  readonly title: string;
}

/** What the host's support route answers. */
export interface HelpAskReply {
  readonly mode: "assistant" | "guide_search";
  readonly outcome: "answered" | "refused" | "needs_person" | null;
  /** Why a guide-search reply did not come from the assistant; absent from older hosts. */
  readonly reason?: HelpFallbackReason | null;
  readonly text: string | null;
  readonly sections: readonly HelpSourceRef[];
}

/** The server's reasons for answering with guide search instead of the assistant. */
export type HelpFallbackReason =
  | "disabled"
  | "member_rate"
  | "member_limit"
  | "cost_cap"
  | "question_too_long"
  | "model_failed"
  | "no_answer";

/** The reasons that are a limit, each with its own sentence instead of the generic one. */
export type HelpLimitReason = Extract<
  HelpFallbackReason,
  "member_rate" | "member_limit" | "cost_cap" | "question_too_long"
>;

export interface HelpSupport {
  /** Opens a conversation; `assistantAvailable` false hides Ask, since search does the same. */
  start(): Promise<{ readonly conversationId: string; readonly assistantAvailable: boolean }>;
  ask(input: {
    readonly conversationId: string;
    readonly question: string;
    readonly language: HelpLanguage;
    readonly history: readonly HelpTranscriptTurn[];
  }): Promise<HelpAskReply>;
  /** Hands the conversation to a person; absent where the host has no one to hand it to. */
  readonly handoff?: (input: {
    readonly conversationId: string;
    readonly transcript: readonly HelpTranscriptTurn[];
  }) => Promise<void>;
}

export interface HelpTranscriptTurn {
  readonly role: "member" | "assistant";
  readonly text: string;
}

export interface HelpTurn extends HelpTranscriptTurn {
  readonly sources: readonly HelpSourceRef[];
  /** The assistant could not answer and pointed at matching sections instead. */
  readonly fallback: boolean;
  readonly needsPerson: boolean;
}

/** The longest question the support route takes. */
export const maximumHelpQuestionLength = 1000;
const maximumTurns = 20;
const maximumTurnLength = 2000;

export function memberTurn(question: string): HelpTurn {
  return {
    role: "member",
    text: question.trim(),
    sources: [],
    fallback: false,
    needsPerson: false,
  };
}

/**
 * The assistant's turn. A guide-search reply has no text of its own, so it carries the screen's
 * sentence for it: the limit's own sentence when a limit stopped the assistant, otherwise
 * `fallbackText` when sections match and `noMatchText` when none do.
 */
export function assistantTurn(
  reply: HelpAskReply,
  words: {
    readonly fallbackText: string;
    readonly noMatchText: string;
    readonly limitText?: Readonly<Record<HelpLimitReason, string>>;
    /** Follows a limit's sentence when guide sections match. */
    readonly sectionsText?: string;
  },
): HelpTurn {
  const sources = reply.sections.map(({ id, title }) => ({ id, title }));
  if (reply.mode === "guide_search" || reply.text === null) {
    const reason = reply.reason ?? null;
    const limited =
      reason !== null && words.limitText !== undefined && reason in words.limitText
        ? words.limitText[reason as HelpLimitReason]
        : undefined;
    return {
      role: "assistant",
      text:
        limited === undefined
          ? sources.length === 0
            ? words.noMatchText
            : words.fallbackText
          : sources.length === 0 || words.sectionsText === undefined
            ? limited
            : `${limited} ${words.sectionsText}`,
      sources,
      fallback: true,
      // A limit is no reason to call a person; the member waits or reads the guide.
      needsPerson: sources.length === 0 && limited === undefined,
    };
  }
  return {
    role: "assistant",
    text: reply.text,
    sources,
    fallback: false,
    needsPerson: reply.outcome === "needs_person",
  };
}

/** The turns as the support routes take them: oldest first, bounded. */
export function transcriptOf(turns: readonly HelpTurn[]): readonly HelpTranscriptTurn[] {
  return turns
    .slice(-maximumTurns)
    .map(({ role, text }) => ({ role, text: text.slice(0, maximumTurnLength) }))
    .filter((turn) => turn.text !== "");
}

/** Whether to offer Talk to a person right away: the last answer asked for one. */
export function offersPerson(turns: readonly HelpTurn[]): boolean {
  const last = turns.at(-1);
  return last?.role === "assistant" && last.needsPerson;
}
