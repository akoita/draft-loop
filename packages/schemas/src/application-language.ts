import { documentLanguageCodes } from "@draft-loop/domain/document-language";
import { z } from "zod";

export const applicationLanguagesSchemaVersion = 1;
export const maximumApplicationLanguageEntries = 5_000;

export const documentLanguageCodeSchema = z
  .string()
  .refine((code) => documentLanguageCodes.includes(code), "must be an offered document language");

/**
 * The document language each application chose instead of the workspace's (#2315), by
 * application id. An application without an entry writes in the workspace's language.
 */
export const applicationLanguagesSchema = z
  .object({
    schemaVersion: z.literal(applicationLanguagesSchemaVersion),
    languages: z
      .record(z.string().min(1).max(200), documentLanguageCodeSchema)
      .refine((languages) => Object.keys(languages).length <= maximumApplicationLanguageEntries, {
        message: `holds at most ${maximumApplicationLanguageEntries} applications`,
      }),
  })
  .strict();
export type ApplicationLanguages = z.infer<typeof applicationLanguagesSchema>;
