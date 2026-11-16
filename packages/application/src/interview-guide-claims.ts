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
  const shape = [
    `The interview is the ${interview.stage} stage`,
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

const durationAfter = String.raw`\s*(?:-|–)?\s*(?:min(?:ute)?s?|mn|seconds?|secondes?|hours?|heures?|h)\b`;

/** Whether every number a sentence states without a source is a duration, as advice gives. */
function onlyDurations(sentence: CheckedCoverLetterSentence): boolean {
  return (sentence.numbers ?? []).every((number) =>
    new RegExp(`${number.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}${durationAfter}`, "iu").test(
      sentence.text,
    ),
  );
}

/**
 * The problems that still count in a guide. A long courtesy sentence is advice, not a letter's
 * flourish; a courtesy sentence may name durations ("spend 10 minutes"); and a gap admitted beside
 * a fact does not mix two groups of the record.
 */
export function interviewGuideSentenceProblems(
  sentence: CheckedCoverLetterSentence,
  facts: readonly PickedCoverLetterFact[],
): readonly string[] {
  const groupOf = new Map(facts.map((fact) => [fact.id, fact.group ?? `loose:${fact.id}`]));
  return sentence.problems.filter((problem) => {
    if (problem === "long_courtesy") return false;
    if (problem === "unsupported_number") {
      return !(sentence.kind === "courtesy" && onlyDurations(sentence));
    }
    if (problem === "cross_group") {
      const groups = new Set(
        sentence.factIds.filter((id) => !id.startsWith("gap_")).map((id) => groupOf.get(id)),
      );
      return groups.size > 1;
    }
    return true;
  });
}
