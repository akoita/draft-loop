/**
 * What an interview guide's claim check may hold a sentence to (#2807). Beside the career facts,
 * the gaps and the research findings, a guide talks about the interview the candidate described,
 * restates the job's requirements and says when research found nothing; each of those is a source
 * too. Advice that states no fact passes as courtesy, whatever its length, and may name durations.
 */

import type { InterviewDetails } from "@draft-loop/schemas/interview-details";

import type { ApplicationMaterialCompanyFact } from "./application-material-company.js";
import type {
  CheckedCoverLetterSentence,
  CoverLetterClaimRequirement,
} from "./cover-letter-claims.js";
import type { PickedCoverLetterFact } from "./cover-letter-facts.js";

export interface InterviewGuideClaimSourcesInput {
  readonly interview: Omit<InterviewDetails, "never_say">;
  readonly facts: readonly {
    readonly id: string;
    readonly text: string;
    readonly group?: string;
  }[];
  readonly gaps: readonly { readonly id: string; readonly requirement: string }[];
  readonly matrix: readonly { readonly requirement: string }[];
  readonly findings: readonly { readonly id: string; readonly text: string }[];
  readonly unsourcedTopics: readonly string[];
}

export interface InterviewGuideClaimSources {
  readonly facts: readonly PickedCoverLetterFact[];
  readonly companyFacts: readonly ApplicationMaterialCompanyFact[];
  readonly requirements: readonly CoverLetterClaimRequirement[];
}

/** The interview the candidate described, as sentences the check may cite. */
function interviewDetailFacts(
  interview: InterviewGuideClaimSourcesInput["interview"],
): ApplicationMaterialCompanyFact[] {
  const [day, time] = interview.scheduled_at?.split("T") ?? [];
  const shape = [
    `The interview is the ${interview.stage} stage`,
    day === undefined ? "" : `, on ${day}`,
    time === undefined ? "" : ` at ${time}`,
    interview.length_minutes === undefined ? "" : `, ${interview.length_minutes} minutes long`,
    interview.format === undefined ? "" : `, by ${interview.format}`,
    interview.interviewer_role === undefined ? "" : `, with the ${interview.interviewer_role}`,
    ".",
  ].join("");
  const topics = [...(interview.topics ?? []), ...(interview.other_topics ?? [])];
  return [
    { id: "interview_shape", text: shape },
    ...(topics.length === 0
      ? []
      : [{ id: "interview_topics", text: `The interview covers: ${topics.join(", ")}.` }]),
    ...(interview.notes === undefined || interview.notes === ""
      ? []
      : [
          {
            id: "interview_notes",
            text: `The candidate's notes on the interview: ${interview.notes}`,
          },
        ]),
  ];
}

export function interviewGuideClaimSources(
  input: InterviewGuideClaimSourcesInput,
): InterviewGuideClaimSources {
  return {
    facts: [
      ...input.facts.map((fact) => ({
        id: fact.id,
        brief: fact.text,
        score: 0,
        ...(fact.group === undefined ? {} : { group: fact.group }),
      })),
      ...input.gaps.map((gap) => ({
        id: gap.id,
        brief: `No career fact shows this requirement: ${gap.requirement}`,
        score: 0,
      })),
    ],
    companyFacts: [
      ...input.findings.map((finding) => ({ id: finding.id, text: finding.text })),
      ...interviewDetailFacts(input.interview),
      ...input.unsourcedTopics.map((topic, index) => ({
        id: `unsourced_${index}`,
        text: `Research found no source about: ${topic}.`,
      })),
    ],
    requirements: input.matrix.map((row, index) => ({ id: `req_${index}`, text: row.requirement })),
  };
}

const countedNumber = String.raw`(?:\d+(?:[.,]\d+)?|two|three|four|five|six|seven|eight|nine|ten|deux|trois|quatre|cinq|sept|huit|neuf|dix)`;
const numberJoin = String.raw`\s*(?:/|,|\+|-|–|to|or|and|à|ou|et)\s*`;
const adviceUnit = String.raw`(?:min(?:ute)?s?|mn|sec(?:ond)?s?|secondes?|hours?|heures?|h|sentences?|phrases?|examples?|exemples?|points?|beats?|questions?|stor(?:y|ies)|histoires?|words?|mots?|steps?|étapes?|parts?|parties?)`;
/** A run of counts and their unit, such as "3/6/5-minute", "about 90 seconds" or "two examples". */
const adviceMeasure = new RegExp(
  String.raw`(?<![\p{L}\d])${countedNumber}(?:${numberJoin}${countedNumber})*\s*(?:-|–)?\s*${adviceUnit}(?!\p{L})`,
  "giu",
);

/** Whether every number a sentence states without a source is a duration or a count of advice. */
function onlyAdviceMeasures(sentence: CheckedCoverLetterSentence): boolean {
  const measured = new Set(
    [...sentence.text.matchAll(adviceMeasure)].flatMap((match) =>
      [...match[0].matchAll(new RegExp(countedNumber, "giu"))].map((n) => n[0].toLowerCase()),
    ),
  );
  return (sentence.numbers ?? []).every((number) => measured.has(number.toLowerCase()));
}

/** Whether every career fact a sentence cites is a gap the record admits. */
const citesOnlyGaps = (sentence: CheckedCoverLetterSentence) =>
  sentence.factIds.every((id) => id.startsWith("gap_"));

/**
 * The problems that still count in a guide. A long courtesy sentence is advice, not a letter's
 * flourish. Advice and sentences about the interview may give durations and counts ("a 3/6/5
 * minute plan", "two examples"); a candidate's own claims may not. A gap admitted beside a fact,
 * or beside the job's requirement, mixes nothing from the record.
 */
export function interviewGuideSentenceProblems(
  sentence: CheckedCoverLetterSentence,
  facts: readonly PickedCoverLetterFact[],
): readonly string[] {
  const groupOf = new Map(facts.map((fact) => [fact.id, fact.group ?? `loose:${fact.id}`]));
  return sentence.problems.filter((problem) => {
    if (problem === "long_courtesy") return false;
    if (problem === "unsupported_number") {
      return !(sentence.kind !== "candidate" && onlyAdviceMeasures(sentence));
    }
    if (problem === "career_fact_for_employer") return !citesOnlyGaps(sentence);
    if (problem === "cross_group") {
      const groups = new Set(
        sentence.factIds.filter((id) => !id.startsWith("gap_")).map((id) => groupOf.get(id)),
      );
      return groups.size > 1;
    }
    return true;
  });
}
