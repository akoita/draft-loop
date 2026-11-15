import type { DraftArtifact } from "@draft-loop/schemas";

import { type OutputFormat, type RenderedDocument, renderArtifact } from "./index.js";
import { getRenderingTemplate } from "./templates.js";

/** The formats a saved cover letter or question set downloads as (#2481). */
export const applicationMaterialDocumentFormats = ["docx", "pdf"] as const;
export type ApplicationMaterialDocumentFormat = (typeof applicationMaterialDocumentFormats)[number];

/** The template a saved draft downloads with when none is chosen, as for a CV. */
export const defaultApplicationMaterialTemplateId = "modern";

/** What a saved draft's document needs: its kind, title, language and items. */
export interface ApplicationMaterialDocumentInput {
  readonly id: string;
  readonly kind: "cover-letter" | "interview-questions" | "interview-guide";
  /** The heading the document opens with, such as the application's name. */
  readonly title: string;
  readonly language: string;
  readonly createdAt: string;
  readonly items: readonly {
    readonly question: string;
    readonly text: string;
    /** For an interview preparation guide: the item's section and a likely question's trap. */
    readonly section?: string | undefined;
    readonly trap?: string | undefined;
  }[];
}

/** A guide's section titles in the document, English unless the draft is French (#2622). */
const guideSectionTitles = {
  en: {
    "read-first": "If you read one thing",
    interview: "The interview",
    company: "The company",
    role: "The role in plain words",
    market: "The state of the field",
    matrix: "What they ask for, and your proof",
    pitch: "Your pitch",
    stories: "Stories to tell",
    defense: "Weak points and how to answer",
    questions: "Likely questions",
    ask: "Questions to ask",
    practical: "Practical points to settle",
    topic: "Topics you asked to cover",
    "never-say": "Never say",
    checklist: "Before the interview",
    sources: "Sources",
    avoid: "Avoid:",
  },
  fr: {
    "read-first": "Si vous ne lisez qu’une chose",
    interview: "L’entretien",
    company: "L’entreprise",
    role: "Le poste en termes simples",
    market: "L’état du domaine",
    matrix: "Ce qui est demandé, et vos preuves",
    pitch: "Votre pitch",
    stories: "Récits à raconter",
    defense: "Points faibles et comment y répondre",
    questions: "Questions probables",
    ask: "Questions à poser",
    practical: "Points pratiques à régler",
    topic: "Sujets que vous avez demandés",
    "never-say": "À ne jamais dire",
    checklist: "Avant l’entretien",
    sources: "Sources",
    avoid: "À éviter :",
  },
} as const;

/** Sections whose items read as a list rather than as paragraphs. */
const listSections: ReadonlySet<string> = new Set(["never-say", "checklist", "sources"]);

/** A guide as one artifact section per guide section, in the order the guide keeps them. */
function guideSections(input: ApplicationMaterialDocumentInput): DraftArtifact["sections"] {
  const words = input.language.toLowerCase().startsWith("fr")
    ? guideSectionTitles.fr
    : guideSectionTitles.en;
  const sections: DraftArtifact["sections"][number][] = [];
  let open: string | undefined;
  input.items.forEach((item, index) => {
    const section = item.section ?? "questions";
    let last = sections.at(-1);
    if (last === undefined || open !== section) {
      open = section;
      last = {
        id: `guide-${section}-${sections.length + 1}`,
        title: (words as Record<string, string>)[section] ?? section,
        kind: "answer",
        order: sections.length,
        blocks: [],
      };
      sections.push(last);
    }
    const blocks = last.blocks as DraftArtifact["sections"][number]["blocks"][number][];
    const id = `item-${index + 1}`;
    const type = listSections.has(section) ? "bullet" : "paragraph";
    if (item.question.trim() !== "") {
      blocks.push({ id: `${id}-heading`, type, text: item.question.trim(), claimIds: [] });
    }
    blocks.push({ id, type, text: item.text, claimIds: [] });
    if (item.trap !== undefined) {
      blocks.push({
        id: `${id}-trap`,
        type: "paragraph",
        text: `${words.avoid} ${item.trap}`,
        claimIds: [],
      });
    }
  });
  return sections;
}

/**
 * A saved draft as the artifact the CV templates draw: a cover letter is one section of
 * paragraphs under the title, interview questions are one section per question, and a guide is
 * one section per guide section, each question followed by its talking point and its trap. The draft
 * keeps its own citations, so the artifact carries no claims.
 */
export function applicationMaterialArtifact(
  input: ApplicationMaterialDocumentInput,
): DraftArtifact {
  const title = input.title.trim() === "" ? input.id : input.title.trim();
  const sections: DraftArtifact["sections"] =
    input.kind === "interview-guide"
      ? guideSections(input)
      : input.kind === "cover-letter"
        ? [
            {
              id: "letter",
              title,
              kind: "alignment",
              order: 0,
              blocks: input.items.map((item, index) => ({
                id: `letter-${index + 1}`,
                type: "paragraph",
                text: item.text,
                claimIds: [],
              })),
            },
          ]
        : input.items.map((item, index) => ({
            id: `question-${index + 1}`,
            title: item.question.trim() === "" ? `${index + 1}` : item.question,
            kind: "answer",
            order: index,
            blocks: [
              { id: `answer-${index + 1}`, type: "paragraph", text: item.text, claimIds: [] },
            ],
          }));
  return {
    schemaVersion: 1,
    id: input.id,
    kind: input.kind === "cover-letter" ? "cover-letter" : "application-qa",
    version: 1,
    parentVersionId: null,
    createdAt: input.createdAt,
    language: input.language,
    sections,
    claims: [],
    decisions: [],
  };
}

/** A saved draft rendered as Word or PDF with a CV template, Modern by default. */
export function renderApplicationMaterialDocument(
  input: ApplicationMaterialDocumentInput,
  format: ApplicationMaterialDocumentFormat,
  options: { readonly templateId?: string | undefined; readonly generatedAt?: string } = {},
): RenderedDocument {
  const template = getRenderingTemplate(options.templateId ?? defaultApplicationMaterialTemplateId);
  return renderArtifact(applicationMaterialArtifact(input), format satisfies OutputFormat, {
    templateId: template.id,
    ...(options.generatedAt === undefined ? {} : { generatedAt: options.generatedAt }),
  });
}
