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
import {
  type ApplicationMaterialGuidance,
  maximumApplicationMaterialAddresseeCharacters,
  maximumApplicationMaterialEmphasisCharacters,
} from "@draft-loop/schemas/saved-application-material";

import {
  type ApplicationMaterialCompanyFact,
  boundedCompanyFacts,
  type CompanyFactViolationCode,
  companyFactViolations,
} from "./application-material-company.js";

/** The parts of a canonical profile fact the drafter reads. */
/**
 * A fact as one line, "category field: value", without repeating a field that only restates its
 * category (an achievement stored as "achievement achievement" reads "achievement: …").
 */
export function applicationMaterialFactText(
  fact: Pick<ApplicationMaterialFact, "category" | "field" | "value">,
): string {
  const field = fact.field.trim();
  const label =
    field === "" || field.toLowerCase() === fact.category.trim().toLowerCase()
      ? fact.category
      : `${fact.category} ${field}`;
  return `${label}: ${fact.value}`;
}

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
  /** The candidate's guidance (#2478): it steers the writing and is never a fact. */
  readonly guidance?: ApplicationMaterialGuidance;
  /** The candidate's own voice (#2513): style to copy, never a source of facts. */
  readonly voice?: ApplicationMaterialVoice;
  /** Facts about the employer from the newest research brief (#2544); never about the candidate. */
  readonly company?: readonly ApplicationMaterialCompanyFact[];
}

/**
 * How the candidate writes: texts they wrote, and the workspace writing preferences that apply to
 * any document. Every field is style; none may supply a claim, a name or a number.
 */
export interface ApplicationMaterialVoice {
  readonly samples?: readonly string[];
  /** Words and phrases the candidate's writing policy forbids. */
  readonly avoidTerms?: readonly string[];
  readonly tone?: string;
  readonly spellingLocale?: string;
}

/** The most of each sample, and of the avoid list, that reaches the model. */
export const maximumVoiceSampleCharacters = 2_000;
export const maximumVoiceSamples = 3;
export const maximumVoiceAvoidTerms = 40;

/**
 * One paragraph of a cover letter, or one interview question with its talking point. `question`
 * is empty for a cover letter paragraph.
 */
export interface ApplicationMaterialItem {
  readonly question: string;
  readonly text: string;
  readonly factIds: readonly string[];
  /** The company facts a statement about the employer rests on (#2544); never a candidate claim. */
  readonly companyFactIds?: readonly string[];
}

export interface ApplicationMaterialModelIdentity {
  readonly provider: string;
  readonly model: string;
}

export interface ApplicationMaterialRequest {
  readonly context: ApplicationMaterialContext;
  /** Rules the previous attempt broke, so the model can avoid them; empty on the first call. */
  readonly refusedRules: readonly string[];
  /** A valid letter and the critic's machine-writing findings, to revise once (#2524). */
  readonly revision?: {
    readonly previous: readonly ApplicationMaterialItem[];
    readonly findings: readonly {
      readonly paragraph: number;
      readonly sentence: string;
      readonly reason: string;
    }[];
  };
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
  | "unsupported_number"
  | CompanyFactViolationCode;

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
  /** The candidate's guidance (#2478); none when unset. */
  readonly guidance?: ApplicationMaterialGuidance;
  /** The candidate's own voice (#2513); none when unset. */
  readonly voice?: ApplicationMaterialVoice;
  /** The newest research brief's findings (#2544); none when unset. */
  readonly companyFacts?: readonly ApplicationMaterialCompanyFact[];
}

/** The voice that reaches the model: samples and terms trimmed and capped, empty fields dropped. */
export function boundedApplicationMaterialVoice(
  voice: ApplicationMaterialVoice | undefined,
): ApplicationMaterialVoice | undefined {
  if (voice === undefined) return undefined;
  const samples = (voice.samples ?? [])
    .map((sample) => sample.trim().slice(0, maximumVoiceSampleCharacters))
    .filter((sample) => sample !== "")
    .slice(0, maximumVoiceSamples);
  const avoidTerms = [...new Set((voice.avoidTerms ?? []).map((term) => term.trim().slice(0, 60)))]
    .filter((term) => term !== "")
    .slice(0, maximumVoiceAvoidTerms);
  const bounded: ApplicationMaterialVoice = {
    ...(samples.length === 0 ? {} : { samples }),
    ...(avoidTerms.length === 0 ? {} : { avoidTerms }),
    ...(voice.tone ? { tone: voice.tone.slice(0, 40) } : {}),
    ...(voice.spellingLocale ? { spellingLocale: voice.spellingLocale.slice(0, 20) } : {}),
  };
  return Object.keys(bounded).length === 0 ? undefined : bounded;
}

/**
 * The guidance that reaches the model: trimmed, capped, without empty fields, and without an
 * addressee for interview questions. Undefined when nothing is left.
 */
export function boundedApplicationMaterialGuidance(
  kind: ApplicationMaterialKind,
  guidance: ApplicationMaterialGuidance | undefined,
): ApplicationMaterialGuidance | undefined {
  if (guidance === undefined) return undefined;
  const emphasis = guidance.emphasis?.trim().slice(0, maximumApplicationMaterialEmphasisCharacters);
  const addressee =
    kind === "cover-letter"
      ? guidance.addressee?.trim().slice(0, maximumApplicationMaterialAddresseeCharacters)
      : undefined;
  const bounded = {
    ...(emphasis ? { emphasis } : {}),
    ...(guidance.tone === undefined ? {} : { tone: guidance.tone }),
    ...(guidance.length === undefined ? {} : { length: guidance.length }),
    ...(addressee ? { addressee } : {}),
  };
  return Object.keys(bounded).length === 0 ? undefined : bounded;
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
const priorityWeight = { critical: 4, high: 3, medium: 2, low: 1 } as const;

/** Words too common to tell a fact's match to a requirement. English and French. */
const commonWords = new Set(
  "and the for with that this from your our are has have will you who its their into over able about such other more most also then than when what which while within across using used use work works working experience years year team teams role strong good knowledge skills skill les des une pour avec dans sur par aux est sont votre vos nos".split(
    " ",
  ),
);

/** The words of a text that can tell a match: lower case, without common English and French words. */
export function applicationMaterialMatchWords(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/\p{L}[\p{L}\p{N}+#.-]*/gu) ?? [])
      .map((word) => word.replace(/[.-]+$/u, ""))
      .filter((word) => word.length >= 3 && !commonWords.has(word)),
  );
}

/**
 * Facts most relevant to the job first (#2583): each fact scores the words it shares with each
 * requirement, weighted by the requirement's priority. Ties keep the record's order, so a record
 * larger than the bound keeps its best matches rather than its first entries.
 */
export function rankApplicationMaterialFacts<T extends ApplicationMaterialFact>(
  facts: readonly T[],
  requirements: readonly Pick<ApplicationMaterialRequirement, "text" | "priority">[],
): T[] {
  const score = applicationMaterialFactScorer(requirements);
  return facts
    .map((fact, index) => ({ fact, index, score: score(fact) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.fact);
}

/** Scores a fact by the words it shares with each requirement, weighted by priority. */
export function applicationMaterialFactScorer(
  requirements: readonly Pick<ApplicationMaterialRequirement, "text" | "priority">[],
): (fact: Pick<ApplicationMaterialFact, "field" | "value">) => number {
  const wanted = requirements.map((requirement) => ({
    words: applicationMaterialMatchWords(requirement.text),
    weight: priorityWeight[requirement.priority],
  }));
  return (fact) => {
    const words = applicationMaterialMatchWords(`${fact.field} ${fact.value}`);
    let score = 0;
    for (const requirement of wanted) {
      let shared = 0;
      for (const word of words) if (requirement.words.has(word)) shared += 1;
      score += shared * requirement.weight;
    }
    return score;
  };
}

/**
 * The bounded context: allowed facts, then the job's requirements by priority. Each entry is
 * capped in length; the requirements are data for the model, never instructions.
 */
export function applicationMaterialContext(
  input: ApplicationMaterialContextInput,
): ApplicationMaterialContext {
  const facts = rankApplicationMaterialFacts(
    input.facts.filter((fact) => allowedFact(input, fact)),
    input.requirements,
  )
    .slice(0, maximumApplicationMaterialFacts)
    .map((fact) => ({
      id: fact.id,
      text: applicationMaterialFactText(fact).slice(0, maximumContextCharacters),
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
  const guidance = boundedApplicationMaterialGuidance(input.kind, input.guidance);
  const voice = boundedApplicationMaterialVoice(input.voice);
  const company = boundedCompanyFacts(input.companyFacts);
  return {
    kind: input.kind,
    facts,
    requirements,
    ...(input.language === undefined ? {} : { language: input.language }),
    ...(guidance === undefined ? {} : { guidance }),
    ...(voice === undefined ? {} : { voice }),
    ...(company.length === 0 ? {} : { company }),
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
 * The numbers in a candidate's own edit that none of the item's sources state (#2480). An edit is
 * the candidate's text, so it is flagged for them to check rather than refused.
 */
export function unsupportedNumbers(text: string, sources: readonly string[]): string[] {
  return [
    ...new Set(
      numbersIn(text)
        .filter((number) => !supported(number, sources))
        .map((number) => number.written),
    ),
  ];
}

/**
 * Wording that talks about the career record or the drafting rules instead of the candidate's
 * work (#2218's second walk: "SQL is one of my listed skills", "without claiming more than the
 * record shows"). A candidate would never send it.
 */
export const recordLanguage =
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
  const company = new Map((context.company ?? []).map((fact) => [fact.id, fact.text]));
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
    const companyViolations = companyFactViolations(item, index, new Set(company.keys()));
    violations.push(...companyViolations);
    const cited: ApplicationMaterialFact[] = [];
    for (const id of item.factIds) {
      const fact = allowed.get(id);
      if (fact !== undefined) cited.push(fact);
      else if (company.has(id)) continue;
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
    // A number about the employer may come from a cited company fact.
    const citedValues = [
      ...cited.map((fact) => fact.value),
      ...(item.companyFactIds ?? []).flatMap((id) => company.get(id) ?? []),
    ];
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
      ...(item.companyFactIds === undefined || item.companyFactIds.length === 0
        ? {}
        : { companyFactIds: [...new Set(item.companyFactIds)] }),
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
