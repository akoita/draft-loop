import {
  opportunityBriefIssueCodes,
  opportunityBriefIssueSeverities,
  opportunityBriefIssueStatuses,
  opportunityBriefMaximumCollectionEntries,
  opportunityBriefMaximumMessageLength,
  requirementPriorities,
} from "@draft-loop/domain";
import { z } from "zod";

import {
  opportunityBriefExcerptSchema,
  opportunityBriefIdSchema,
  opportunityBriefNonEmptyString,
  opportunityBriefSourceIdsSchema,
  opportunityBriefTextSchema,
} from "./opportunity-brief-fields.js";

/** The entries of an opportunity brief: its sourced texts, collections and issues. */

export const opportunityBriefIssueCodeSchema = z.enum(opportunityBriefIssueCodes);
export const opportunityBriefIssueStatusSchema = z.enum(opportunityBriefIssueStatuses);
export const opportunityBriefIssueSeveritySchema = z.enum(opportunityBriefIssueSeverities);

export const opportunityBriefSourcedTextSchema = z.strictObject({
  value: opportunityBriefTextSchema,
  sourceIds: opportunityBriefSourceIdsSchema,
});
export type OpportunityBriefSourcedText = z.infer<typeof opportunityBriefSourcedTextSchema>;

export const opportunityBriefResponsibilitySchema = z.strictObject({
  id: opportunityBriefIdSchema,
  text: opportunityBriefTextSchema,
  sourceIds: opportunityBriefSourceIdsSchema,
  excerpt: opportunityBriefExcerptSchema.optional(),
});
export type OpportunityBriefResponsibility = z.infer<typeof opportunityBriefResponsibilitySchema>;

export const opportunityBriefRequirementSchema = z.strictObject({
  id: opportunityBriefIdSchema,
  text: opportunityBriefTextSchema,
  priority: z.enum(requirementPriorities),
  sourceIds: opportunityBriefSourceIdsSchema,
  excerpt: opportunityBriefExcerptSchema.optional(),
});
export type OpportunityBriefRequirement = z.infer<typeof opportunityBriefRequirementSchema>;

export const opportunityBriefPrioritySchema = z.strictObject({
  id: opportunityBriefIdSchema,
  text: opportunityBriefTextSchema,
  sourceIds: opportunityBriefSourceIdsSchema,
});
export type OpportunityBriefPriority = z.infer<typeof opportunityBriefPrioritySchema>;

export const opportunityBriefCandidateInstructionsSchema = z.strictObject({
  tone: opportunityBriefSourcedTextSchema.nullable(),
  applicationGoal: opportunityBriefSourcedTextSchema.nullable(),
  forbiddenLanguage: z
    .array(opportunityBriefSourcedTextSchema)
    .max(opportunityBriefMaximumCollectionEntries),
  focusAreas: z
    .array(opportunityBriefSourcedTextSchema)
    .max(opportunityBriefMaximumCollectionEntries),
});
export type OpportunityBriefCandidateInstructions = z.infer<
  typeof opportunityBriefCandidateInstructionsSchema
>;

export const opportunityBriefIssueSchema = z.strictObject({
  id: opportunityBriefIdSchema,
  code: opportunityBriefIssueCodeSchema,
  status: opportunityBriefIssueStatusSchema,
  severity: opportunityBriefIssueSeveritySchema,
  message: opportunityBriefNonEmptyString.max(opportunityBriefMaximumMessageLength),
  sourceIds: opportunityBriefSourceIdsSchema,
});
export type OpportunityBriefIssue = z.infer<typeof opportunityBriefIssueSchema>;

/** A brief collection, bounded like every other. */
export const opportunityBriefCollectionSchema = <T extends z.ZodType>(schema: T) =>
  z.array(schema).max(opportunityBriefMaximumCollectionEntries);
