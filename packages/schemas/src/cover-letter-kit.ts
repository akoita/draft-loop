import { z } from "zod";

/**
 * A writing kit for a cover letter (#3278): the material a candidate writes their own letter
 * from, instead of a letter. It names the requirements to answer with the approved facts that
 * prove them, opening angles and a paragraph outline written as notes, dated facts about the
 * employer and phrases to avoid. Every fact cites a career record fact id or a research finding
 * id; no field holds a sentence of letter prose (`coverLetterKitNoteProblem`).
 */

/** How many requirements a kit answers, and the facts each one cites. */
export const coverLetterKitBounds = {
  requirements: 3,
  factsPerRequirement: { minimum: 1, maximum: 2 },
  angles: { minimum: 2, maximum: 3 },
  employerFacts: 2,
  paragraphs: 4,
  avoid: 60,
} as const;

/** The longest note: a fragment to write from, never a sentence to paste. */
export const maximumCoverLetterKitNoteWords = 14;
export const maximumCoverLetterKitNoteCharacters = 120;

const id = z.string().trim().min(1).max(200);
const sourceText = z.string().min(1).max(1_200);

/** Abbreviations whose full stop does not end a sentence. */
const abbreviations = /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|cf|approx|p\.ex)\.$/iu;
/** Words that put a note in the letter's own voice: the first person, English and French. */
const firstPersonI = /(?:^|[^\p{L}'’])I(?:['’](?:m|ve|d|ll))?(?![\p{L}'’])/u;
const firstPerson =
  /(?:^|[^\p{L}'’])(?:(?:my|mine|me|myself|je|moi|mon|ma|mes)(?![\p{L}'’])|j['’]\p{L})/iu;

/**
 * Why a note reads as letter prose, or undefined when it is a fragment. The rule is
 * deterministic: a note has at most fourteen words and 120 characters, holds no sentence end
 * (a full stop, `!`, `?` or `…` at its end or before a space, abbreviations aside) and never
 * speaks in the first person (I, my, me, je, mon, ma, mes). "Lead with the 40% faster reports"
 * passes; "I cut report time by 40%." does not.
 */
export function coverLetterKitNoteProblem(note: string): string | undefined {
  const text = note.trim();
  if (text === "") return "is empty";
  if (text.length > maximumCoverLetterKitNoteCharacters) {
    return `is longer than ${maximumCoverLetterKitNoteCharacters} characters`;
  }
  const words = text.split(/\s+/u).filter(Boolean);
  if (words.length > maximumCoverLetterKitNoteWords) {
    return `has more than ${maximumCoverLetterKitNoteWords} words`;
  }
  for (const match of text.matchAll(/[.!?…]+(?=\s|$)/gu)) {
    const before = text.slice(0, (match.index ?? 0) + 1);
    if (match[0] === "." && abbreviations.test(before)) continue;
    return "ends a sentence";
  }
  if (firstPersonI.test(text) || firstPerson.test(text)) return "speaks in the first person";
  return undefined;
}

/** A short note, held to the no-sentence rule. */
export const coverLetterKitNoteSchema = z
  .string()
  .trim()
  .min(1)
  .max(maximumCoverLetterKitNoteCharacters)
  .superRefine((note, context) => {
    const problem = coverLetterKitNoteProblem(note);
    if (problem !== undefined) {
      context.addIssue({ code: "custom", message: `a kit note ${problem}` });
    }
  });

/** A career record fact as the candidate stored it, cited by its id. */
export const coverLetterKitFactSchema = z
  .strictObject({
    fact_id: id.describe("The career record fact's id."),
    text: sourceText.describe("The fact as the candidate stored it."),
  })
  .meta({ id: "CoverLetterKitFact" });

const citations = {
  fact_ids: z
    .array(id)
    .max(4)
    .describe("Career record facts the note rests on; each is listed in the kit."),
  finding_ids: z
    .array(id)
    .max(coverLetterKitBounds.employerFacts)
    .describe("Research findings the note rests on; each is one of the kit's employer facts."),
};

export const coverLetterKitSchema = z
  .strictObject({
    requirements: z
      .array(
        z.strictObject({
          requirement_id: id,
          text: sourceText.describe("The requirement as the job's brief states it."),
          facts: z
            .array(coverLetterKitFactSchema)
            .min(coverLetterKitBounds.factsPerRequirement.minimum)
            .max(coverLetterKitBounds.factsPerRequirement.maximum)
            .describe("The approved facts that prove the requirement, with their source."),
        }),
      )
      .min(1)
      .max(coverLetterKitBounds.requirements)
      .describe("The requirements the letter should answer, most important first."),
    angles: z
      .array(z.strictObject({ note: coverLetterKitNoteSchema, ...citations }))
      .min(coverLetterKitBounds.angles.minimum)
      .max(coverLetterKitBounds.angles.maximum)
      .describe("Ways to open the letter, as notes; never a sentence to paste."),
    employer_facts: z
      .array(
        z.strictObject({
          finding_id: id,
          text: sourceText.describe("The finding as the research brief states it."),
          published_on: z.iso.date().describe("The newest date among the finding's sources."),
        }),
      )
      .max(coverLetterKitBounds.employerFacts)
      .describe("Dated facts about the employer from the newest research brief."),
    outline: z
      .array(
        z.strictObject({
          paragraph: z.number().int().min(1).max(coverLetterKitBounds.paragraphs),
          purpose: coverLetterKitNoteSchema.describe("What the paragraph must do, as a note."),
          requirement_ids: z.array(id).max(coverLetterKitBounds.requirements),
          ...citations,
        }),
      )
      .length(coverLetterKitBounds.paragraphs)
      .describe("One entry for each of the letter's four paragraphs, in order."),
    avoid: z
      .array(z.string().trim().min(1).max(60))
      .max(coverLetterKitBounds.avoid)
      .describe(
        "Phrases readers associate with model-written letters, and the candidate's own forbidden terms.",
      ),
  })
  .superRefine((kit, context) => {
    const requirementIds = new Set(kit.requirements.map((entry) => entry.requirement_id));
    const factIds = new Set(
      kit.requirements.flatMap((entry) => entry.facts.map((fact) => fact.fact_id)),
    );
    const findingIds = new Set(kit.employer_facts.map((fact) => fact.finding_id));
    const check = (
      ids: readonly string[],
      known: ReadonlySet<string>,
      path: (string | number)[],
      noun: string,
    ) => {
      for (const [index, cited] of ids.entries()) {
        if (!known.has(cited)) {
          context.addIssue({
            code: "custom",
            path: [...path, index],
            message: `cites ${noun} ${cited}, which the kit does not list`,
          });
        }
      }
    };
    kit.angles.forEach((angle, index) => {
      check(angle.fact_ids, factIds, ["angles", index, "fact_ids"], "fact");
      check(angle.finding_ids, findingIds, ["angles", index, "finding_ids"], "finding");
    });
    kit.outline.forEach((entry, index) => {
      if (entry.paragraph !== index + 1) {
        context.addIssue({
          code: "custom",
          path: ["outline", index, "paragraph"],
          message: "the outline lists paragraphs 1 to 4 in order",
        });
      }
      check(
        entry.requirement_ids,
        requirementIds,
        ["outline", index, "requirement_ids"],
        "requirement",
      );
      check(entry.fact_ids, factIds, ["outline", index, "fact_ids"], "fact");
      check(entry.finding_ids, findingIds, ["outline", index, "finding_ids"], "finding");
    });
  })
  .meta({ id: "CoverLetterKit" });

export type CoverLetterKit = z.infer<typeof coverLetterKitSchema>;
