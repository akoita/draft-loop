/**
 * The guided career interview's method (#2188), derived from
 * `docs/reference/career-interview-method.md`: the interviewer's stance as prompt fragments, and a
 * strict rule check every interviewer turn passes before the candidate sees it. Change the guide
 * first, then this module.
 */

/** The interviewer's stance and techniques, as system prompt fragments in a stable order. */
export const careerInterviewMethodPrompt: readonly string[] = [
  "You are a professional career consultant helping a candidate tell their own career story. Be empathetic, patient, curious and non-judging. The candidate steers: they may pick another topic, skip, say they do not remember, or stop, and you accept each without pushing.",
  "Propose one or two topics at a time, each with its reason in plain words, phrased as a question. Accept a no. When no topic is worth raising, propose nothing.",
  "Ask exactly one open question per turn. Use affirmations, reflections and summaries. Draw out the situation, what the candidate did and what changed afterwards, and stop following up when the story has them or the candidate does not want to say more.",
  "When something the candidate says matters for the jobs they target, say so and offer to record it.",
  "For career breaks, layoffs, illness, family care or conflict: acknowledge, never ask for the reason, and let the candidate decide whether to go on. Record nothing about health or family unless the candidate explicitly asks.",
  "Never suggest a number, title, employer, date or outcome the candidate did not give. Never ask leading questions. Never promise a hiring result. Never give legal, medical or psychological advice; suggest a qualified person instead. You do not write CV claims.",
  "Close each topic with a short summary in the candidate's own terms and ask them to confirm or correct it.",
];

export type CareerInterviewRule =
  | "suggested-number"
  | "leading-question"
  | "several-questions"
  | "hiring-promise"
  | "out-of-scope-advice"
  | "asks-reason-for-break";

export interface CareerInterviewTurnContext {
  /**
   * Text the interviewer may repeat details from: the candidate's own words in this session and
   * the bounded topic context it was given. A number absent from it is a suggestion.
   */
  readonly allowedText: string;
}

export interface CareerInterviewTurnRefusal {
  readonly rule: CareerInterviewRule;
  /** The words that triggered the rule, for the run's user-visible record. */
  readonly excerpt: string;
}

export interface CareerInterviewTurnCheck {
  readonly accepted: boolean;
  readonly refusals: readonly CareerInterviewTurnRefusal[];
}

const numberPattern = /\d+(?:[.,]\d+)*/gu;

const leadingPatterns: readonly RegExp[] = [
  /\byou must have\b/iu,
  /\bsurely you\b/iu,
  /\byou probably\b/iu,
  /\bI bet you\b/iu,
  /\bI(?:'|’)m sure you\b/iu,
  /\b(?:did|didn(?:'|’)t|wasn(?:'|’)t|weren(?:'|’)t|haven(?:'|’)t|wouldn(?:'|’)t) you\b[^?]*\b(?:increase|increased|reduce|reduced|grow|grew|save|saved|improve|improved|lead|led|deliver|delivered|cut|double|doubled|win|won|boost|boosted)\b[^?]*\?/iu,
  /\bwould you say you\b[^?]*\b(?:led|drove|owned|transformed)\b/iu,
];

const promisePatterns: readonly RegExp[] = [
  /\bguarantee(?:s|d)?\b/iu,
  /\b(?:will|would) (?:get|land) you (?:the|a|an|this) (?:job|offer|interview|role)\b/iu,
  /\brecruiters (?:will|would) (?:love|hire|call)\b/iu,
  /\byou(?:'|’)ll (?:definitely|surely) (?:get|land)\b/iu,
];

const advicePatterns: readonly RegExp[] = [
  /\byou should (?:sue|file a (?:claim|complaint)|take legal action)\b/iu,
  /\b(?:legally|under the law),? you (?:are|were) entitled\b/iu,
  /\bthat sounds like (?:depression|burnout|anxiety|ptsd|adhd)\b/iu,
  /\byou (?:should|need to) (?:take|stop taking) (?:medication|antidepressants)\b/iu,
  /\byou (?:have|had|suffer from|suffered from) (?:depression|burnout|anxiety|ptsd|adhd)\b/iu,
];

const breakReasonPatterns: readonly RegExp[] = [
  /\bwhy (?:did you|were you) (?:leave|left|quit|stop|stopped|take|took|let go|laid off|fired|out of work)\b/iu,
  /\bwhat (?:caused|was the reason for|led to) (?:the|your|that) (?:break|gap|departure|layoff|dismissal|time off)\b/iu,
  /\bwhy (?:the|that|this) (?:gap|break)\b/iu,
];

function firstMatch(text: string, patterns: readonly RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match !== null) return match[0];
  }
  return undefined;
}

function digitsOf(value: string): string {
  return value.replace(/[.,]/gu, "");
}

/**
 * The strict rule check of the method guide. It refuses some acceptable turns rather than let a
 * suggestive one through; a refused turn is never shown to the candidate.
 */
export function checkCareerInterviewTurn(
  turn: string,
  context: CareerInterviewTurnContext,
): CareerInterviewTurnCheck {
  const refusals: CareerInterviewTurnRefusal[] = [];
  const allowedNumbers = new Set(
    [...context.allowedText.matchAll(numberPattern)].map((match) => digitsOf(match[0])),
  );
  for (const match of turn.matchAll(numberPattern)) {
    if (!allowedNumbers.has(digitsOf(match[0]))) {
      refusals.push({ rule: "suggested-number", excerpt: match[0] });
      break;
    }
  }
  const leading = firstMatch(turn, leadingPatterns);
  if (leading !== undefined) refusals.push({ rule: "leading-question", excerpt: leading });
  const questionCount = (turn.match(/\?/gu) ?? []).length;
  if (questionCount > 1) {
    refusals.push({ rule: "several-questions", excerpt: `${questionCount} questions` });
  }
  const promise = firstMatch(turn, promisePatterns);
  if (promise !== undefined) refusals.push({ rule: "hiring-promise", excerpt: promise });
  const advice = firstMatch(turn, advicePatterns);
  if (advice !== undefined) refusals.push({ rule: "out-of-scope-advice", excerpt: advice });
  const breakReason = firstMatch(turn, breakReasonPatterns);
  if (breakReason !== undefined) {
    refusals.push({ rule: "asks-reason-for-break", excerpt: breakReason });
  }
  return { accepted: refusals.length === 0, refusals };
}
