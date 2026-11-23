/**
 * Check my letter (#3280): reads a cover letter the candidate wrote and reports, without
 * rewriting it, three groups of findings.
 *
 * - Claims: the free-form letter's claim checker (#2585) links each sentence to the approved
 *   facts behind it; a sentence that fails its rules is reported with the closest approved fact.
 *   This is the only part that needs a model, and it is skipped when the caller has none.
 * - Requirements: the writing kit's requirements, else the brief's top three, that no sentence
 *   answers yet, by shared words or by a sentence linked to one of the kit's facts.
 * - Wording: job-ad echoes, empty superlatives and the writing-tells rules, all deterministic.
 */

import type {
  CoverLetterCheck,
  CoverLetterCheckSkipReason,
  CoverLetterClaimFinding,
  CoverLetterWordingCode,
} from "@draft-loop/schemas/cover-letter-check";

import {
  type ApplicationMaterialContextInput,
  type ApplicationMaterialRequirement,
  applicationMaterialContext,
  applicationMaterialMatchWords,
} from "./application-material.js";
import type { ApplicationMaterialCompanyFact } from "./application-material-company.js";
import {
  type CheckedCoverLetterSentence,
  type CoverLetterClaimCheckPort,
  type CoverLetterClaimProblem,
  type CoverLetterSentence,
  checkCoverLetterClaims,
  coverLetterSentences,
} from "./cover-letter-claims.js";
import type { PickedCoverLetterFact } from "./cover-letter-facts.js";
import { writingTells } from "./writing-tells.js";

/** How many words in a row a letter must share with the job ad to echo it. */
export const jobAdEchoWords = 6;

/** How many requirements a letter is checked against when there is no kit. */
export const coverLetterCheckBriefRequirements = 3;

/**
 * Praise a letter gives itself without a fact behind it. English and French, lower case; each is
 * matched as whole words.
 */
export const emptySuperlatives: readonly string[] = [
  "exceptional",
  "outstanding",
  "world-class",
  "best-in-class",
  "unparalleled",
  "unmatched",
  "second to none",
  "highly motivated",
  "results-driven",
  "results-oriented",
  "detail-oriented",
  "self-starter",
  "go-getter",
  "strong work ethic",
  "excellent communication skills",
  "exceptional communication skills",
  "extensive experience",
  "unique blend",
  "perfect fit",
  "ideal candidate",
  "exceptionnel",
  "exceptionnelle",
  "hors pair",
  "inégalé",
  "inégalée",
  "très motivé",
  "très motivée",
  "candidat idéal",
  "candidate idéale",
  "profil idéal",
  "parfaitement adapté",
  "parfaitement adaptée",
  "solide expérience",
  "grande expérience",
];

export interface CoverLetterWordingFinding {
  readonly code: CoverLetterWordingCode;
  readonly paragraph?: number;
  readonly sentence?: string;
  readonly match?: string;
}

function normalized(text: string): string {
  return text.toLowerCase().replaceAll("’", "'");
}

function phraseAt(lower: string, phrase: string): boolean {
  let at = lower.indexOf(phrase);
  while (at >= 0) {
    const before = lower[at - 1] ?? "";
    const after = lower[at + phrase.length] ?? "";
    if (!/[\p{L}-]/u.test(before) && !/[\p{L}-]/u.test(after)) return true;
    at = lower.indexOf(phrase, at + 1);
  }
  return false;
}

/** The words of a text for echo matching: lower case letters and digits, punctuation dropped. */
function echoWords(text: string): string[] {
  return normalized(text).match(/[\p{L}\p{N}][\p{L}\p{N}'+#-]*/gu) ?? [];
}

/**
 * The longest run of at least `jobAdEchoWords` words a sentence shares with any job text, or
 * undefined. A shared run that long is copied, not written.
 */
export function jobAdEcho(sentence: string, jobTexts: readonly string[]): string | undefined {
  const words = echoWords(sentence);
  if (words.length < jobAdEchoWords) return undefined;
  const grams = new Set<string>();
  for (const text of jobTexts) {
    const job = echoWords(text);
    for (let start = 0; start + jobAdEchoWords <= job.length; start += 1) {
      grams.add(job.slice(start, start + jobAdEchoWords).join(" "));
    }
  }
  let best: string | undefined;
  let start = 0;
  while (start + jobAdEchoWords <= words.length) {
    if (!grams.has(words.slice(start, start + jobAdEchoWords).join(" "))) {
      start += 1;
      continue;
    }
    let end = start + jobAdEchoWords;
    while (
      end < words.length &&
      grams.has(words.slice(end - jobAdEchoWords + 1, end + 1).join(" "))
    ) {
      end += 1;
    }
    const run = words.slice(start, end).join(" ");
    if (best === undefined || run.length > best.length) best = run;
    start = end;
  }
  return best;
}

/**
 * Every wording finding in a letter, without a model: per sentence a job-ad echo and an empty
 * superlative, then the writing-tells rules (stock phrases, heavy dashes, lists of three,
 * mirrored openings and the word count).
 */
export function coverLetterWording(
  letter: string,
  jobTexts: readonly string[],
): CoverLetterWordingFinding[] {
  const sentences = coverLetterSentences(letter);
  const findings: CoverLetterWordingFinding[] = [];
  for (const { paragraph, text } of sentences) {
    const echo = jobAdEcho(text, jobTexts);
    if (echo !== undefined) {
      findings.push({ code: "job_ad_echo", paragraph, sentence: text, match: echo });
    }
    const lower = normalized(text);
    const superlative = emptySuperlatives.find((phrase) => phraseAt(lower, phrase));
    if (superlative !== undefined) {
      findings.push({ code: "empty_superlative", paragraph, sentence: text, match: superlative });
    }
  }
  const paragraphs = letter
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.replace(/\s+/gu, " ").trim())
    .filter(Boolean);
  for (const tell of writingTells(paragraphs)) findings.push(tell);
  return findings;
}

/**
 * The facts a check may link sentences to: the ones the candidate allowed for a cover letter,
 * best match to the letter's own sentences first, bounded like a drafted letter's context.
 */
export function coverLetterCheckFacts(
  input: Pick<CoverLetterCheckInput, "facts" | "usage" | "mayTransmit">,
  sentences: readonly CoverLetterSentence[],
): PickedCoverLetterFact[] {
  const context = applicationMaterialContext({
    kind: "cover-letter",
    facts: input.facts,
    requirements: sentences.map((sentence) => ({
      id: sentence.id,
      text: sentence.text,
      priority: "high",
    })),
    ...(input.usage === undefined ? {} : { usage: input.usage }),
    ...(input.mayTransmit === undefined ? {} : { mayTransmit: input.mayTransmit }),
  });
  return context.facts.map((fact) => ({
    id: fact.id,
    brief: fact.text,
    ...(fact.group === undefined ? {} : { group: fact.group }),
    score: 0,
  }));
}

/** The approved fact that shares the most words with a sentence, or null when none shares one. */
export function closestCoverLetterFact(
  sentence: string,
  facts: readonly PickedCoverLetterFact[],
): { readonly fact_id: string; readonly text: string } | null {
  const words = applicationMaterialMatchWords(sentence);
  let best: { fact: PickedCoverLetterFact; shared: number } | undefined;
  for (const fact of facts) {
    let shared = 0;
    for (const word of applicationMaterialMatchWords(fact.brief)) if (words.has(word)) shared += 1;
    if (shared > 0 && (best === undefined || shared > best.shared)) best = { fact, shared };
  }
  return best === undefined ? null : { fact_id: best.fact.id, text: best.fact.brief };
}

const noFact: ReadonlySet<CoverLetterClaimProblem> = new Set([
  "unlinked",
  "no_fact",
  "unknown_fact",
  "unknown_company_fact",
  "unknown_requirement",
  "company_fact_for_candidate",
  "career_fact_for_employer",
]);

function reasonOf(
  sentence: CheckedCoverLetterSentence,
): CoverLetterClaimFinding["reason"] | undefined {
  if (sentence.problems.some((problem) => noFact.has(problem))) return "no_supporting_fact";
  if (sentence.problems.includes("cross_group")) return "joins_different_roles";
  if (sentence.problems.includes("unsupported_number")) return "number_not_in_fact";
  return undefined;
}

/**
 * The checked sentences the record does not support, each with the closest approved fact.
 * Courtesy sentences and wording about the record are left to the wording group.
 */
export function coverLetterClaimFindings(
  sentences: readonly CheckedCoverLetterSentence[],
  facts: readonly PickedCoverLetterFact[],
): CoverLetterClaimFinding[] {
  return sentences.flatMap((sentence) => {
    if (sentence.kind === "courtesy") return [];
    const reason = reasonOf(sentence);
    if (reason === undefined) return [];
    return [
      {
        paragraph: sentence.paragraph,
        sentence: sentence.text,
        about: sentence.kind,
        reason,
        ...(reason === "number_not_in_fact" && sentence.numbers !== undefined
          ? { numbers: [...sentence.numbers] }
          : {}),
        closest_fact: closestCoverLetterFact(sentence.text, facts),
      },
    ];
  });
}

/** A requirement the letter should answer, with the kit's facts that prove it. */
export interface CoverLetterCheckTarget {
  readonly requirement_id: string;
  readonly text: string;
  readonly facts: readonly { readonly fact_id: string; readonly text: string }[];
}

/** The brief's top requirements, most important first, when the application has no kit. */
export function coverLetterCheckBriefTargets(
  requirements: readonly ApplicationMaterialRequirement[],
): CoverLetterCheckTarget[] {
  const order = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  return [...requirements]
    .map((requirement, index) => ({ requirement, index }))
    .sort(
      (left, right) =>
        order[left.requirement.priority] - order[right.requirement.priority] ||
        left.index - right.index,
    )
    .slice(0, coverLetterCheckBriefRequirements)
    .map(({ requirement }) => ({
      requirement_id: requirement.id,
      text: requirement.text.slice(0, 1_200),
      facts: [],
    }));
}

function sharesWords(sentence: ReadonlySet<string>, text: string): boolean {
  const words = applicationMaterialMatchWords(text);
  if (words.size === 0) return false;
  let shared = 0;
  for (const word of words) if (sentence.has(word)) shared += 1;
  return shared >= Math.min(2, words.size);
}

/**
 * The targets no sentence answers. A sentence answers one when it shares two words (one, for a
 * one-word requirement) with the requirement or one of its kit facts, or when the claim check
 * linked it to one of those facts.
 */
export function unansweredCoverLetterTargets(
  sentences: readonly CoverLetterSentence[],
  targets: readonly CoverLetterCheckTarget[],
  linkedFactIds: ReadonlySet<string> = new Set(),
): CoverLetterCheckTarget[] {
  const words = sentences.map((sentence) => applicationMaterialMatchWords(sentence.text));
  return targets.filter((target) => {
    if (target.facts.some((fact) => linkedFactIds.has(fact.fact_id))) return false;
    const texts = [target.text, ...target.facts.map((fact) => fact.text)];
    return !words.some((sentence) => texts.some((text) => sharesWords(sentence, text)));
  });
}

export interface CoverLetterCheckInput {
  readonly letter: string;
  /** The career record's facts; only the ones allowed for a cover letter are used. */
  readonly facts: ApplicationMaterialContextInput["facts"];
  readonly usage?: ApplicationMaterialContextInput["usage"];
  readonly mayTransmit?: ApplicationMaterialContextInput["mayTransmit"];
  readonly companyFacts?: readonly ApplicationMaterialCompanyFact[];
  /** The brief's requirements, which may support a sentence about the role. */
  readonly requirements?: readonly ApplicationMaterialRequirement[];
  /** What the letter should answer: the kit's requirements, else the brief's top ones. */
  readonly targets: {
    readonly source: CoverLetterCheck["requirements"]["source"];
    readonly kitId?: string;
    readonly items: readonly CoverLetterCheckTarget[];
  };
  /** The job ad's own text, for echoes: role, responsibilities, requirements and priorities. */
  readonly jobTexts: readonly string[];
}

export type CoverLetterCheckFindings = Pick<
  CoverLetterCheck,
  "claims" | "requirements" | "wording"
>;

/**
 * Checks a letter. With a checker, the claims are linked by its model; without one, or with a
 * `skip` reason, the claim group is marked skipped and the other two groups are complete.
 */
export async function checkCoverLetterText(
  input: CoverLetterCheckInput,
  checker: CoverLetterClaimCheckPort | { readonly skip: CoverLetterCheckSkipReason },
): Promise<CoverLetterCheckFindings> {
  const sentences = coverLetterSentences(input.letter);
  const facts = coverLetterCheckFacts(input, sentences);
  const skip =
    "skip" in checker ? checker.skip : facts.length === 0 ? ("no_facts" as const) : undefined;
  let claims: CoverLetterCheckFindings["claims"];
  let linked = new Set<string>();
  if (skip !== undefined || "skip" in checker) {
    claims = { status: "skipped", reason: skip ?? "no_facts", checked_sentences: 0, findings: [] };
  } else {
    const request = {
      sentences,
      facts,
      companyFacts: input.companyFacts ?? [],
      requirements: (input.requirements ?? []).map(({ id, text }) => ({ id, text })),
    };
    const { links } = await checker.link(request);
    const checked = checkCoverLetterClaims(request, links);
    linked = new Set(
      checked.sentences.flatMap((sentence) =>
        sentence.problems.length === 0 ? sentence.factIds : [],
      ),
    );
    claims = {
      status: "checked",
      checked_sentences: checked.sentences.length,
      findings: coverLetterClaimFindings(checked.sentences, facts),
    };
  }
  const unanswered = unansweredCoverLetterTargets(sentences, input.targets.items, linked);
  return {
    claims,
    requirements: {
      source: input.targets.source,
      ...(input.targets.kitId === undefined ? {} : { kit_id: input.targets.kitId }),
      total: input.targets.items.length,
      unanswered: unanswered.map((target) => ({
        requirement_id: target.requirement_id,
        text: target.text,
        facts: [...target.facts],
      })),
    },
    wording: coverLetterWording(input.letter, input.jobTexts),
  };
}
