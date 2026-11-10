import { z } from "zod";

/**
 * What an interview preparation guide is written for (#2616): the interview's stage and shape,
 * how deep the guide goes, and what the candidate wants covered. Topics and notes steer the guide
 * and are never facts about the candidate. The interviewer is described by role only: the server
 * never searches a named person.
 */

export const interviewStages = [
  "screen",
  "technical",
  "manager",
  "case",
  "combined",
  "final",
] as const;
export const interviewFormats = ["video", "phone", "onsite"] as const;
export const interviewGuideDepths = ["essential", "extensive"] as const;
/** Quick picks for what the guide must cover; free text goes in `other_topics`. */
export const interviewTopics = [
  "salary",
  "availability",
  "remote-and-travel",
  "language",
  "career-gap",
  "departure",
  "management",
  "unused-technology",
] as const;

export const maximumInterviewMinutes = 480;
export const maximumInterviewOtherTopics = 5;
export const maximumInterviewTopicCharacters = 200;
export const maximumInterviewNotesCharacters = 1_000;

export type InterviewStage = (typeof interviewStages)[number];
export type InterviewGuideDepth = (typeof interviewGuideDepths)[number];

export const interviewDetailsSchema = z
  .strictObject({
    stage: z.enum(interviewStages),
    depth: z.enum(interviewGuideDepths),
    /** Local date and time as the candidate entered it, such as 2026-11-12T14:00. */
    scheduled_at: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/u, "must be a date, or a date and time")
      .optional(),
    length_minutes: z.number().int().min(5).max(maximumInterviewMinutes).optional(),
    format: z.enum(interviewFormats).optional(),
    interviewer_role: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe("Such as recruiter or engineering manager; never searched as a person."),
    /** The interview's language, as a BCP 47 tag; the guide is written in the application's. */
    language: z
      .string()
      .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/u, "must be a language tag")
      .optional(),
    topics: z.array(z.enum(interviewTopics)).max(interviewTopics.length).optional(),
    other_topics: z
      .array(z.string().trim().min(1).max(maximumInterviewTopicCharacters))
      .max(maximumInterviewOtherTopics)
      .optional(),
    notes: z.string().trim().max(maximumInterviewNotesCharacters).optional(),
  })
  .superRefine((details, context) => {
    if (details.topics !== undefined && new Set(details.topics).size !== details.topics.length) {
      context.addIssue({ code: "custom", path: ["topics"], message: "topics repeat" });
    }
  })
  .meta({ id: "InterviewDetails" });

export type InterviewDetails = z.infer<typeof interviewDetailsSchema>;

/**
 * The depth a guide is suggested at: essential for a screen or an interview of 30 minutes or
 * less, extensive for a combined or final round or an hour or more. The candidate can switch.
 */
export function suggestedInterviewGuideDepth(
  details: Pick<InterviewDetails, "stage" | "length_minutes">,
): InterviewGuideDepth {
  if (details.stage === "combined" || details.stage === "final") return "extensive";
  if (details.length_minutes !== undefined) {
    if (details.length_minutes <= 30) return "essential";
    if (details.length_minutes >= 60) return "extensive";
  }
  return details.stage === "screen" ? "essential" : "extensive";
}
