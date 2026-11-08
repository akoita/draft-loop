import {
  maximumCourtesyCharacters,
  recordLanguage,
  unsupportedNumbers,
} from "./application-material.js";
import type { ApplicationMaterialCompanyFact } from "./application-material-company.js";
import type { PickedCoverLetterFact } from "./cover-letter-facts.js";

/**
 * The claim check of a free-form cover letter (#2585): a model links each sentence to the facts
 * behind it, then deterministic rules decide whether the link holds. A sentence that fails is
 * never shown as supported; the writer revises it once or drops it (#2586).
 */

export interface CoverLetterSentence {
  /** "p<paragraph>.s<sentence>", both counted from 0. */
  readonly id: string;
  readonly paragraph: number;
  readonly text: string;
}

/** What a sentence says, by the model's reading: about the candidate, the employer, or neither. */
export type CoverLetterClaimKind = "candidate" | "employer" | "courtesy";

export interface CoverLetterClaimLink {
  readonly sentenceId: string;
  readonly kind: CoverLetterClaimKind;
  readonly factIds: readonly string[];
  readonly companyFactIds: readonly string[];
}

export interface CoverLetterClaimCheckRequest {
  readonly sentences: readonly CoverLetterSentence[];
  readonly facts: readonly PickedCoverLetterFact[];
  readonly companyFacts: readonly ApplicationMaterialCompanyFact[];
}

/** The model step: one link per sentence it can read; a missing link counts as unsupported. */
export interface CoverLetterClaimCheckPort {
  link(request: CoverLetterClaimCheckRequest): Promise<{
    readonly links: readonly CoverLetterClaimLink[];
  }>;
}

export type CoverLetterClaimProblem =
  | "unlinked"
  | "no_fact"
  | "unknown_fact"
  | "unknown_company_fact"
  | "company_fact_for_candidate"
  | "career_fact_for_employer"
  | "cross_group"
  | "unsupported_number"
  | "record_language"
  | "long_courtesy";

export interface CheckedCoverLetterSentence extends CoverLetterSentence {
  readonly kind: CoverLetterClaimKind;
  readonly factIds: readonly string[];
  readonly companyFactIds: readonly string[];
  /** Empty when the sentence is supported. */
  readonly problems: readonly CoverLetterClaimProblem[];
  /** For unsupported_number: the numbers no linked fact states. */
  readonly numbers?: readonly string[];
}

export interface CoverLetterClaimCheck {
  readonly sentences: readonly CheckedCoverLetterSentence[];
  readonly supported: boolean;
}

const sentencePattern = /[^.!?…]+(?:[.!?…]+["'”’)]*|$)/gu;

/** A plain-text letter as sentences: paragraphs split on blank lines, then on end marks. */
export function coverLetterSentences(letter: string): CoverLetterSentence[] {
  return letter
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .flatMap((paragraph, index) =>
      (paragraph.match(sentencePattern) ?? [])
        .map((sentence) => sentence.trim())
        .filter(Boolean)
        .map((text, position) => ({ id: `p${index}.s${position}`, paragraph: index, text })),
    );
}

/**
 * Holds each sentence to its links. A candidate sentence cites at least one picked fact, all from
 * one group when they have groups, and states no number they do not; an employer sentence cites
 * company facts only; a courtesy sentence is short and states no number. No sentence talks about
 * the record or the rules.
 */
export function checkCoverLetterClaims(
  request: CoverLetterClaimCheckRequest,
  links: readonly CoverLetterClaimLink[],
): CoverLetterClaimCheck {
  const facts = new Map(request.facts.map((fact) => [fact.id, fact]));
  const company = new Map(request.companyFacts.map((fact) => [fact.id, fact]));
  const linkOf = new Map(links.map((link) => [link.sentenceId, link]));
  const sentences = request.sentences.map((sentence): CheckedCoverLetterSentence => {
    const link = linkOf.get(sentence.id);
    if (link === undefined) {
      return {
        ...sentence,
        kind: "candidate",
        factIds: [],
        companyFactIds: [],
        problems: ["unlinked"],
      };
    }
    const problems: CoverLetterClaimProblem[] = [];
    const cited = link.factIds.flatMap((id) => facts.get(id) ?? []);
    const citedCompany = link.companyFactIds.flatMap((id) => company.get(id) ?? []);
    if (cited.length < link.factIds.length) problems.push("unknown_fact");
    if (citedCompany.length < link.companyFactIds.length) problems.push("unknown_company_fact");
    let sources: string[] = [];
    if (link.kind === "candidate") {
      if (link.factIds.length === 0) problems.push("no_fact");
      if (link.companyFactIds.length > 0) problems.push("company_fact_for_candidate");
      const groups = new Set(cited.map((fact) => fact.group ?? `loose:${fact.id}`));
      if (groups.size > 1) problems.push("cross_group");
      sources = cited.map((fact) => fact.brief);
    } else if (link.kind === "employer") {
      if (link.companyFactIds.length === 0) problems.push("no_fact");
      if (link.factIds.length > 0) problems.push("career_fact_for_employer");
      sources = citedCompany.map((fact) => fact.text);
    } else if (sentence.text.length > maximumCourtesyCharacters) {
      problems.push("long_courtesy");
    }
    const numbers = unsupportedNumbers(sentence.text, sources);
    if (numbers.length > 0) problems.push("unsupported_number");
    if (recordLanguage.test(sentence.text)) problems.push("record_language");
    return {
      ...sentence,
      kind: link.kind,
      factIds: [...link.factIds],
      companyFactIds: [...link.companyFactIds],
      problems,
      ...(numbers.length === 0 ? {} : { numbers }),
    };
  });
  return { sentences, supported: sentences.every((sentence) => sentence.problems.length === 0) };
}

/** Splits the letter, asks the model for links, and checks them. */
export async function checkCoverLetter(
  letter: string,
  facts: readonly PickedCoverLetterFact[],
  companyFacts: readonly ApplicationMaterialCompanyFact[],
  port: CoverLetterClaimCheckPort,
): Promise<CoverLetterClaimCheck> {
  const request = { sentences: coverLetterSentences(letter), facts, companyFacts };
  const { links } = await port.link(request);
  return checkCoverLetterClaims(request, links);
}
