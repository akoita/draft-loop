import { canonicalCandidateProfileFactCategories } from "@draft-loop/domain";
import {
  factUsageKeyPattern,
  factUsageLevels,
  factUsageSettingsSchemaVersion,
  maximumFactUsageEntries,
} from "@draft-loop/domain/fact-usage";
import { z } from "zod";

export const factUsageLevelSchema = z.enum(factUsageLevels);

export const factUsageKeySchema = z
  .string()
  .regex(factUsageKeyPattern, "must be a fact usage key such as fu1-skill- and 16 hex digits");

export const factUsageSectionSchema = z.enum(canonicalCandidateProfileFactCategories);

/** The workspace's usage levels (#2258): by section and by fact key, never fact text. */
export const factUsageSettingsSchema = z
  .object({
    schemaVersion: z.literal(factUsageSettingsSchemaVersion),
    sections: z.partialRecord(factUsageSectionSchema, factUsageLevelSchema),
    facts: z
      .record(factUsageKeySchema, factUsageLevelSchema)
      .refine((facts) => Object.keys(facts).length <= maximumFactUsageEntries, {
        message: `holds at most ${maximumFactUsageEntries} facts`,
      }),
  })
  .strict();

/** One change: a level on a section or a fact, or `null` to clear it. */
export const factUsageChangeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("section"),
      category: factUsageSectionSchema,
      level: factUsageLevelSchema.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("fact"),
      key: factUsageKeySchema,
      level: factUsageLevelSchema.nullable(),
    })
    .strict(),
]);
export type FactUsageChange = z.infer<typeof factUsageChangeSchema>;
