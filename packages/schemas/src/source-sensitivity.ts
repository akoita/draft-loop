import type { SourceSensitivityRule } from "@draft-loop/domain/source-sensitivity";
import { sourceSensitivityTiers } from "@draft-loop/domain/source-sensitivity";
import { z } from "zod";

export const maximumSourceSensitivityRules = 200;
export const maximumSourceSensitivityRuleIdLength = 64;
export const maximumSourceSensitivityHeadingLength = 200;
export const maximumSourceSensitivityPathDepth = 12;

const headingTextSchema = z.string().trim().min(1).max(maximumSourceSensitivityHeadingLength);

const matchSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("heading-contains"), text: headingTextSchema }).strict(),
  z
    .object({
      kind: z.literal("heading-path"),
      path: z.array(headingTextSchema).min(1).max(maximumSourceSensitivityPathDepth),
    })
    .strict(),
]);

const ruleSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(maximumSourceSensitivityRuleIdLength)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "id must be a safe identifier"),
    tier: z.enum(sourceSensitivityTiers),
    match: matchSchema,
  })
  .strict();

export const sourceSensitivityRuleListSchema = z
  .object({
    rules: z
      .array(ruleSchema)
      .max(maximumSourceSensitivityRules)
      .refine((rules) => new Set(rules.map((rule) => rule.id)).size === rules.length, {
        message: "rule ids must be unique",
      }),
  })
  .strict();

export type SourceSensitivityRuleList = { readonly rules: readonly SourceSensitivityRule[] };

export type ParsedSourceSensitivityRuleList = z.infer<typeof sourceSensitivityRuleListSchema>;
