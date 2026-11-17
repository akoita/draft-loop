import { z } from "zod";

/**
 * Feedback context and triage (#2875, #2877): the technical facts a note carries, so the
 * operator can tell what broke without asking, and the operator's triage of each note.
 *
 * A context holds names, ids, codes and coarse browser facts only: never a screenshot, page
 * text, a CV, a job description or a request body. The client sends what it sees; the API adds
 * the facts it knows itself, the source, the server release and the plan, and never takes them
 * from the client.
 */

/** Where a note came from: the web screen, or an agent passing on the candidate's note. */
export const feedbackContextSources = ["web", "agent"] as const;
export type FeedbackContextSource = (typeof feedbackContextSources)[number];

/** The most recent API errors a note carries. */
export const maximumFeedbackRecentErrors = 5;

/** The largest context a client may send, in characters of its JSON. */
export const maximumFeedbackClientContextCharacters = 3_072;

/** An id as the API names records, applications and runs: no spaces, no query characters. */
const idSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);

/** A short name such as a browser family or a build id. */
const nameSchema = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .regex(/^[A-Za-z0-9 ._:/+-]+$/u);

export const feedbackRecentErrorSchema = z
  .strictObject({
    code: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_.:-]+$/u)
      .describe("The API's content-free error code, or `network` when it did not answer."),
    message: z.string().max(200).describe("The API's content-free message, cut to 200 characters."),
    at: z.iso.datetime({ offset: true }),
  })
  .meta({ id: "FeedbackRecentError" });

export const feedbackBrowserSchema = z
  .strictObject({
    family: nameSchema(32).describe("Browser family, such as Firefox; never the user agent."),
    os: nameSchema(32).describe("Operating system family, such as macOS."),
    viewport: z
      .string()
      .regex(/^\d{1,5}x\d{1,5}$/u)
      .describe("Window size in CSS pixels, such as 1280x800."),
    language: z
      .string()
      .min(2)
      .max(35)
      .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u),
    theme: z.enum(["light", "dark"]),
  })
  .meta({ id: "FeedbackBrowser" });

const clientContextShape = {
  route: z
    .string()
    .max(200)
    .regex(/^[A-Za-z0-9._:/#-]*$/u)
    .optional()
    .describe("The page's path and fragment, never its query."),
  webBuild: nameSchema(64).optional().describe("The web screen's build id."),
  ids: z
    .strictObject({
      recordId: idSchema.optional(),
      applicationId: idSchema.optional(),
      runId: idSchema.optional(),
    })
    .optional()
    .describe("The candidate record, application and run last opened."),
  recentErrors: z
    .array(feedbackRecentErrorSchema)
    .max(maximumFeedbackRecentErrors)
    .optional()
    .describe("The last API errors the screen met, newest last; never a request or answer body."),
  lastFailedRequestId: idSchema.optional().describe("The id of the last request that failed."),
  browser: feedbackBrowserSchema.optional(),
};

/** What a client sends with a note. */
export const feedbackClientContextSchema = z
  .strictObject(clientContextShape)
  .refine(
    (context) => JSON.stringify(context).length <= maximumFeedbackClientContextCharacters,
    `A context is at most ${maximumFeedbackClientContextCharacters} characters of JSON.`,
  )
  .meta({ id: "FeedbackClientContext" });

export type FeedbackClientContext = z.infer<typeof feedbackClientContextSchema>;

/** What a stored note carries: the client's facts and the server's own. */
export const feedbackContextSchema = z
  .strictObject({
    ...clientContextShape,
    source: z
      .enum(feedbackContextSources)
      .describe("Set by the server from the route: `web` from the screen, `agent` from a token."),
    serverRelease: z.string().max(64).nullable().describe("The server release that took the note."),
    plan: z.string().max(64).nullable().describe("The organisation's plan when the note was sent."),
  })
  .meta({ id: "FeedbackContext" });

export type FeedbackContext = z.infer<typeof feedbackContextSchema>;

/** Where the operator is with a note. */
export const feedbackStatuses = ["new", "triaged", "issue", "closed"] as const;
export type FeedbackStatus = (typeof feedbackStatuses)[number];

/** A GitHub issue's https address, the only link a note's triage keeps. */
export const feedbackIssueUrlSchema = z
  .string()
  .max(300)
  .regex(
    /^https:\/\/github\.com\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}\/issues\/[1-9]\d{0,9}$/u,
    "An issue link is an https GitHub issue address.",
  );

/** The operator's triage of one note. */
export const feedbackTriageSchema = z
  .strictObject({
    status: z.enum(feedbackStatuses),
    issueUrl: feedbackIssueUrlSchema
      .nullable()
      .optional()
      .describe("The GitHub issue the note led to; null clears it, leaving it out keeps it."),
  })
  .meta({ id: "FeedbackTriage" });

export type FeedbackTriage = z.infer<typeof feedbackTriageSchema>;
