import { z } from "zod";

/**
 * A guided career interview session (#1030, #2175): the topics proposed to the candidate, the
 * conversation on each, and where it stopped, so the candidate can pause and resume across days.
 * Turns are candidate material: the session lives in the workspace's storage under its consent and
 * is erased with the workspace. The method is `docs/reference/career-interview-method.md`.
 */

export const careerInterviewTopicKinds = [
  "role-gap",
  "untold-period",
  "untold-theme",
  "application-relevance",
  "candidate-subject",
] as const;
export type CareerInterviewTopicKindName = (typeof careerInterviewTopicKinds)[number];

/**
 * - `proposed`: offered, no answer yet. `declined`: the candidate said no; not offered again
 *   until the record changes. `open`: being discussed. `summarised`: a summary waits for the
 *   candidate's confirmation. `closed`: confirmed or set aside.
 */
export const careerInterviewTopicStatuses = [
  "proposed",
  "declined",
  "open",
  "summarised",
  "closed",
] as const;
export type CareerInterviewTopicStatus = (typeof careerInterviewTopicStatuses)[number];

export const careerInterviewSessionStatuses = ["open", "paused", "closed"] as const;
export type CareerInterviewSessionStatus = (typeof careerInterviewSessionStatuses)[number];

export const careerInterviewTurnRoles = ["interviewer", "candidate"] as const;

/** A candidate turn may be a skip or an "I don't remember" instead of words. */
export const careerInterviewTurnMarks = ["skipped", "unknown"] as const;

export const maximumCareerInterviewTopicsPerSession = 8;
export const maximumCareerInterviewTurnsPerTopic = 40;
export const maximumCareerInterviewTurnCharacters = 4_000;
export const maximumCareerInterviewSummaryCharacters = 4_000;

const timestamp = z.iso.datetime({ offset: true });
const text = (maximum: number) => z.string().trim().min(1).max(maximum);

export const careerInterviewSessionIdSchema = z
  .string()
  .regex(/^cis_[A-Za-z0-9_-]{8,64}$/u, "must be a career interview session id");

export const careerInterviewTurnSchema = z
  .strictObject({
    role: z.enum(careerInterviewTurnRoles),
    text: z.string().trim().max(maximumCareerInterviewTurnCharacters),
    mark: z.enum(careerInterviewTurnMarks).optional(),
    at: timestamp,
  })
  .refine((turn) => turn.text !== "" || turn.mark !== undefined, {
    message: "a turn needs words or a mark",
    path: ["text"],
  })
  .refine((turn) => turn.mark === undefined || turn.role === "candidate", {
    message: "only the candidate skips or does not remember",
    path: ["mark"],
  });
export type CareerInterviewTurn = z.infer<typeof careerInterviewTurnSchema>;

export const careerInterviewSessionTopicSchema = z.strictObject({
  key: text(400),
  kind: z.enum(careerInterviewTopicKinds),
  reason: text(600),
  status: z.enum(careerInterviewTopicStatuses),
  fact_ids: z.array(text(256)).max(200).default([]),
  requirement_ids: z.array(text(256)).max(50).default([]),
  turns: z.array(careerInterviewTurnSchema).max(maximumCareerInterviewTurnsPerTopic).default([]),
  summary: text(maximumCareerInterviewSummaryCharacters).optional(),
});
export type CareerInterviewSessionTopic = z.infer<typeof careerInterviewSessionTopicSchema>;

/** The model that phrased the interviewer's turns, recorded for the run history rules. */
export const careerInterviewModelSchema = z.strictObject({
  provider: text(64),
  model: text(128),
});

export const careerInterviewSessionSchema = z
  .strictObject({
    id: careerInterviewSessionIdSchema,
    workspace_id: text(256),
    status: z.enum(careerInterviewSessionStatuses),
    topics: z
      .array(careerInterviewSessionTopicSchema)
      .max(maximumCareerInterviewTopicsPerSession)
      .default([]),
    model: careerInterviewModelSchema.optional(),
    created_at: timestamp,
    updated_at: timestamp,
  })
  .superRefine((session, context) => {
    const seen = new Set<string>();
    for (const [index, topic] of session.topics.entries()) {
      if (seen.has(topic.key)) {
        context.addIssue({
          code: "custom",
          message: "a topic appears once per session",
          path: ["topics", index, "key"],
        });
      }
      seen.add(topic.key);
    }
    if (session.updated_at < session.created_at) {
      context.addIssue({
        code: "custom",
        message: "updated before created",
        path: ["updated_at"],
      });
    }
  });
export type CareerInterviewSession = z.infer<typeof careerInterviewSessionSchema>;
export type CareerInterviewSessionInput = z.input<typeof careerInterviewSessionSchema>;
