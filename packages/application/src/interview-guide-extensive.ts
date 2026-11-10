/**
 * An extensive interview preparation guide (#2620): three writer calls, each for one part of the
 * guide, each checked like an essential guide. One part can be written again on its own, keeping
 * the others as they were, so a candidate pays only for the part they want changed. The
 * requirement matrix is built here from the record, never by a model.
 */

import type { InterviewGuideSection } from "@draft-loop/schemas/saved-application-material";

import { applicationMaterialFactText } from "./application-material.js";
import type { CoverLetterClaimCheckPort } from "./cover-letter-claims.js";
import {
  type DraftInterviewGuideInput,
  type InterviewGuideDraft,
  type InterviewGuideItem,
  type InterviewGuideWriterPort,
  interviewGuideWriterRequest,
  requireSupportedGuide,
  serverSections,
  writeInterviewGuidePart,
} from "./interview-guide.js";

/** The three parts of an extensive guide and the sections each call writes. */
export const extensiveInterviewGuideParts = {
  context: ["interview", "company", "role", "market"],
  story: ["pitch", "stories", "defense"],
  practice: ["read-first", "questions", "ask", "practical", "topic", "checklist"],
} as const satisfies Record<string, readonly InterviewGuideSection[]>;

export type ExtensiveInterviewGuidePart = keyof typeof extensiveInterviewGuideParts;
export const extensiveInterviewGuidePartNames = Object.keys(
  extensiveInterviewGuideParts,
) as ExtensiveInterviewGuidePart[];

/** How many likely questions an extensive guide prepares. */
export const extensiveInterviewGuideQuestions = 12;

/** The order sections are read in, whichever call wrote them. */
const readingOrder: readonly InterviewGuideSection[] = [
  "read-first",
  "interview",
  "company",
  "role",
  "market",
  "matrix",
  "pitch",
  "stories",
  "defense",
  "questions",
  "ask",
  "practical",
  "topic",
  "never-say",
  "checklist",
  "sources",
];

const serverWords = {
  en: "No proof in your record yet: see your defense lines.",
  fr: "Pas encore de preuve dans votre parcours : voir vos lignes de défense.",
} as const;

/** The matrix section: each requirement with the candidate's own facts, or a pointer to defense. */
export function interviewGuideMatrixItems(input: DraftInterviewGuideInput): InterviewGuideItem[] {
  const facts = new Map(input.facts.map((fact) => [fact.id, fact]));
  const none = input.language?.toLowerCase().startsWith("fr") ? serverWords.fr : serverWords.en;
  return input.matrix.rows.slice(0, 20).map((row) => {
    const cited = row.factIds.flatMap((id) => facts.get(id) ?? []);
    return {
      section: "matrix",
      heading: row.requirement.slice(0, 300),
      text:
        cited.length === 0
          ? none
          : cited
              .map((fact) => applicationMaterialFactText(fact))
              .join("; ")
              .slice(0, 1_200),
      factIds: cited.map((fact) => fact.id),
      findingIds: [],
    };
  });
}

export interface DraftExtensiveInterviewGuideOptions {
  /** Write only these parts again; the rest comes from `previous`. All three when unset. */
  readonly parts?: readonly ExtensiveInterviewGuidePart[];
  /** The guide's current items, whose other parts are kept as they are. */
  readonly previous?: readonly InterviewGuideItem[];
}

const sortKey = (section: InterviewGuideSection) => readingOrder.indexOf(section);

/** Drafts an extensive guide, or writes some of its parts again. */
export async function draftExtensiveInterviewGuide(
  writer: InterviewGuideWriterPort,
  checker: CoverLetterClaimCheckPort,
  input: DraftInterviewGuideInput,
  options: DraftExtensiveInterviewGuideOptions = {},
): Promise<InterviewGuideDraft> {
  const parts = options.parts ?? extensiveInterviewGuidePartNames;
  const rewritten = new Set<InterviewGuideSection>(
    parts.flatMap((part) => extensiveInterviewGuideParts[part]),
  );
  const kept = (options.parts === undefined ? [] : (options.previous ?? [])).filter(
    (item) =>
      !rewritten.has(item.section) &&
      item.section !== "matrix" &&
      item.section !== "never-say" &&
      item.section !== "sources",
  );
  const written = [];
  for (const part of parts) {
    written.push(
      await writeInterviewGuidePart(
        writer,
        checker,
        interviewGuideWriterRequest(
          input,
          extensiveInterviewGuideParts[part],
          extensiveInterviewGuideQuestions,
        ),
        input.neverSay,
      ),
    );
  }
  const items = [...kept, ...written.flatMap((part) => part.items)];
  requireSupportedGuide(items);
  const model = written.findLast((part) => part.model !== undefined)?.model;
  const ordered = [...items, ...interviewGuideMatrixItems(input), ...serverSections(input)]
    .map((item, index) => ({ item, index }))
    .sort(
      (left, right) =>
        sortKey(left.item.section) - sortKey(right.item.section) || left.index - right.index,
    )
    .map((entry) => entry.item);
  return {
    items: ordered,
    droppedSentences: written.flatMap((part) => part.droppedSentences),
    unsourcedTopics: written[0]?.unsourcedTopics ?? [],
    ...(model === undefined ? {} : { model }),
  };
}
