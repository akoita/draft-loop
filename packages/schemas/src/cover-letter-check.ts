import { z } from "zod";

/**
 * Check my letter (#3280): what Redakloop finds in a cover letter the candidate wrote, without
 * rewriting it. Three groups: claims the approved record does not support, each with the closest
 * approved fact; requirements the letter has not answered yet; and wording that reads as
 * machine-made. The letter itself is never stored; only this result is returned.
 */

/** The longest letter one check reads, in characters: about four pages of prose. */
export const maximumCoverLetterCheckCharacters = 8_000;

export const coverLetterCheckRequestSchema = z
  .strictObject({
    text: z
      .string()
      .trim()
      .min(1)
      .max(maximumCoverLetterCheckCharacters)
      .describe("The letter as the candidate wrote it, paragraphs split by blank lines."),
  })
  .meta({ id: "CoverLetterCheckRequest" });

const id = z.string().trim().min(1).max(200);
const sentence = z.string().min(1).max(maximumCoverLetterCheckCharacters);
const sourceText = z.string().min(1).max(1_200);

/** Why a claim is not supported, in the candidate's terms. */
export const coverLetterClaimFindingReasons = [
  "no_supporting_fact",
  "number_not_in_fact",
  "joins_different_roles",
] as const;

/** Why the claim check did not run; the other two groups are complete either way. */
export const coverLetterCheckSkipReasons = [
  "model_calls_paused",
  "model_unavailable",
  "consent_required",
  "no_facts",
] as const;

export const coverLetterWordingCodes = [
  "job_ad_echo",
  "empty_superlative",
  "stock_phrase",
  "heavy_dashes",
  "list_of_three",
  "mirrored_openings",
  "word_count",
  "planted_word",
] as const;

export const coverLetterClaimFindingSchema = z
  .strictObject({
    paragraph: z.number().int().min(0),
    sentence: sentence.describe("The sentence as the candidate wrote it."),
    about: z.enum(["candidate", "employer"]).describe("Whom the sentence makes a claim about."),
    reason: z.enum(coverLetterClaimFindingReasons),
    numbers: z
      .array(z.string().min(1).max(40))
      .max(20)
      .optional()
      .describe("For number_not_in_fact: the numbers no approved fact states."),
    closest_fact: z
      .strictObject({ fact_id: id, text: sourceText })
      .nullable()
      .describe("The approved fact closest to the sentence, or null when none shares a word."),
  })
  .meta({ id: "CoverLetterClaimFinding" });

export const coverLetterCheckSchema = z
  .strictObject({
    claims: z
      .strictObject({
        status: z.enum(["checked", "skipped"]),
        reason: z
          .enum(coverLetterCheckSkipReasons)
          .optional()
          .describe("Set when the claim check was skipped."),
        checked_sentences: z.number().int().min(0),
        findings: z.array(coverLetterClaimFindingSchema).max(200),
      })
      .describe("Sentences the candidate's approved record does not support."),
    requirements: z
      .strictObject({
        source: z
          .enum(["kit", "brief", "none"])
          .describe("The latest saved writing kit, else the job brief's top requirements."),
        kit_id: id.optional().describe("The writing kit the requirements came from."),
        total: z.number().int().min(0),
        unanswered: z
          .array(
            z.strictObject({
              requirement_id: id,
              text: sourceText,
              facts: z
                .array(z.strictObject({ fact_id: id, text: sourceText }))
                .max(4)
                .describe("The kit's approved facts that prove it; empty without a kit."),
            }),
          )
          .max(20),
      })
      .describe("Requirements the letter does not answer yet."),
    wording: z
      .array(
        z.strictObject({
          code: z.enum(coverLetterWordingCodes),
          paragraph: z.number().int().min(0).optional(),
          sentence: sentence.optional(),
          match: z.string().min(1).max(400).optional(),
        }),
      )
      .max(400)
      .describe("Wording that reads as machine-made, found without a model."),
    model: z
      .strictObject({ provider: z.string(), model: z.string() })
      .nullable()
      .describe("The model that linked sentences to facts; null when the claim check skipped."),
    prompt_version: z.string().nullable(),
    cost_usd: z.number().min(0),
  })
  .meta({ id: "CoverLetterCheck" });

export type CoverLetterCheck = z.infer<typeof coverLetterCheckSchema>;
export type CoverLetterClaimFinding = z.infer<typeof coverLetterClaimFindingSchema>;
export type CoverLetterWordingCode = (typeof coverLetterWordingCodes)[number];
export type CoverLetterCheckSkipReason = (typeof coverLetterCheckSkipReasons)[number];
