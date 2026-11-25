import { findPlantedInstructions } from "@draft-loop/ingestion";
import type { ApplicationJobPageHiddenText } from "@draft-loop/schemas/application";
import { z } from "zod";

/** The most instructions one job view lists; a job ad that plants more is shown in part. */
export const maxListedJobAdInstructions = 12;

const jobAdInstructionSchema = z.object({
  text: z.string().describe("The sentence as the job ad has it."),
  words: z
    .array(z.string())
    .describe("The words or phrases it asks an AI tool to add; empty when it names none."),
  hidden: z
    .boolean()
    .describe("True when the page hid the sentence from its reader, such as in white text."),
});

export const jobAdInstructionsSchema = z
  .object({
    instructions: z.array(jobAdInstructionSchema).max(maxListedJobAdInstructions),
  })
  .describe(
    "Instructions in the job ad written for AI tools rather than for the candidate, such as a word to add or a phrase to start with. They are left out of what the models read; hidden page text is left out whatever it says.",
  )
  .meta({ id: "JobAdInstructions" });
export type JobAdInstructions = z.infer<typeof jobAdInstructionsSchema>;

/**
 * The instructions written for AI tools in a job ad's text and in what its page hid (#3336), or
 * null when there are none. Hidden text is listed only where it holds such an instruction: a
 * hidden menu label or skip link is left out of the job ad without a word.
 */
export function jobAdInstructions(
  text: string | null,
  hiddenText: readonly ApplicationJobPageHiddenText[] = [],
): JobAdInstructions | null {
  const instructions = [
    ...hiddenText.flatMap((hidden) =>
      findPlantedInstructions(hidden.text).map(({ text: sentence, words }) => ({
        text: sentence,
        words: [...words],
        hidden: true,
      })),
    ),
    ...findPlantedInstructions(text ?? "").map(({ text: sentence, words }) => ({
      text: sentence,
      words: [...words],
      hidden: false,
    })),
  ].slice(0, maxListedJobAdInstructions);
  return instructions.length === 0 ? null : { instructions };
}
