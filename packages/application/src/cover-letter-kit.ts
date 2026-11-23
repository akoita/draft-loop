/**
 * A writing kit for a cover letter (#3278): the material the candidate writes their own letter
 * from, built from the same pieces as a drafted letter. The fact picker chooses the facts, the
 * job's brief gives the requirements, the newest research brief gives dated facts about the
 * employer, and the writing-tells list gives the phrases to avoid. A model behind
 * `CoverLetterKitPort` matches requirements to facts and writes the angles and the outline as
 * notes; this module refuses any answer that cites an id it did not offer or holds letter prose,
 * and fills every citation's text from the record, never from the model.
 */

import {
  type CoverLetterKit,
  coverLetterKitBounds,
  coverLetterKitNoteProblem,
  coverLetterKitSchema,
} from "@draft-loop/schemas/cover-letter-kit";

import {
  type ApplicationMaterialContextInput,
  type ApplicationMaterialModelIdentity,
  applicationMaterialContext,
  applicationMaterialFactText,
  recordLanguage,
  unsupportedNumbers,
} from "./application-material.js";
import type { ApplicationMaterialCompanyFact } from "./application-material-company.js";
import { type PickedCoverLetterFact, pickCoverLetterFacts } from "./cover-letter-facts.js";
import { englishStockPhrases, frenchStockPhrases } from "./writing-tells.js";

/** What reaches the model: picked facts, the job's requirements and dated employer facts. */
export interface CoverLetterKitContext {
  readonly facts: readonly PickedCoverLetterFact[];
  readonly requirements: readonly {
    readonly id: string;
    readonly text: string;
    readonly priority: "critical" | "high" | "medium" | "low";
  }[];
  /** Findings with a publication date only: a kit's employer facts are dated. */
  readonly company: readonly (ApplicationMaterialCompanyFact & { readonly publishedOn: string })[];
  readonly language?: string;
}

/** The model's answer: ids and notes only; the module fills in every source text. */
export interface CoverLetterKitAnswer {
  readonly requirements: readonly {
    readonly requirementId: string;
    readonly factIds: readonly string[];
  }[];
  readonly angles: readonly {
    readonly note: string;
    readonly factIds: readonly string[];
    readonly findingIds: readonly string[];
  }[];
  readonly employerFindingIds: readonly string[];
  readonly outline: readonly {
    readonly paragraph: number;
    readonly purpose: string;
    readonly requirementIds: readonly string[];
    readonly factIds: readonly string[];
    readonly findingIds: readonly string[];
  }[];
}

export interface CoverLetterKitRequest {
  readonly context: CoverLetterKitContext;
  /** Rules the previous answer broke; empty on the first call. */
  readonly refusedRules: readonly string[];
}

export interface CoverLetterKitReply {
  readonly answer: CoverLetterKitAnswer;
  readonly model?: ApplicationMaterialModelIdentity;
}

/** Anything that answers a kit request, such as the model adapter or a scripted fake. */
export interface CoverLetterKitPort {
  draft(request: CoverLetterKitRequest): Promise<CoverLetterKitReply>;
}

export interface CoverLetterKitDraft {
  readonly kit: CoverLetterKit;
  readonly model?: ApplicationMaterialModelIdentity;
}

export type CoverLetterKitViolationCode =
  | "requirement_count"
  | "unknown_requirement"
  | "fact_count"
  | "unknown_fact"
  | "fact_not_allowed"
  | "unknown_finding"
  | "too_many_employer_facts"
  | "angle_count"
  | "uncited_angle"
  | "outline_shape"
  | "letter_prose"
  | "record_language"
  | "unsupported_number"
  | "invalid_kit";

export interface CoverLetterKitViolation {
  readonly code: CoverLetterKitViolationCode;
  readonly detail: string;
}

export class CoverLetterKitError extends Error {
  readonly code: "no_facts" | "no_requirements" | "invalid_kit";
  readonly violations: readonly CoverLetterKitViolation[];

  constructor(
    code: CoverLetterKitError["code"],
    message: string,
    violations: readonly CoverLetterKitViolation[] = [],
  ) {
    super(message);
    this.name = "CoverLetterKitError";
    this.code = code;
    this.violations = violations;
  }
}

export type CoverLetterKitInput = Omit<ApplicationMaterialContextInput, "kind" | "guidance">;

/** The bounded context: the facts a cover letter may cite, picked for the job. */
export function coverLetterKitContext(input: CoverLetterKitInput): CoverLetterKitContext {
  const context = applicationMaterialContext({ ...input, kind: "cover-letter" });
  const allowed = new Set(context.facts.map((fact) => fact.id));
  const facts = pickCoverLetterFacts(
    input.facts.filter((fact) => allowed.has(fact.id)),
    input.requirements,
  );
  const company = (context.company ?? []).flatMap((fact) =>
    fact.publishedOn === undefined ? [] : [{ ...fact, publishedOn: fact.publishedOn }],
  );
  return {
    facts,
    requirements: context.requirements,
    company,
    ...(context.language === undefined ? {} : { language: context.language }),
  };
}

/**
 * The phrases a kit tells the candidate to avoid: their own forbidden terms first, then the
 * writing-tells list in the letter's language, French for `fr`, English otherwise.
 */
export function coverLetterKitAvoidList(
  language: string | undefined,
  avoidTerms: readonly string[] = [],
): string[] {
  const stock = language?.toLowerCase().startsWith("fr") ? frenchStockPhrases : englishStockPhrases;
  return [
    ...new Set([...avoidTerms, ...stock].map((term) => term.trim().slice(0, 60)).filter(Boolean)),
  ].slice(0, coverLetterKitBounds.avoid);
}

/** How many requirements a kit answers: three, or every one when the job lists fewer. */
export function coverLetterKitRequirementCount(context: CoverLetterKitContext): number {
  return Math.min(coverLetterKitBounds.requirements, context.requirements.length);
}

function noteViolations(
  where: string,
  note: string,
  sources: readonly string[],
): CoverLetterKitViolation[] {
  const violations: CoverLetterKitViolation[] = [];
  const problem = coverLetterKitNoteProblem(note);
  if (problem !== undefined) {
    violations.push({
      code: "letter_prose",
      detail: `${where} ${problem}; write a short note, not a sentence of the letter.`,
    });
  }
  if (recordLanguage.test(note)) {
    violations.push({
      code: "record_language",
      detail: `${where} talks about the record or these rules; say what to write instead.`,
    });
  }
  for (const number of unsupportedNumbers(note, sources)) {
    violations.push({
      code: "unsupported_number",
      detail: `${where} states ${number}, which none of its cited sources states.`,
    });
  }
  return violations;
}

/**
 * Every rule an answer breaks: the requirement count, an id the context did not offer (a fact
 * the record holds but the candidate did not allow is named apart from one it does not hold),
 * one or two facts per requirement, two or three cited angles, four outline paragraphs in order,
 * at most two employer facts, and notes that are fragments without an unsourced number.
 */
export function coverLetterKitViolations(
  input: Pick<CoverLetterKitInput, "facts">,
  context: CoverLetterKitContext,
  answer: CoverLetterKitAnswer,
): CoverLetterKitViolation[] {
  const violations: CoverLetterKitViolation[] = [];
  const offered = new Map(context.facts.map((fact) => [fact.id, fact.brief]));
  const known = new Set(input.facts.map((fact) => fact.id));
  const requirements = new Map(context.requirements.map((entry) => [entry.id, entry.text]));
  const findings = new Map(context.company.map((fact) => [fact.id, fact.text]));
  const kitFacts = new Set(answer.requirements.flatMap((entry) => entry.factIds));
  const chosenFindings = new Set(answer.employerFindingIds);
  const factIssue = (where: string, id: string) => {
    if (offered.has(id)) return;
    violations.push(
      known.has(id)
        ? { code: "fact_not_allowed", detail: `${where} cites fact ${id}, which may not be used.` }
        : {
            code: "unknown_fact",
            detail: `${where} cites fact ${id}, which the record does not hold.`,
          },
    );
  };

  const count = coverLetterKitRequirementCount(context);
  const chosen = answer.requirements.map((entry) => entry.requirementId);
  if (chosen.length !== count || new Set(chosen).size !== chosen.length) {
    violations.push({
      code: "requirement_count",
      detail: `Answer exactly ${count} different requirements.`,
    });
  }
  answer.requirements.forEach((entry, index) => {
    const where = `Requirement ${index + 1}`;
    if (!requirements.has(entry.requirementId)) {
      violations.push({
        code: "unknown_requirement",
        detail: `${where} names ${entry.requirementId}, which the job's brief does not list.`,
      });
    }
    const { minimum, maximum } = coverLetterKitBounds.factsPerRequirement;
    if (entry.factIds.length < minimum || entry.factIds.length > maximum) {
      violations.push({
        code: "fact_count",
        detail: `${where} cites ${entry.factIds.length} facts; cite ${minimum} or ${maximum}.`,
      });
    }
    for (const id of entry.factIds) factIssue(where, id);
  });

  if (answer.employerFindingIds.length > coverLetterKitBounds.employerFacts) {
    violations.push({
      code: "too_many_employer_facts",
      detail: `Choose at most ${coverLetterKitBounds.employerFacts} employer facts.`,
    });
  }
  for (const id of answer.employerFindingIds) {
    if (!findings.has(id)) {
      violations.push({
        code: "unknown_finding",
        detail: `The employer facts name finding ${id}, which the research brief does not offer.`,
      });
    }
  }

  // A note may cite only what the kit lists, so every source it rests on is shown beside it.
  const citedSources = (
    where: string,
    factIds: readonly string[],
    findingIds: readonly string[],
  ): string[] => {
    for (const id of factIds) {
      factIssue(where, id);
      if (offered.has(id) && !kitFacts.has(id)) {
        violations.push({
          code: "fact_not_allowed",
          detail: `${where} cites fact ${id}; cite only facts a requirement lists.`,
        });
      }
    }
    for (const id of findingIds) {
      if (!chosenFindings.has(id)) {
        violations.push({
          code: "unknown_finding",
          detail: `${where} cites finding ${id}; cite only the kit's employer facts.`,
        });
      }
    }
    return [
      ...factIds.flatMap((id) => offered.get(id) ?? []),
      ...findingIds.flatMap((id) => findings.get(id) ?? []),
    ];
  };

  const { minimum, maximum } = coverLetterKitBounds.angles;
  if (answer.angles.length < minimum || answer.angles.length > maximum) {
    violations.push({
      code: "angle_count",
      detail: `Write ${minimum} or ${maximum} opening angles.`,
    });
  }
  answer.angles.forEach((angle, index) => {
    const where = `Angle ${index + 1}`;
    if (angle.factIds.length === 0 && angle.findingIds.length === 0) {
      violations.push({
        code: "uncited_angle",
        detail: `${where} cites nothing; rest it on a listed fact or employer fact.`,
      });
    }
    const sources = citedSources(where, angle.factIds, angle.findingIds);
    violations.push(...noteViolations(where, angle.note, sources));
  });

  const paragraphs = answer.outline.map((entry) => entry.paragraph);
  const expected = Array.from({ length: coverLetterKitBounds.paragraphs }, (_, index) => index + 1);
  if (paragraphs.join(",") !== expected.join(",")) {
    violations.push({
      code: "outline_shape",
      detail: `The outline lists paragraphs ${expected.join(", ")}, in order, once each.`,
    });
  }
  answer.outline.forEach((entry, index) => {
    const where = `Outline paragraph ${index + 1}`;
    for (const id of entry.requirementIds) {
      if (!chosen.includes(id)) {
        violations.push({
          code: "unknown_requirement",
          detail: `${where} names requirement ${id}; name only the kit's requirements.`,
        });
      }
    }
    const sources = [
      ...citedSources(where, entry.factIds, entry.findingIds),
      ...entry.requirementIds.flatMap((id) => requirements.get(id) ?? []),
    ];
    violations.push(...noteViolations(where, entry.purpose, sources));
  });
  return violations;
}

function trimmedAnswer(answer: CoverLetterKitAnswer): CoverLetterKitAnswer {
  const unique = (ids: readonly string[]) => [...new Set(ids.map((id) => id.trim()))];
  return {
    requirements: answer.requirements.map((entry) => ({
      requirementId: entry.requirementId.trim(),
      factIds: unique(entry.factIds),
    })),
    angles: answer.angles.map((angle) => ({
      note: angle.note.trim(),
      factIds: unique(angle.factIds),
      findingIds: unique(angle.findingIds),
    })),
    employerFindingIds: unique(answer.employerFindingIds),
    outline: answer.outline.map((entry) => ({
      paragraph: entry.paragraph,
      purpose: entry.purpose.trim(),
      requirementIds: unique(entry.requirementIds),
      factIds: unique(entry.factIds),
      findingIds: unique(entry.findingIds),
    })),
  };
}

/** A valid answer as the kit the API returns and saves, each citation's text from the record. */
function kitOf(
  input: CoverLetterKitInput,
  context: CoverLetterKitContext,
  answer: CoverLetterKitAnswer,
): CoverLetterKit {
  const facts = new Map(input.facts.map((fact) => [fact.id, fact]));
  const requirements = new Map(context.requirements.map((entry) => [entry.id, entry.text]));
  const findings = new Map(context.company.map((fact) => [fact.id, fact]));
  const factText = (id: string) => {
    const fact = facts.get(id);
    return fact === undefined ? id : applicationMaterialFactText(fact);
  };
  return coverLetterKitSchema.parse({
    requirements: answer.requirements.map((entry) => ({
      requirement_id: entry.requirementId,
      text: requirements.get(entry.requirementId) ?? entry.requirementId,
      facts: entry.factIds.map((id) => ({ fact_id: id, text: factText(id) })),
    })),
    angles: answer.angles.map((angle) => ({
      note: angle.note,
      fact_ids: [...angle.factIds],
      finding_ids: [...angle.findingIds],
    })),
    employer_facts: answer.employerFindingIds.flatMap((id) => {
      const finding = findings.get(id);
      return finding === undefined
        ? []
        : [{ finding_id: id, text: finding.text, published_on: finding.publishedOn }];
    }),
    outline: answer.outline.map((entry) => ({
      paragraph: entry.paragraph,
      purpose: entry.purpose,
      requirement_ids: [...entry.requirementIds],
      fact_ids: [...entry.factIds],
      finding_ids: [...entry.findingIds],
    })),
    avoid: coverLetterKitAvoidList(input.language, input.voice?.avoidTerms),
  });
}

export interface DraftCoverLetterKitInput extends CoverLetterKitInput {
  /** Attempts before the kit is refused; the second sees the first one's broken rules. */
  readonly maximumAttempts?: number;
}

/**
 * Builds the kit through the port and returns it only once it passes every rule. An answer that
 * still breaks one after the last attempt is refused with its violations, never returned.
 */
export async function draftCoverLetterKit(
  port: CoverLetterKitPort,
  input: DraftCoverLetterKitInput,
): Promise<CoverLetterKitDraft> {
  const context = coverLetterKitContext(input);
  if (context.facts.length === 0) {
    throw new CoverLetterKitError("no_facts", "The career record holds no fact the kit may cite.");
  }
  if (context.requirements.length === 0) {
    throw new CoverLetterKitError(
      "no_requirements",
      "The application's brief lists no requirement for the kit to answer.",
    );
  }
  const attempts = Math.max(1, input.maximumAttempts ?? 2);
  let refusedRules: string[] = [];
  let violations: CoverLetterKitViolation[] = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const reply = await port.draft({ context, refusedRules });
    const answer = trimmedAnswer(reply.answer);
    violations = coverLetterKitViolations(input, context, answer);
    if (violations.length === 0) {
      const parsed = (() => {
        try {
          return kitOf(input, context, answer);
        } catch (error) {
          violations = [{ code: "invalid_kit", detail: String(error).slice(0, 300) }];
          return undefined;
        }
      })();
      if (parsed !== undefined) {
        return { kit: parsed, ...(reply.model === undefined ? {} : { model: reply.model }) };
      }
    }
    refusedRules = [...new Set(violations.map((violation) => violation.detail))];
  }
  throw new CoverLetterKitError(
    "invalid_kit",
    "The writing kit broke the citation or note rules and was refused.",
    violations,
  );
}
