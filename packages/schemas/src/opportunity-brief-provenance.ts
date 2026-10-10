import { opportunityBriefMaximumTextLength } from "@draft-loop/domain";
import { z } from "zod";

import { opportunityBriefNonEmptyString } from "./opportunity-brief-fields.js";
import { strictTimestampSchema } from "./schema-primitives.js";

/**
 * Where a captured page's job text came from when it was not the visible page text.
 * `job-posting-json-ld`: the page's schema.org JobPosting structured data.
 */
export const opportunityBriefTextOrigins = ["job-posting-json-ld"] as const;
export type OpportunityBriefTextOrigin = (typeof opportunityBriefTextOrigins)[number];
export const opportunityBriefTextOriginSchema = z.enum(opportunityBriefTextOrigins);

const opportunityBriefChecksumSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/iu, "must be a SHA-256 checksum")
  .transform((value) => value.toLowerCase());
const opportunityBriefUrlSchema = opportunityBriefNonEmptyString
  .max(opportunityBriefMaximumTextLength)
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:";
    } catch {
      return false;
    }
  }, "must be a valid HTTPS URL");

const opportunityBriefApprovedUrlProvenanceSchema = z.strictObject({
  kind: z.literal("approved-url"),
  originalUrl: opportunityBriefUrlSchema,
  finalUrl: opportunityBriefUrlSchema.optional(),
  capturedAt: strictTimestampSchema,
  contentChecksum: opportunityBriefChecksumSchema.nullable(),
  textOrigin: opportunityBriefTextOriginSchema.optional(),
});

const opportunityBriefLocalFileProvenanceSchema = z.strictObject({
  kind: z.literal("local-file"),
  displayName: opportunityBriefNonEmptyString
    .max(opportunityBriefMaximumTextLength)
    .refine(
      (value) =>
        !value.includes("/") &&
        !value.includes("\\") &&
        !value.startsWith("~") &&
        !/^[A-Za-z]:/u.test(value),
      "must be a display name, not a host path",
    ),
  capturedAt: strictTimestampSchema,
  checksum: opportunityBriefChecksumSchema.nullable(),
  textOrigin: opportunityBriefTextOriginSchema.optional(),
});

const opportunityBriefPastedContentProvenanceSchema = z.strictObject({
  kind: z.literal("pasted-content"),
  capturedAt: strictTimestampSchema,
  checksum: opportunityBriefChecksumSchema.nullable(),
});

const opportunityBriefCandidateInputProvenanceSchema = z.strictObject({
  kind: z.literal("candidate-input"),
  capturedAt: strictTimestampSchema,
  checksum: opportunityBriefChecksumSchema.nullable(),
});

export const opportunityBriefProvenanceSchema = z.discriminatedUnion("kind", [
  opportunityBriefApprovedUrlProvenanceSchema,
  opportunityBriefLocalFileProvenanceSchema,
  opportunityBriefPastedContentProvenanceSchema,
  opportunityBriefCandidateInputProvenanceSchema,
]);
export type OpportunityBriefProvenance = z.infer<typeof opportunityBriefProvenanceSchema>;
