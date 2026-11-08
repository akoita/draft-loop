import { z } from "zod";

import { applicationIdSchema } from "./application.js";

/**
 * A research brief kept with its application (#2542): what the server searched for after the
 * candidate approved, the public sources it kept, and short findings that each cite those sources.
 * Briefs are versions: a new research run adds one, and the candidate can read or delete each.
 * A brief is about the employer, never the candidate, but it lives with the record and is erased
 * with it.
 */

export const researchBriefIdSchema = z
  .string()
  .regex(/^rbr_[A-Za-z0-9_-]{8,64}$/u, "must be a research brief id");

export const researchSourceKinds = ["upload", "company-page", "web-result"] as const;

export const maximumResearchQueries = 5;
export const maximumResearchSources = 30;
export const maximumResearchFindings = 12;
export const maximumResearchFindingSources = 5;
export const maximumResearchFindingCharacters = 600;
export const maximumResearchExcerptCharacters = 1_200;

const day = z.iso.date();
const shortText = z.string().trim().min(1).max(200);
const sourceIdSchema = z.string().regex(/^src_[0-9]{1,3}$/u, "must be a research source id");

export const researchSourceSchema = z
  .strictObject({
    id: sourceIdSchema,
    kind: z.enum(researchSourceKinds),
    /** Absent for an upload, which has no address. */
    url: z
      .url({ protocol: /^https?$/u })
      .max(2_000)
      .optional(),
    title: z.string().trim().min(1).max(300),
    excerpt: z.string().max(maximumResearchExcerptCharacters),
    /** When the page was published or last updated; absent marks the source undated. */
    published_on: day.optional(),
  })
  .meta({ id: "ResearchSource" });

export const researchFindingSchema = z
  .strictObject({
    id: z.string().regex(/^fnd_[0-9]{1,3}$/u, "must be a research finding id"),
    text: z.string().trim().min(1).max(maximumResearchFindingCharacters),
    source_ids: z.array(sourceIdSchema).min(1).max(maximumResearchFindingSources),
  })
  .meta({ id: "ResearchFinding" });

export const researchBriefSchema = z
  .strictObject({
    id: researchBriefIdSchema,
    workspace_id: z.string().min(1).max(256),
    application_id: applicationIdSchema,
    queries: z.array(z.string().trim().min(1).max(300)).min(1).max(maximumResearchQueries),
    /** The oldest publication date the run kept. */
    from_date: day,
    sources: z.array(researchSourceSchema).max(maximumResearchSources),
    findings: z.array(researchFindingSchema).max(maximumResearchFindings),
    /** Sources the run dropped: flagged by screening, or published before `from_date`. */
    dropped: z.strictObject({
      flagged: z.number().int().min(0),
      outdated: z.number().int().min(0),
    }),
    search_provider: shortText,
    model: z.strictObject({ provider: shortText, model: shortText }),
    cost_usd: z.number().min(0),
    created_at: z.iso.datetime({ offset: true }),
  })
  .superRefine((brief, context) => {
    const ids = new Set(brief.sources.map((source) => source.id));
    if (ids.size !== brief.sources.length) {
      context.addIssue({ code: "custom", path: ["sources"], message: "source ids repeat" });
    }
    brief.findings.forEach((finding, index) => {
      if (finding.source_ids.some((id) => !ids.has(id))) {
        context.addIssue({
          code: "custom",
          path: ["findings", index, "source_ids"],
          message: "a finding cites a source the brief does not keep",
        });
      }
    });
  });

export type ResearchSource = z.infer<typeof researchSourceSchema>;
export type ResearchFinding = z.infer<typeof researchFindingSchema>;
export type ResearchBrief = z.infer<typeof researchBriefSchema>;
