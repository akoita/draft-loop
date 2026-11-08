import { z } from "zod";

import { applicationIdSchema } from "./application.js";

/**
 * A cover letter or interview question set saved with its application (#2477), so the candidate
 * can reopen it, compare versions and delete it. It holds the draft as the candidate saw it,
 * with each item's citations, the model that wrote it and what it cost. It is candidate
 * material: it lives in the workspace's storage under its consent and is erased with it.
 */

export const savedApplicationMaterialKinds = ["cover-letter", "interview-questions"] as const;

export const maximumSavedApplicationMaterialItems = 10;
export const maximumSavedApplicationMaterialItemCharacters = 4_000;
export const maximumSavedApplicationMaterialCitations = 20;

export const savedApplicationMaterialIdSchema = z
  .string()
  .regex(/^amd_[A-Za-z0-9_-]{8,64}$/u, "must be a saved application material id");

const shortText = z.string().trim().min(1).max(200);

export const applicationMaterialTones = ["formal", "warm", "direct"] as const;
export const applicationMaterialLengths = ["short", "standard", "long"] as const;
export const maximumApplicationMaterialEmphasisCharacters = 400;
export const maximumApplicationMaterialAddresseeCharacters = 120;

/**
 * The candidate's own guidance for one draft (#2478): what to stress, the tone, the length and,
 * for a cover letter, whom to address. It steers the writing and is never a source: a claim or a
 * number still needs a cited fact.
 */
export const applicationMaterialGuidanceSchema = z
  .strictObject({
    emphasis: z
      .string()
      .trim()
      .max(maximumApplicationMaterialEmphasisCharacters)
      .optional()
      .describe("What to stress, in the candidate's words."),
    tone: z.enum(applicationMaterialTones).optional(),
    length: z.enum(applicationMaterialLengths).optional(),
    addressee: z
      .string()
      .trim()
      .max(maximumApplicationMaterialAddresseeCharacters)
      .optional()
      .describe("Whom a cover letter is addressed to, such as a hiring manager's name."),
  })
  .meta({ id: "ApplicationMaterialGuidance" });

export type ApplicationMaterialGuidance = z.infer<typeof applicationMaterialGuidanceSchema>;

export const savedApplicationMaterialSchema = z.strictObject({
  id: savedApplicationMaterialIdSchema,
  workspace_id: z.string().min(1).max(256),
  application_id: applicationIdSchema,
  kind: z.enum(savedApplicationMaterialKinds),
  items: z
    .array(
      z.strictObject({
        question: z.string().max(maximumSavedApplicationMaterialItemCharacters),
        text: z.string().min(1).max(maximumSavedApplicationMaterialItemCharacters),
        citations: z
          .array(
            z.strictObject({
              fact_id: shortText,
              text: z.string().max(maximumSavedApplicationMaterialItemCharacters),
            }),
          )
          .max(maximumSavedApplicationMaterialCitations),
      }),
    )
    .min(1)
    .max(maximumSavedApplicationMaterialItems),
  guidance: applicationMaterialGuidanceSchema.optional(),
  model: z.strictObject({ provider: shortText, model: shortText }),
  prompt_version: shortText,
  cost_usd: z.number().min(0),
  created_at: z.iso.datetime({ offset: true }),
});

export type SavedApplicationMaterial = z.infer<typeof savedApplicationMaterialSchema>;
