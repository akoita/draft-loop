import { z } from "zod";

/**
 * The user guide as the API returns it (#2881): the web screens and agents read the same text.
 * Paragraphs are plain text, never markup.
 */
export const helpGuideLanguageSchema = z.enum(["en", "fr"]);

export const helpGuideSectionSchema = z
  .object({
    id: z.string().min(1).max(64),
    title: z.string().min(1).max(200),
    paragraphs: z.array(z.string().min(1).max(2_000)).min(1).max(20),
  })
  .meta({ id: "HelpGuideSection" });

export const helpGuideResponseSchema = z
  .object({
    language: helpGuideLanguageSchema,
    intro: z.string().min(1).max(2_000),
    /** With a query, only the sections that match every word, best first. */
    query: z.string().max(200).nullable(),
    sections: z.array(helpGuideSectionSchema).max(50),
  })
  .meta({ id: "HelpGuide" });

export type HelpGuideResponse = z.infer<typeof helpGuideResponseSchema>;
