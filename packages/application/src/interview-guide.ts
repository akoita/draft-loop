/**
 * An essential interview preparation guide (#2619): one model call writes the guide's sections from
 * the interview details, the research findings, the requirement matrix and the facts the candidate
 * allowed for interviews; then the claim check holds every sentence to them. A sentence about the
 * candidate needs a fact (or, for a weak point, the gap it admits), a sentence about the employer
 * or the field needs a finding, and a sentence close to a never-say entry is dropped whatever it
 * cites. The never-say and sources sections are built here and never written by a model.
 */

import type { InterviewDetails } from "@draft-loop/schemas/interview-details";
import type { ResearchBrief } from "@draft-loop/schemas/research-brief";
import type { InterviewGuideSection } from "@draft-loop/schemas/saved-application-material";

import {
  ApplicationMaterialError,
  type ApplicationMaterialFact,
  type ApplicationMaterialModelIdentity,
  type ApplicationMaterialRequirement,
  applicationMaterialFactText,
  maximumApplicationMaterialFacts,
  rankApplicationMaterialFacts,
} from "./application-material.js";
import {
  type CheckedCoverLetterSentence,
  type CoverLetterClaimCheckPort,
  type CoverLetterSentence,
  checkCoverLetterClaims,
} from "./cover-letter-claims.js";
import type { PickedCoverLetterFact } from "./cover-letter-facts.js";
import {
  type InterviewGuideMatrix,
  type InterviewGuideNeverSayEntry,
  interviewGuideDefenseLines,
  touchesNeverSay,
} from "./interview-guide-matrix.js";
import { interviewGuideMissingTopics } from "./interview-guide-research.js";

/** The sections an essential guide's model call writes, in reading order. */
export const essentialInterviewGuideSections = [
  "read-first",
  "interview",
  "company",
  "role",
  "pitch",
  "defense",
  "questions",
  "ask",
  "topic",
] as const satisfies readonly InterviewGuideSection[];

/** How many likely questions an essential guide prepares. */
export const essentialInterviewGuideQuestions = 6;
const maximumItemCharacters = 1_200;
const maximumFindingCharacters = 400;

/** A research finding as the writer reads it, with how far its sources can be trusted. */
export interface InterviewGuideFinding {
  readonly id: string;
  readonly text: string;
  readonly topics: readonly string[];
  /** The best reliability among its sources. */
  readonly reliability: "primary" | "press" | "weak" | "unrated";
  readonly publishedOn?: string;
}

export interface InterviewGuideWriterRequest {
  readonly sections: readonly InterviewGuideSection[];
  /** The interview's shape and what to cover; never `never_say`, which stays on the server. */
  readonly interview: Omit<InterviewDetails, "never_say">;
  readonly facts: readonly {
    readonly id: string;
    readonly text: string;
    readonly group?: string;
  }[];
  readonly matrix: readonly {
    readonly requirement: string;
    readonly priority: ApplicationMaterialRequirement["priority"];
    readonly factIds: readonly string[];
  }[];
  /** The weak points to defend, each with the id a defense sentence cites. */
  readonly gaps: readonly { readonly id: string; readonly requirement: string }[];
  readonly findings: readonly InterviewGuideFinding[];
  /** Topics research found no source for: their sections stay short and state no fact. */
  readonly unsourcedTopics: readonly string[];
  readonly questionCount: number;
  readonly language?: string;
}

/** One item as the writer answers it. */
export interface InterviewGuideWrittenItem {
  readonly section: string;
  readonly heading: string;
  readonly text: string;
  readonly trap?: string;
}

export interface InterviewGuideWriterPort {
  write(request: InterviewGuideWriterRequest): Promise<{
    readonly items: readonly InterviewGuideWrittenItem[];
    readonly model?: ApplicationMaterialModelIdentity;
  }>;
}

/** One kept item of a guide, with the facts and findings its sentences cite. */
export interface InterviewGuideItem {
  readonly section: InterviewGuideSection;
  readonly heading: string;
  readonly text: string;
  readonly trap?: string;
  readonly factIds: readonly string[];
  readonly findingIds: readonly string[];
}

export interface InterviewGuideDraft {
  readonly items: readonly InterviewGuideItem[];
  /** Sentences left out: unsupported, or close to something the candidate never says. */
  readonly droppedSentences: readonly string[];
  readonly unsourcedTopics: readonly string[];
  readonly model?: ApplicationMaterialModelIdentity;
}

export interface DraftInterviewGuideInput {
  readonly details: InterviewDetails;
  /** Facts already allowed for interview preparation (`interviewGuideFacts().allowed`). */
  readonly facts: readonly ApplicationMaterialFact[];
  readonly requirements: readonly ApplicationMaterialRequirement[];
  readonly matrix: InterviewGuideMatrix;
  readonly neverSay: readonly InterviewGuideNeverSayEntry[];
  readonly brief?: ResearchBrief | undefined;
  readonly language?: string;
}

const reliabilityRank = { primary: 0, press: 1, weak: 2, unrated: 3 } as const;

/** The brief's findings with their sources' topics, best reliability and newest date. */
export function interviewGuideFindings(brief: ResearchBrief | undefined): InterviewGuideFinding[] {
  if (brief === undefined) return [];
  const sources = new Map(brief.sources.map((source) => [source.id, source]));
  return brief.findings.map((finding) => {
    const cited = finding.source_ids.flatMap((id) => sources.get(id) ?? []);
    const reliability = cited
      .map((source) => source.reliability ?? "unrated")
      .reduce<InterviewGuideFinding["reliability"]>(
        (best, next) => (reliabilityRank[next] < reliabilityRank[best] ? next : best),
        "unrated",
      );
    const dates = cited.flatMap((source) => source.published_on ?? []).sort();
    return {
      id: finding.id,
      text: finding.text.slice(0, maximumFindingCharacters),
      topics: [...new Set(cited.flatMap((source) => source.topic ?? []))],
      reliability,
      ...(dates.length === 0 ? {} : { publishedOn: dates.at(-1) as string }),
    };
  });
}

/** A gap's pseudo-fact id, which a defense sentence cites to admit what the record lacks. */
const gapId = (index: number) => `gap_${index + 1}`;

/** The writer's request: bounded facts, the matrix, the gaps to defend and the findings. */
export function interviewGuideWriterRequest(
  input: DraftInterviewGuideInput,
  sections: readonly InterviewGuideSection[] = essentialInterviewGuideSections,
  questionCount: number = essentialInterviewGuideQuestions,
): InterviewGuideWriterRequest {
  const { never_say: _private, ...interview } = input.details;
  const facts = rankApplicationMaterialFacts(input.facts, input.requirements)
    .slice(0, maximumApplicationMaterialFacts)
    .map((fact) => ({
      id: fact.id,
      text: applicationMaterialFactText(fact).slice(0, 300),
      ...(fact.subjectId ? { group: fact.subjectId.slice(0, 64) } : {}),
    }));
  const known = new Set(facts.map((fact) => fact.id));
  const gaps = input.matrix.gaps
    .slice(0, interviewGuideDefenseLines[input.details.depth])
    .map((gap, index) => ({ id: gapId(index), requirement: gap.requirement.slice(0, 300) }));
  return {
    sections: sections.filter(
      (section) =>
        section !== "topic" ||
        (interview.topics?.length ?? 0) + (interview.other_topics?.length ?? 0) > 0,
    ),
    interview,
    facts,
    matrix: input.matrix.rows.slice(0, 20).map((row) => ({
      requirement: row.requirement.slice(0, 300),
      priority: row.priority,
      factIds: row.factIds.filter((id) => known.has(id)),
    })),
    gaps,
    findings: interviewGuideFindings(input.brief),
    unsourcedTopics: interviewGuideMissingTopics(input.brief, input.details),
    questionCount,
    ...(input.language === undefined ? {} : { language: input.language }),
  };
}

const sentencePattern = /[^.!?…]+(?:[.!?…]+["'”’)]*|$)/gu;

function sentencesOf(text: string): string[] {
  return (text.replace(/\s+/gu, " ").trim().match(sentencePattern) ?? [])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/** The guide's sentences: each item's text as paragraph `2i`, its trap as paragraph `2i + 1`. */
function guideSentences(items: readonly InterviewGuideWrittenItem[]): CoverLetterSentence[] {
  return items.flatMap((item, index) =>
    [
      ...sentencesOf(item.text).map((text) => ({ paragraph: 2 * index, text })),
      ...sentencesOf(item.trap ?? "").map((text) => ({ paragraph: 2 * index + 1, text })),
    ].map((sentence, position) => ({ id: `i${index}.s${position}`, ...sentence })),
  );
}

/** Whether a checked sentence holds: a long advice sentence is fine in a guide, unlike a letter. */
function holds(
  sentence: CheckedCoverLetterSentence,
  neverSay: readonly InterviewGuideNeverSayEntry[],
) {
  const problems = sentence.problems.filter((problem) => problem !== "long_courtesy");
  return problems.length === 0 && !touchesNeverSay(sentence.text, neverSay);
}

/** One written and checked part of a guide: its kept items and the sentences it dropped. */
export interface InterviewGuidePart {
  readonly items: readonly InterviewGuideItem[];
  readonly droppedSentences: readonly string[];
  readonly unsourcedTopics: readonly string[];
  readonly model?: ApplicationMaterialModelIdentity;
}

/** Refuses to write a guide from a record with no fact it may cite. */
function requireFacts(request: InterviewGuideWriterRequest): void {
  if (request.facts.length === 0) {
    throw new ApplicationMaterialError(
      "no_facts",
      "The career record holds no fact an interview guide may cite.",
    );
  }
}

/** Writes the request's sections in one call, then holds each sentence to its sources. */
export async function writeInterviewGuidePart(
  writer: InterviewGuideWriterPort,
  checker: CoverLetterClaimCheckPort,
  request: InterviewGuideWriterRequest,
  neverSay: readonly InterviewGuideNeverSayEntry[],
): Promise<InterviewGuidePart> {
  requireFacts(request);
  const reply = await writer.write(request);
  const wanted = new Set<string>(request.sections);
  const written = reply.items
    .filter((item) => wanted.has(item.section))
    .map((item) => ({
      section: item.section,
      heading: item.heading.trim().slice(0, 300),
      text: item.text.trim().slice(0, maximumItemCharacters),
      ...(item.trap?.trim() ? { trap: item.trap.trim().slice(0, maximumItemCharacters) } : {}),
    }))
    .filter((item) => item.text !== "");

  // Facts and gaps are what a candidate sentence may rest on; findings what any other may.
  const facts: PickedCoverLetterFact[] = [
    ...request.facts.map((fact) => ({
      id: fact.id,
      brief: fact.text,
      score: 0,
      ...(fact.group === undefined ? {} : { group: fact.group }),
    })),
    ...request.gaps.map((gap) => ({
      id: gap.id,
      brief: `No career fact shows this requirement: ${gap.requirement}`,
      score: 0,
    })),
  ];
  const companyFacts = request.findings.map((finding) => ({ id: finding.id, text: finding.text }));
  const sentences = guideSentences(written);
  const checked =
    sentences.length === 0
      ? []
      : checkCoverLetterClaims(
          { sentences, facts, companyFacts },
          (await checker.link({ sentences, facts, companyFacts })).links,
        ).sentences;

  const dropped: string[] = [];
  const items: InterviewGuideItem[] = [];
  written.forEach((item, index) => {
    const part = (paragraph: number) =>
      checked.filter((sentence) => sentence.paragraph === paragraph);
    const keep = (parts: CheckedCoverLetterSentence[]) => {
      const kept = parts.filter((sentence) => holds(sentence, neverSay));
      dropped.push(...parts.filter((sentence) => !kept.includes(sentence)).map((s) => s.text));
      return kept;
    };
    const text = keep(part(2 * index));
    const trap = keep(part(2 * index + 1));
    if (text.length === 0) return;
    const cited = [...text, ...trap];
    items.push({
      section: item.section as InterviewGuideSection,
      heading: item.heading,
      text: text.map((sentence) => sentence.text).join(" "),
      ...(trap.length === 0 ? {} : { trap: trap.map((sentence) => sentence.text).join(" ") }),
      factIds: [
        ...new Set(
          cited.flatMap((sentence) => sentence.factIds).filter((id) => !id.startsWith("gap_")),
        ),
      ],
      findingIds: [...new Set(cited.flatMap((sentence) => sentence.companyFactIds))],
    });
  });
  return {
    items,
    droppedSentences: dropped,
    unsourcedTopics: request.unsourcedTopics,
    ...(reply.model === undefined ? {} : { model: reply.model }),
  };
}

/** Refuses a guide in which no kept sentence about the candidate cites a fact. */
export function requireSupportedGuide(items: readonly InterviewGuideItem[]): void {
  if (!items.some((item) => item.factIds.length > 0)) {
    throw new ApplicationMaterialError(
      "invalid_draft",
      "No sentence of the drafted guide about the candidate was supported by the career record.",
    );
  }
}

/** Drafts an essential guide: one writer call, the claim check, then the server's own sections. */
export async function draftEssentialInterviewGuide(
  writer: InterviewGuideWriterPort,
  checker: CoverLetterClaimCheckPort,
  input: DraftInterviewGuideInput,
): Promise<InterviewGuideDraft> {
  const part = await writeInterviewGuidePart(
    writer,
    checker,
    interviewGuideWriterRequest(input),
    input.neverSay,
  );
  requireSupportedGuide(part.items);
  return {
    items: [...part.items, ...serverSections(input)],
    droppedSentences: part.droppedSentences,
    unsourcedTopics: part.unsourcedTopics,
    ...(part.model === undefined ? {} : { model: part.model }),
  };
}

/** The few words the server writes itself, in the guide's language (English otherwise). */
const serverWords = {
  en: { undated: "undated", weak: "weak source" },
  fr: { undated: "non daté", weak: "source fragile" },
} as const;

export function interviewGuideServerWords(language: string | undefined) {
  return language?.toLowerCase().startsWith("fr") ? serverWords.fr : serverWords.en;
}

/** The never-say and sources sections, built from the record and the brief, never by a model. */
export function serverSections(
  input: Pick<DraftInterviewGuideInput, "neverSay" | "brief" | "language">,
): InterviewGuideItem[] {
  const words = interviewGuideServerWords(input.language);
  const items: InterviewGuideItem[] = input.neverSay.map((entry) => ({
    section: "never-say",
    heading: "",
    text: entry.text,
    factIds: [],
    findingIds: [],
  }));
  for (const source of input.brief?.sources ?? []) {
    const parts = [
      source.title,
      source.published_on ?? words.undated,
      ...(source.reliability === "weak" ? [words.weak] : []),
      ...(source.url === undefined ? [] : [source.url]),
    ];
    items.push({
      section: "sources",
      heading: "",
      text: parts.join(" · ").slice(0, maximumItemCharacters),
      factIds: [],
      findingIds: [],
    });
  }
  return items;
}
