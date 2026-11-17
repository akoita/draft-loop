import { z } from "zod";

/**
 * A project card's own facts (#2894): what a work-journal note does not already hold about one
 * code repository. A card is stored as a work-journal note that carries these details, so it
 * reuses the note's pending-then-approve review. Every number is counted from git or from the
 * repository host, never estimated; other contributors appear only as a count.
 */

export const projectCardRoles = ["sole-author", "lead", "contributor"] as const;
export type ProjectCardRole = (typeof projectCardRoles)[number];

export const projectCardLimits = Object.freeze({
  purposeMin: 8,
  purposeMax: 160,
  highlightsMax: 8,
  highlightTextMax: 300,
  highlightSourceMax: 200,
});

/** Whether a string holds a control character other than the allowed ones. */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** One line of plain text, without control characters. */
export function projectCardLine(min: number, max: number) {
  return z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !hasControlCharacter(value), "must be one line of plain text");
}

/** A calendar day, `2026-10-31`. */
export const projectCardDaySchema = z
  .string()
  .regex(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u, "must be YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: "must be a real date" });

const count = z.number().int().min(0).max(10_000_000);

/** The candidate's own share of the repository, counted with `git log --author`. */
export const projectCardContributionSchema = z
  .object({
    own_commits: count.min(1),
    total_commits: count.min(1),
    first_commit: projectCardDaySchema,
    last_commit: projectCardDaySchema,
    merged_pull_requests: count.optional(),
    /** Other people who committed: a count only, never a name or an email. */
    other_contributors: count,
  })
  .strict()
  .refine((value) => value.own_commits <= value.total_commits, {
    message: "own_commits must not exceed total_commits",
    path: ["own_commits"],
  })
  .refine((value) => value.last_commit >= value.first_commit, {
    message: "last_commit must not be before first_commit",
    path: ["last_commit"],
  });
export type ProjectCardContribution = z.infer<typeof projectCardContributionSchema>;

/** What the repository shows about its maturity; each field is optional and counted. */
export const projectCardScaleSchema = z
  .object({
    releases: count.optional(),
    stars: count.optional(),
    continuous_integration: z.boolean().optional(),
    automated_tests: z.boolean().optional(),
  })
  .strict();
export type ProjectCardScale = z.infer<typeof projectCardScaleSchema>;

/** One notable result, citing the file or pull request it was read from. */
export const projectCardHighlightSchema = z
  .object({
    text: projectCardLine(8, projectCardLimits.highlightTextMax),
    source: projectCardLine(1, projectCardLimits.highlightSourceMax),
  })
  .strict();
export type ProjectCardHighlight = z.infer<typeof projectCardHighlightSchema>;

/** The card facts a stored note carries next to its note-shaped content. */
export const projectCardDetailsSchema = z
  .object({
    purpose: projectCardLine(projectCardLimits.purposeMin, projectCardLimits.purposeMax),
    role: z.enum(projectCardRoles),
    contribution: projectCardContributionSchema,
    scale: projectCardScaleSchema.default({}),
    highlights: z
      .array(projectCardHighlightSchema)
      .max(projectCardLimits.highlightsMax)
      .default([]),
  })
  .strict();
export type ProjectCardDetails = z.infer<typeof projectCardDetailsSchema>;

/** The candidate's share of the repository's commits, as a whole percentage. */
export function projectCardCommitShare(contribution: ProjectCardContribution): number {
  return Math.round((contribution.own_commits / contribution.total_commits) * 100);
}
