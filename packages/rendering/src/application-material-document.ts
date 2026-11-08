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
  readonly kind: "cover-letter" | "interview-questions";
  /** The heading the document opens with, such as the application's name. */
  readonly title: string;
  readonly language: string;
  readonly createdAt: string;
  readonly items: readonly { readonly question: string; readonly text: string }[];
}

/**
 * A saved draft as the artifact the CV templates draw: a cover letter is one section of
 * paragraphs under the title, and interview questions are one section per question. The draft
 * keeps its own citations, so the artifact carries no claims.
 */
export function applicationMaterialArtifact(
  input: ApplicationMaterialDocumentInput,
): DraftArtifact {
  const title = input.title.trim() === "" ? input.id : input.title.trim();
  const sections: DraftArtifact["sections"] =
    input.kind === "cover-letter"
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
          blocks: [{ id: `answer-${index + 1}`, type: "paragraph", text: item.text, claimIds: [] }],
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
