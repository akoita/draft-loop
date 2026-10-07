import {
  opportunityBriefMaximumCollectionEntries,
  opportunityExtractionContradictionFields,
  opportunityExtractionSchemaVersion,
  requirementPriorities,
} from "@draft-loop/domain";
import { z } from "zod";

import {
  opportunityBriefMaximumExcerptLength,
  opportunityBriefSourceIdsSchema,
  opportunityBriefTextSchema,
  opportunityExtractionMaximumProposedExcerptLength,
} from "./opportunity-brief-fields.js";

const opportunityExtractionSourcedTextSchema = z.strictObject({
  value: opportunityBriefTextSchema,
  sourceIds: opportunityBriefSourceIdsSchema,
});

// Strict structured output needs every property present, so an absent quote is null. The
// 300-character brief bound is enforced by excerpt verification, which drops a longer quote
// instead of failing the whole extraction.
const opportunityExtractionExcerptSchema = z
  .string()
  .max(opportunityExtractionMaximumProposedExcerptLength)
  .nullable()
  .describe(
    `A short verbatim quote of at most ${opportunityBriefMaximumExcerptLength} characters copied exactly from a cited source text that supports this entry, or null if none applies. Never paraphrase.`,
  );

const opportunityExtractionResponsibilitySchema = z.strictObject({
  text: opportunityBriefTextSchema,
  sourceIds: opportunityBriefSourceIdsSchema,
  excerpt: opportunityExtractionExcerptSchema,
});

const opportunityExtractionRequirementSchema = z.strictObject({
  text: opportunityBriefTextSchema,
  priority: z.enum(requirementPriorities),
  sourceIds: opportunityBriefSourceIdsSchema,
  excerpt: opportunityExtractionExcerptSchema,
});

const opportunityExtractionPrioritySchema = z.strictObject({
  text: opportunityBriefTextSchema,
  sourceIds: opportunityBriefSourceIdsSchema,
});

const opportunityExtractionContradictionSourceIdsSchema = opportunityBriefSourceIdsSchema.min(2);

const opportunityExtractionContradictionSchema = z.strictObject({
  field: z.enum(opportunityExtractionContradictionFields),
  sourceIds: opportunityExtractionContradictionSourceIdsSchema,
});

/** Provider-facing opportunity extraction output without application-owned metadata. */
export const opportunityExtractionProposalSchema = z.strictObject({
  schemaVersion: z.literal(opportunityExtractionSchemaVersion),
  role: opportunityExtractionSourcedTextSchema.nullable(),
  employer: opportunityExtractionSourcedTextSchema.nullable(),
  responsibilities: z
    .array(opportunityExtractionResponsibilitySchema)
    .max(opportunityBriefMaximumCollectionEntries),
  requirements: z
    .array(opportunityExtractionRequirementSchema)
    .max(opportunityBriefMaximumCollectionEntries),
  priorities: z
    .array(opportunityExtractionPrioritySchema)
    .max(opportunityBriefMaximumCollectionEntries),
  contradictions: z
    .array(opportunityExtractionContradictionSchema)
    .max(opportunityBriefMaximumCollectionEntries),
});

export type OpportunityExtractionProposal = z.infer<typeof opportunityExtractionProposalSchema>;

/** Draft-7 JSON schema for the provider-facing opportunity extraction output. */
const opportunityExtractionProposalJsonSchemaWithMeta = z.toJSONSchema(
  opportunityExtractionProposalSchema,
  { target: "draft-7" },
);

const {
  $schema: _opportunityExtractionProposalSchemaMetadata,
  ...opportunityExtractionProposalJsonSchemaValue
} = opportunityExtractionProposalJsonSchemaWithMeta;

export const opportunityExtractionProposalJsonSchema = opportunityExtractionProposalJsonSchemaValue;
