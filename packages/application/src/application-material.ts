/**
 * Application material (#2215): one cover letter or one set of interview questions for an
 * application, drafted from the career record by a model behind `ApplicationMaterialPort`. The
 * module is pure: it builds the bounded context, asks the port, and refuses any draft that cites a
 * fact the candidate did not allow or states a number no cited fact holds. It never stores a draft.
 */

import {
  type CanonicalCandidateProfileFactCategory,
  canonicalCandidateProfileFactCategories,
} from "@draft-loop/domain";
import {
  type FactUsagePurpose,
  type FactUsageSettings,
  factUsageAllows,
  resolveFactUsage,
} from "@draft-loop/domain/fact-usage";

/** The parts of a canonical profile fact the drafter reads. */
export interface ApplicationMaterialFact {
  readonly id: string;
  readonly category: string;
  readonly field: string;
  readonly value: string;
  /**
   * The role, project or other subject the fact belongs to. Facts that share one may be joined in
   * one claim, such as an outcome at that employer; facts that do not, never.
   */
  readonly subjectId?: string | undefined;
}

/** A requirement from the application's job post: untrusted third-party text. */
export interface ApplicationMaterialRequirement {
  readonly id: string;
  readonly text: string;
  readonly priority: "critical" | "high" | "medium" | "low";
}

export const applicationMaterialKinds = ["cover-letter", "interview-questions"] as const;
export type ApplicationMaterialKind = (typeof applicationMaterialKinds)[number];

/** What reaches the model: allowed facts and the application's requirements, bounded. */
export interface ApplicationMaterialContext {
  readonly kind: ApplicationMaterialKind;
  readonly facts: readonly {
    readonly id: string;
    readonly text: string;
    /** The fact's subject, shared by the facts of one role or project; absent for a lone fact. */
    readonly group?: string;
  }[];
  readonly requirements: readonly {
    readonly id: string;
    readonly text: string;
    readonly priority: ApplicationMaterialRequirement["priority"];
  }[];
  /** The language the material is written in; absent or English adds nothing to the prompt. */
  readonly language?: string;
}

/**
 * One paragraph of a cover letter, or one interview question with its talking point. `question`
 * is empty for a cover letter paragraph.
 */
export interface ApplicationMaterialItem {
  readonly question: string;
  readonly text: string;
  readonly factIds: readonly string[];
}

export interface ApplicationMaterialModelIdentity {
  readonly provider: string;
  readonly model: string;
}

export interface ApplicationMaterialRequest {
  readonly context: ApplicationMaterialContext;
  /** Rules the previous attempt broke, so the model can avoid them; empty on the first call. */
  readonly refusedRules: readonly string[];
}

export interface ApplicationMaterialReply {
  readonly items: readonly ApplicationMaterialItem[];
  readonly model?: ApplicationMaterialModelIdentity;
}

/** Anything that drafts application material, such as a model adapter or a scripted fake. */
export interface ApplicationMaterialPort {
  draft(request: ApplicationMaterialRequest): Promise<ApplicationMaterialReply>;
}

export interface ApplicationMaterialDraft {
  readonly kind: ApplicationMaterialKind;
  readonly items: readonly ApplicationMaterialItem[];
  readonly model?: ApplicationMaterialModelIdentity;
}

export type ApplicationMaterialViolationCode =
  | "empty_draft"
  | "too_many_items"
  | "text_too_long"
  | "missing_question"
  | "missing_citation"
  | "record_language"
  | "unknown_fact"
  | "fact_not_allowed"
  | "unsupported_number";

export interface ApplicationMaterialViolation {
  readonly code: ApplicationMaterialViolationCode;
  /** The item's position in the draft, when the violation belongs to one item. */
  readonly item?: number;
  readonly detail: string;
}

export class ApplicationMaterialError extends Error {
  readonly code: "no_facts" | "invalid_draft";
  readonly violations: readonly ApplicationMaterialViolation[];

  constructor(
    code: "no_facts" | "invalid_draft",
    message: string,
    violations: readonly ApplicationMaterialViolation[] = [],
  ) {
    super(message);
    this.name = "ApplicationMaterialError";
    this.code = code;
    this.violations = violations;
  }
}

/** The categories the drafter never needs: who the candidate is and how to reach them. */
export const withheldApplicationMaterialCategories: ReadonlySet<string> = new Set([
  "identity",
  "contact",
]);
export const maximumApplicationMaterialFacts = 60;
export const maximumApplicationMaterialRequirements = 20;
const maximumContextCharacters = 300;
export const maximumApplicationMaterialItems: Readonly<Record<ApplicationMaterialKind, number>> = {
  "cover-letter": 6,
  "interview-questions": 10,
};
export const maximumApplicationMaterialItemCharacters = 1_200;

export interface ApplicationMaterialContextInput {
  readonly kind: ApplicationMaterialKind;
  readonly facts: readonly ApplicationMaterialFact[];
  readonly requirements: readonly ApplicationMaterialRequirement[];
  /** The host's sensitivity rules: whether a fact may reach the provider. */
  readonly mayTransmit?: (fact: ApplicationMaterialFact) => boolean;
  /** Where each fact may be used (#2260); every fact is `cv` when unset. */
  readonly usage?: FactUsageSettings;
  /** The application's document language (#2316); English when unset. */
  readonly language?: string;
}

/**
 * What each kind of material uses facts for: interview questions are interview preparation, and a
 * cover letter is written application material, read like the CV.
 */
export const applicationMaterialUsagePurpose: Readonly<
  Record<ApplicationMaterialKind, FactUsagePurpose>
> = { "cover-letter": "cv", "interview-questions": "interview" };

function usageAllows(input: ApplicationMaterialContextInput, fact: ApplicationMaterialFact) {
  if (input.usage === undefined) return true;
  if (!(canonicalCandidateProfileFactCategories as readonly string[]).includes(fact.category)) {
    return true;
  }
  const level = resolveFactUsage(input.usage, {
    category: fact.category as CanonicalCandidateProfileFactCategory,
    field: fact.field,
    value: fact.value,
  });
  return factUsageAllows(level, applicationMaterialUsagePurpose[input.kind]);
}

/**
 * Whether the candidate allowed a fact to reach the model: never identity or contact, never a fact
 * the sensitivity rules withhold, and never one whose usage level excludes this kind of material.
 */
function allowedFact(input: ApplicationMaterialContextInput, fact: ApplicationMaterialFact) {
  return (
    !withheldApplicationMaterialCategories.has(fact.category) &&
    (input.mayTransmit === undefined || input.mayTransmit(fact)) &&
    usageAllows(input, fact)
  );
}

const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 } as const;

/**
 * The bounded context: allowed facts, then the job's requirements by priority. Each entry is
 * capped in length; the requirements are data for the model, never instructions.
 */
export function applicationMaterialContext(
  input: ApplicationMaterialContextInput,
): ApplicationMaterialContext {
  const facts = input.facts
    .filter((fact) => allowedFact(input, fact))
    .slice(0, maximumApplicationMaterialFacts)
    .map((fact) => ({
      id: fact.id,
      text: `${fact.category} ${fact.field}: ${fact.value}`.slice(0, maximumContextCharacters),
      ...(fact.subjectId === undefined || fact.subjectId === ""
        ? {}
        : { group: fact.subjectId.slice(0, 64) }),
    }));
  const requirements = [...input.requirements]
    .sort((left, right) => priorityOrder[left.priority] - priorityOrder[right.priority])
    .slice(0, maximumApplicationMaterialRequirements)
    .map((requirement) => ({
      id: requirement.id,
      text: requirement.text.slice(0, maximumContextCharacters),
      priority: requirement.priority,
    }));
  return {
    kind: input.kind,
    facts,
    requirements,
    ...(input.language === undefined ? {} : { language: input.language }),
  };
}

const numberPattern = /\d+(?:[.,]\d+)*/gu;

/**
 * Number words a draft could state a quantity with (#2218's walk: "five years" passed a
 * digits-only check). "One" is left out: it reads as a pronoun ("one of my skills") far more
 * often than as a count.
 */
const englishNumberWords: Readonly<Record<string, number>> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  thousand: 1_000,
  million: 1_000_000,
  billion: 1_000_000_000,
  dozen: 12,
};

/**
 * The French number words (#2320). "Un" and "une" are articles far more often than counts, and
 * "neuf" also means "new", so they are left out; "six" and "million" are shared with English.
 */
const frenchNumberWords: Readonly<Record<string, number>> = {
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  sept: 7,
  huit: 8,
  dix: 10,
  onze: 11,
  douze: 12,
  treize: 13,
  quatorze: 14,
  quinze: 15,
  seize: 16,
  vingt: 20,
  trente: 30,
  quarante: 40,
  cinquante: 50,
  soixante: 60,
  cent: 100,
  mille: 1_000,
  milliard: 1_000_000_000,
  douzaine: 12,
};

const numberWords: Readonly<Record<string, number>> = {
  ...englishNumberWords,
  ...frenchNumberWords,
};
const wordsForNumber = new Map<number, string[]>();
for (const [word, value] of Object.entries(numberWords)) {
  wordsForNumber.set(value, [...(wordsForNumber.get(value) ?? []), word]);
}

/** A quantity stated in a draft: as written, and as a digit string when it is a word. */
interface StatedNumber {
  readonly written: string;
  readonly digits: string;
}

function numbersIn(text: string): StatedNumber[] {
  const digits = [...text.matchAll(numberPattern)].map((match) => ({
    written: match[0],
    digits: match[0],
  }));
  const words = [...text.toLowerCase().matchAll(/\p{L}+/gu)].flatMap((match) => {
    const value = numberWords[match[0]];
    return value === undefined ? [] : [{ written: match[0], digits: String(value) }];
  });
  return [...digits, ...words];
}

function digitsIn(source: string, number: string): boolean {
  const pattern = new RegExp(
    `(?<![\\d.,])${number.replace(/[.,]/gu, "[.,]")}(?![\\d]|[.,]\\d)`,
    "u",
  );
  return pattern.test(source);
}

function wordIn(source: string, word: string): boolean {
  return new RegExp(`(?<!\\p{L})${word}(?!\\p{L})`, "iu").test(source);
}

/**
 * Whether a number stated in the draft appears in one of the sources, as a whole number in
 * digits or in words: "five" is supported by "5" or "five", and "10" by "10" or "ten".
 */
function supported(number: StatedNumber, sources: readonly string[]): boolean {
  const words = wordsForNumber.get(Number(number.digits)) ?? [];
  const written = /^\p{L}+$/u.test(number.written) ? number.written : undefined;
  return sources.some(
    (source) =>
      digitsIn(source, number.digits) ||
      (written !== undefined && wordIn(source, written)) ||
      words.some((word) => wordIn(source, word)),
  );
}

/**
 * Wording that talks about the career record or the drafting rules instead of the candidate's
 * work (#2218's second walk: "SQL is one of my listed skills", "without claiming more than the
 * record shows"). A candidate would never send it.
 */
const recordLanguage =
  /\b(?:my|the|your|on) record\b|\blisted (?:skills?|as)\b|\b(?:named|listed) skill\b|\bclaim(?:ing)? more than\b|\bcitations?\b/iu;

/** The longest courtesy sentence a cover letter may open or close with, uncited. */
export const maximumCourtesyCharacters = 300;

/** Words of five letters or more in the record's facts, which a courtesy item may not reuse. */
function factWords(facts: readonly ApplicationMaterialFact[]): Set<string> {
  return new Set(
    facts.flatMap((fact) =>
      [...fact.value.toLowerCase().matchAll(/\p{L}{5,}/gu)].map((match) => match[0]),
    ),
  );
}

/**
 * Whether an uncited item is a courtesy sentence: the first or last paragraph of a cover letter,
 * short, with no number and no word taken from a fact. Requiring a citation there only padded it
 * with facts the sentence did not state (#2218's second walk).
 */
function courtesyItem(
  input: ApplicationMaterialContextInput,
  count: number,
  index: number,
  item: ApplicationMaterialItem,
): boolean {
  if (input.kind !== "cover-letter" || (index !== 0 && index !== count - 1)) return false;
  if (item.text.length > maximumCourtesyCharacters || numbersIn(item.text).length > 0) return false;
  const words = factWords(input.facts);
  return ![...item.text.toLowerCase().matchAll(/\p{L}{5,}/gu)].some((match) => words.has(match[0]));
}

/**
 * Every rule a draft breaks. A paragraph or talking point cites at least one fact of the context;
 * a fact outside the allowed set, even one the record holds, is refused; every number in the text
 * appears in a cited fact. A question may also repeat a number from the job's requirements.
 */
export function applicationMaterialViolations(
  input: ApplicationMaterialContextInput,
  items: readonly ApplicationMaterialItem[],
): ApplicationMaterialViolation[] {
  const context = applicationMaterialContext(input);
  const sent = new Set(context.facts.map((fact) => fact.id));
  const allowed = new Map(
    input.facts.filter((fact) => sent.has(fact.id)).map((fact) => [fact.id, fact]),
  );
  const known = new Set(input.facts.map((fact) => fact.id));
  const requirementTexts = context.requirements.map((requirement) => requirement.text);
  const violations: ApplicationMaterialViolation[] = [];
  if (items.length === 0) {
    return [{ code: "empty_draft", detail: "The draft has no paragraph or question." }];
  }
  const maximum = maximumApplicationMaterialItems[input.kind];
  if (items.length > maximum) {
    violations.push({
      code: "too_many_items",
      detail: `The draft has ${items.length} items; at most ${maximum} are allowed.`,
    });
  }
  items.forEach((item, index) => {
    if (
      item.text.length > maximumApplicationMaterialItemCharacters ||
      item.question.length > maximumApplicationMaterialItemCharacters
    ) {
      violations.push({ code: "text_too_long", item: index, detail: "The item is too long." });
    }
    if (input.kind === "interview-questions" && item.question.trim() === "") {
      violations.push({
        code: "missing_question",
        item: index,
        detail: "The item has no question.",
      });
    }
    if (item.factIds.length === 0 && !courtesyItem(input, items.length, index, item)) {
      violations.push({ code: "missing_citation", item: index, detail: "The item cites no fact." });
    }
    if (recordLanguage.test(item.text) || recordLanguage.test(item.question)) {
      violations.push({
        code: "record_language",
        item: index,
        detail:
          "The item talks about the candidate's record, a list of skills or these rules; write it as the candidate would say it.",
      });
    }
    const cited: ApplicationMaterialFact[] = [];
    for (const id of item.factIds) {
      const fact = allowed.get(id);
      if (fact !== undefined) cited.push(fact);
      else if (known.has(id)) {
        violations.push({
          code: "fact_not_allowed",
          item: index,
          detail: `The item cites fact ${id}, which may not be used.`,
        });
      } else {
        violations.push({
          code: "unknown_fact",
          item: index,
          detail: `The item cites fact ${id}, which the record does not hold.`,
        });
      }
    }
    const citedValues = cited.map((fact) => fact.value);
    for (const number of numbersIn(item.text)) {
      if (!supported(number, citedValues)) {
        violations.push({
          code: "unsupported_number",
          item: index,
          detail: `The number ${number.written} appears in no cited fact.`,
        });
      }
    }
    for (const number of numbersIn(item.question)) {
      if (!supported(number, [...citedValues, ...requirementTexts])) {
        violations.push({
          code: "unsupported_number",
          item: index,
          detail: `The number ${number.written} in the question appears in no cited fact or requirement.`,
        });
      }
    }
  });
  return violations;
}

export interface DraftApplicationMaterialInput extends ApplicationMaterialContextInput {
  /** Attempts before the draft is refused; the second sees the first one's broken rules. */
  readonly maximumAttempts?: number;
}

/**
 * Drafts the material through the port and returns it only once it passes every rule. A draft
 * that still breaks a rule after the last attempt is refused with its violations, never returned.
 */
export async function draftApplicationMaterial(
  port: ApplicationMaterialPort,
  input: DraftApplicationMaterialInput,
): Promise<ApplicationMaterialDraft> {
  const context = applicationMaterialContext(input);
  if (context.facts.length === 0) {
    throw new ApplicationMaterialError(
      "no_facts",
      "The career record holds no fact the draft may cite.",
    );
  }
  const attempts = Math.max(1, input.maximumAttempts ?? 2);
  let refusedRules: string[] = [];
  let violations: ApplicationMaterialViolation[] = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const reply = await port.draft({ context, refusedRules });
    const items = reply.items.map((item) => ({
      question: item.question.trim(),
      text: item.text.trim(),
      factIds: [...new Set(item.factIds)],
    }));
    violations = applicationMaterialViolations(input, items);
    if (violations.length === 0) {
      return {
        kind: input.kind,
        items,
        ...(reply.model === undefined ? {} : { model: reply.model }),
      };
    }
    refusedRules = [...new Set(violations.map((violation) => violation.detail))];
  }
  throw new ApplicationMaterialError(
    "invalid_draft",
    "The drafted material broke the citation rules and was refused.",
    violations,
  );
}
