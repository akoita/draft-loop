import {
  opportunityBriefMaximumIdLength,
  opportunityBriefMaximumSourceIds,
  opportunityBriefMaximumTextLength,
} from "@draft-loop/domain";
import { z } from "zod";

/** Longest verbatim job-text quotation kept beside an extracted brief entry. */
export const opportunityBriefMaximumExcerptLength = 300;

export const opportunityBriefNonEmptyString = z.string().trim().min(1, "must not be empty");

export const opportunityBriefIdSchema = opportunityBriefNonEmptyString.max(
  opportunityBriefMaximumIdLength,
);

export const opportunityBriefTextSchema = opportunityBriefNonEmptyString.max(
  opportunityBriefMaximumTextLength,
);

/** Sanity cap on a provider-proposed quotation; longer ones are dropped by verification, not fatal. */
export const opportunityExtractionMaximumProposedExcerptLength = 2_000;

/** Verbatim source quotation attached to an extracted brief entry. */
export const opportunityBriefExcerptSchema = opportunityBriefNonEmptyString.max(
  opportunityBriefMaximumExcerptLength,
);

export const opportunityBriefSourceIdsSchema = z
  .array(opportunityBriefIdSchema)
  .min(1)
  .max(opportunityBriefMaximumSourceIds)
  .superRefine((sourceIds, context) => {
    const seen = new Set<string>();
    for (const [index, sourceId] of sourceIds.entries()) {
      if (seen.has(sourceId)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "sourceIds must contain unique source ids",
        });
      }
      seen.add(sourceId);
    }
  });
