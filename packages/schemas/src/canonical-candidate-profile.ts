import type {
  CandidateKnowledgeSelectionSnapshotInput,
  CanonicalCandidateProfileInput as CanonicalCandidateProfileDomainInput,
} from "@draft-loop/domain";
import {
  candidateKnowledgeSelectionSnapshotSchemaVersion,
  canonicalCandidateProfileExtractionSchemaVersion,
  canonicalCandidateProfileFactCategories,
  canonicalCandidateProfileIssueCodes,
  canonicalCandidateProfileIssueSeverities,
  canonicalCandidateProfileIssueStatuses,
  canonicalCandidateProfileProvenanceKinds,
  canonicalCandidateProfileSchemaVersion,
  canonicalCandidateProfileStatuses,
  createCandidateKnowledgeSelectionSnapshot,
  createCanonicalCandidateProfile,
  maximumCanonicalCandidateProfileEvidenceKindCount,
  maximumCanonicalCandidateProfileExtractionIdentityLength,
  maximumCanonicalCandidateProfileFactCount,
  maximumCanonicalCandidateProfileFactIdLength,
  maximumCanonicalCandidateProfileFieldLength,
  maximumCanonicalCandidateProfileIdLength,
  maximumCanonicalCandidateProfileIssueCount,
  maximumCanonicalCandidateProfileIssueFactReferenceCount,
  maximumCanonicalCandidateProfileIssueMessageLength,
  maximumCanonicalCandidateProfileIssueSourceReferenceCount,
  maximumCanonicalCandidateProfileProvenanceCount,
  maximumCanonicalCandidateProfileProvenanceQuoteLength,
  maximumCanonicalCandidateProfileSensitivityRuleCount,
  maximumCanonicalCandidateProfileSubjectIdLength,
  maximumCanonicalCandidateProfileValueLength,
} from "@draft-loop/domain";
import { candidateEvidenceKinds } from "@draft-loop/domain/candidate-evidence-kind";
import { sourceSensitivityTiers } from "@draft-loop/domain/source-sensitivity";
import { z } from "zod";

import {
  candidateKnowledgeSelectionLifecycleDirectorySchema,
  candidateKnowledgeSelectionLifecycleObservationSchema,
  candidateKnowledgeSelectionLifecycleRetirementSchema,
  candidateKnowledgeSelectionLifecycleRevisionSchema,
} from "./candidate-knowledge-selection-lifecycle.js";
import { nonEmptyString, strictTimestampSchema } from "./schema-primitives.js";

/*
 * The legacy selection schema intentionally remains permissive for old
 * context snapshots. A canonical profile, however, must not silently strip a
 * path, URL, or other unknown selection field before provenance validation,
 * so it uses a strict copy of the same selection shape.
 */
const canonicalCandidateProfileSelectionObservationSchema =
  candidateKnowledgeSelectionLifecycleObservationSchema.strict();
const canonicalCandidateProfileSelectionRetirementSchema =
  candidateKnowledgeSelectionLifecycleRetirementSchema.strict();
const canonicalCandidateProfileSelectionDirectorySchema =
  candidateKnowledgeSelectionLifecycleDirectorySchema.strict();
const canonicalCandidateProfileSelectionRevisionSchema =
  candidateKnowledgeSelectionLifecycleRevisionSchema
    .extend({
      observation: canonicalCandidateProfileSelectionObservationSchema.nullable(),
      retirement: canonicalCandidateProfileSelectionRetirementSchema.nullable(),
      directory: canonicalCandidateProfileSelectionDirectorySchema.nullable(),
    })
    .strict();

const canonicalCandidateProfileSelectionSchema = z
  .strictObject({
    schemaVersion: z.literal(candidateKnowledgeSelectionSnapshotSchemaVersion).optional(),
    capturedAt: strictTimestampSchema,
    entries: z
      .array(
        z.strictObject({
          storeId: nonEmptyString,
          knowledgeBaseId: nonEmptyString,
          sources: z
            .array(
              z.strictObject({
                sourceId: nonEmptyString,
                versionId: nonEmptyString,
                lifecycleRevision: canonicalCandidateProfileSelectionRevisionSchema,
              }),
            )
            .min(1),
        }),
      )
      .min(1),
  })
  .transform((selection) =>
    createCandidateKnowledgeSelectionSnapshot(
      selection as unknown as CandidateKnowledgeSelectionSnapshotInput,
    ),
  );

const canonicalCandidateProfileIdSchema = nonEmptyString.max(
  maximumCanonicalCandidateProfileIdLength,
);
const canonicalCandidateProfileFactIdSchema = nonEmptyString.max(
  maximumCanonicalCandidateProfileFactIdLength,
);
const canonicalCandidateProfileSubjectIdSchema = nonEmptyString.max(
  maximumCanonicalCandidateProfileSubjectIdLength,
);
const canonicalCandidateProfileFieldSchema = nonEmptyString.max(
  maximumCanonicalCandidateProfileFieldLength,
);
const canonicalCandidateProfileValueSchema = nonEmptyString.max(
  maximumCanonicalCandidateProfileValueLength,
);
const canonicalCandidateProfileIssueMessageSchema = nonEmptyString.max(
  maximumCanonicalCandidateProfileIssueMessageLength,
);

export const canonicalCandidateProfileStatusSchema = z.enum(canonicalCandidateProfileStatuses);
export const canonicalCandidateProfileFactCategorySchema = z.enum(
  canonicalCandidateProfileFactCategories,
);
export const canonicalCandidateProfileProvenanceKindSchema = z.enum(
  canonicalCandidateProfileProvenanceKinds,
);
export const canonicalCandidateProfileIssueCodeSchema = z.enum(canonicalCandidateProfileIssueCodes);
export const canonicalCandidateProfileIssueSeveritySchema = z.enum(
  canonicalCandidateProfileIssueSeverities,
);
export const canonicalCandidateProfileIssueStatusSchema = z.enum(
  canonicalCandidateProfileIssueStatuses,
);

const canonicalCandidateProfileExtractionOpaqueIdentifierPattern =
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u;
const canonicalCandidateProfileExtractionOpaqueIdentifierSchema = nonEmptyString
  .max(maximumCanonicalCandidateProfileIdLength)
  .regex(
    canonicalCandidateProfileExtractionOpaqueIdentifierPattern,
    "must be a safe opaque identifier",
  );
const canonicalCandidateProfileExtractionFactKeySchema =
  canonicalCandidateProfileFactIdSchema.regex(
    canonicalCandidateProfileExtractionOpaqueIdentifierPattern,
    "must be a safe opaque identifier",
  );
const canonicalCandidateProfileExtractionSubjectKeySchema =
  canonicalCandidateProfileSubjectIdSchema.regex(
    canonicalCandidateProfileExtractionOpaqueIdentifierPattern,
    "must be a safe opaque identifier",
  );

const canonicalCandidateProfileExtractionEvidenceSchema = z.strictObject({
  sourceId: canonicalCandidateProfileExtractionOpaqueIdentifierSchema,
  quote: canonicalCandidateProfileValueSchema,
});

const canonicalCandidateProfileExtractionFactEvidenceSchema = z
  .array(canonicalCandidateProfileExtractionEvidenceSchema)
  .min(1)
  .max(maximumCanonicalCandidateProfileProvenanceCount)
  .superRefine((evidence, context) => {
    const seen = new Set<string>();
    for (const [index, item] of evidence.entries()) {
      const tuple = JSON.stringify([item.sourceId, item.quote]);
      if (seen.has(tuple)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "evidence must contain unique sourceId/quote tuples",
        });
      }
      seen.add(tuple);
    }
  });

const canonicalCandidateProfileExtractionFactSchema = z.strictObject({
  key: canonicalCandidateProfileExtractionFactKeySchema,
  category: canonicalCandidateProfileFactCategorySchema,
  subjectKey: canonicalCandidateProfileExtractionSubjectKeySchema.optional(),
  field: canonicalCandidateProfileFieldSchema,
  value: canonicalCandidateProfileValueSchema,
  evidence: canonicalCandidateProfileExtractionFactEvidenceSchema,
});

const canonicalCandidateProfileExtractionIssueSchema = z.strictObject({
  code: canonicalCandidateProfileIssueCodeSchema,
  factKeys: z
    .array(canonicalCandidateProfileExtractionFactKeySchema)
    .max(maximumCanonicalCandidateProfileIssueFactReferenceCount),
  sourceIds: z
    .array(canonicalCandidateProfileExtractionOpaqueIdentifierSchema)
    .max(maximumCanonicalCandidateProfileIssueSourceReferenceCount),
});

const canonicalCandidateProfileExtractionConflictCodes = new Set([
  "conflict-date",
  "conflict-title",
  "conflict-duration",
  "conflict-metric",
  "conflict-value",
  "duplicate",
]);

/** Provider-facing canonical profile extraction output without application metadata. */
export const canonicalCandidateProfileExtractionProposalSchema = z
  .strictObject({
    schemaVersion: z.literal(canonicalCandidateProfileExtractionSchemaVersion),
    facts: z
      .array(canonicalCandidateProfileExtractionFactSchema)
      .max(maximumCanonicalCandidateProfileFactCount),
    issues: z
      .array(canonicalCandidateProfileExtractionIssueSchema)
      .max(maximumCanonicalCandidateProfileIssueCount),
  })
  .superRefine((proposal, context) => {
    const factKeys = new Set<string>();
    for (const [index, fact] of proposal.facts.entries()) {
      if (factKeys.has(fact.key)) {
        context.addIssue({
          code: "custom",
          path: ["facts", index, "key"],
          message: "fact keys must be unique",
        });
      }
      factKeys.add(fact.key);
    }

    for (const [issueIndex, issue] of proposal.issues.entries()) {
      const issueFactKeys = new Set<string>();
      for (const [factKeyIndex, factKey] of issue.factKeys.entries()) {
        if (issueFactKeys.has(factKey)) {
          context.addIssue({
            code: "custom",
            path: ["issues", issueIndex, "factKeys", factKeyIndex],
            message: "factKeys must contain unique fact keys",
          });
        }
        issueFactKeys.add(factKey);
        if (!factKeys.has(factKey)) {
          context.addIssue({
            code: "custom",
            path: ["issues", issueIndex, "factKeys", factKeyIndex],
            message: "factKeys must reference proposal facts",
          });
        }
      }

      const issueSourceIds = new Set<string>();
      for (const [sourceIdIndex, sourceId] of issue.sourceIds.entries()) {
        if (issueSourceIds.has(sourceId)) {
          context.addIssue({
            code: "custom",
            path: ["issues", issueIndex, "sourceIds", sourceIdIndex],
            message: "sourceIds must contain unique source ids",
          });
        }
        issueSourceIds.add(sourceId);
      }

      if (
        canonicalCandidateProfileExtractionConflictCodes.has(issue.code) &&
        issue.factKeys.length < 2
      ) {
        context.addIssue({
          code: "custom",
          path: ["issues", issueIndex, "factKeys"],
          message: "conflict and duplicate issues require at least two fact keys",
        });
      }
    }
  });

export type CanonicalCandidateProfileExtractionProposal = z.infer<
  typeof canonicalCandidateProfileExtractionProposalSchema
>;

/** Draft-7 JSON schema for provider-facing canonical profile extraction output. */
const canonicalCandidateProfileExtractionProposalJsonSchemaWithMeta = z.toJSONSchema(
  canonicalCandidateProfileExtractionProposalSchema,
  { target: "draft-7" },
);

const {
  $schema: _canonicalCandidateProfileExtractionProposalSchemaMetadata,
  ...canonicalCandidateProfileExtractionProposalJsonSchemaValue
} = canonicalCandidateProfileExtractionProposalJsonSchemaWithMeta;

export const canonicalCandidateProfileExtractionProposalJsonSchema =
  canonicalCandidateProfileExtractionProposalJsonSchemaValue;

export const canonicalCandidateProfileProvenanceReferenceSchema = z.strictObject({
  storeId: canonicalCandidateProfileIdSchema,
  knowledgeBaseId: canonicalCandidateProfileIdSchema,
  sourceId: canonicalCandidateProfileIdSchema,
  versionId: canonicalCandidateProfileIdSchema,
  kind: canonicalCandidateProfileProvenanceKindSchema,
});
export type CanonicalCandidateProfileProvenanceReference = z.infer<
  typeof canonicalCandidateProfileProvenanceReferenceSchema
>;
export type CanonicalCandidateProfileSourceReference = CanonicalCandidateProfileProvenanceReference;

/** Fact provenance may also keep the exact grounded source quote; issue references never do. */
export const canonicalCandidateProfileFactProvenanceReferenceSchema =
  canonicalCandidateProfileProvenanceReferenceSchema.extend({
    quote: nonEmptyString.max(maximumCanonicalCandidateProfileProvenanceQuoteLength).optional(),
  });
export type CanonicalCandidateProfileFactProvenanceReference = z.infer<
  typeof canonicalCandidateProfileFactProvenanceReferenceSchema
>;

export const canonicalCandidateProfileFactSchema = z.strictObject({
  id: canonicalCandidateProfileFactIdSchema,
  category: canonicalCandidateProfileFactCategorySchema,
  subjectId: canonicalCandidateProfileSubjectIdSchema.optional(),
  field: canonicalCandidateProfileFieldSchema,
  value: canonicalCandidateProfileValueSchema,
  provenance: z
    .array(canonicalCandidateProfileFactProvenanceReferenceSchema)
    .min(1)
    .max(maximumCanonicalCandidateProfileProvenanceCount),
});
export type CanonicalCandidateProfileFact = z.infer<typeof canonicalCandidateProfileFactSchema>;

export const canonicalCandidateProfileIssueSchema = z.strictObject({
  id: canonicalCandidateProfileFactIdSchema,
  code: canonicalCandidateProfileIssueCodeSchema,
  severity: canonicalCandidateProfileIssueSeveritySchema,
  status: canonicalCandidateProfileIssueStatusSchema,
  message: canonicalCandidateProfileIssueMessageSchema,
  factIds: z
    .array(canonicalCandidateProfileFactIdSchema)
    .max(maximumCanonicalCandidateProfileIssueFactReferenceCount)
    .default([]),
  sourceRefs: z
    .array(canonicalCandidateProfileProvenanceReferenceSchema)
    .max(maximumCanonicalCandidateProfileIssueSourceReferenceCount)
    .default([]),
});
export type CanonicalCandidateProfileIssue = z.infer<typeof canonicalCandidateProfileIssueSchema>;

const canonicalCandidateProfileExtractionTextSchema = nonEmptyString.max(
  maximumCanonicalCandidateProfileExtractionIdentityLength,
);

const canonicalCandidateProfileSensitivityIdentitySchema = z.strictObject({
  excludedTiers: z
    .array(z.enum(sourceSensitivityTiers))
    .max(sourceSensitivityTiers.length)
    .refine((tiers) => new Set(tiers).size === tiers.length, "must not repeat a tier"),
  rules: z
    .array(
      z.strictObject({
        storeId: canonicalCandidateProfileIdSchema,
        knowledgeBaseId: canonicalCandidateProfileIdSchema,
        rulesVersion: z.number().finite().int().positive().refine(Number.isSafeInteger),
        rulesChecksum: z.string().regex(/^[0-9a-f]{64}$/u, "must be a lowercase SHA-256 digest"),
      }),
    )
    .max(maximumCanonicalCandidateProfileSensitivityRuleCount)
    .refine(
      (rules) =>
        new Set(rules.map((rule) => JSON.stringify([rule.storeId, rule.knowledgeBaseId]))).size ===
        rules.length,
      "must have one entry per knowledge base",
    ),
});

const canonicalCandidateProfileEvidenceKindsSchema = z
  .array(
    z.strictObject({
      storeId: canonicalCandidateProfileIdSchema,
      knowledgeBaseId: canonicalCandidateProfileIdSchema,
      sourceId: canonicalCandidateProfileIdSchema,
      versionId: canonicalCandidateProfileIdSchema,
      kind: z.enum(candidateEvidenceKinds),
    }),
  )
  .max(maximumCanonicalCandidateProfileEvidenceKindCount)
  .refine(
    (entries) =>
      new Set(
        entries.map((entry) =>
          JSON.stringify([entry.storeId, entry.knowledgeBaseId, entry.sourceId, entry.versionId]),
        ),
      ).size === entries.length,
    "must have one entry per source version",
  );

/**
 * Which model and prompt extracted a profile version. Optional on the profile so versions
 * persisted before it was recorded keep parsing.
 */
export const canonicalCandidateProfileExtractionIdentitySchema = z.strictObject({
  company: canonicalCandidateProfileExtractionTextSchema,
  modelId: canonicalCandidateProfileExtractionTextSchema,
  promptTemplateVersion: canonicalCandidateProfileExtractionTextSchema,
  extractionProfile: z
    .strictObject({
      id: canonicalCandidateProfileExtractionTextSchema,
      version: z.number().finite().int().positive(),
    })
    .optional(),
  sensitivity: canonicalCandidateProfileSensitivityIdentitySchema.optional(),
  evidenceKinds: canonicalCandidateProfileEvidenceKindsSchema.optional(),
});
export type CanonicalCandidateProfileExtractionIdentity = z.infer<
  typeof canonicalCandidateProfileExtractionIdentitySchema
>;

const canonicalCandidateProfileVersionSchema = z
  .number()
  .finite()
  .int()
  .positive()
  .refine(Number.isSafeInteger, "must be a safe integer");

/**
 * Strict persisted profile shape. The transform delegates cross-field
 * provenance, lineage, review, and canonical-order checks to the framework-
 * free domain boundary and returns the deeply immutable representation.
 */
export const canonicalCandidateProfileSchema = z
  .strictObject({
    schemaVersion: z
      .literal(canonicalCandidateProfileSchemaVersion)
      .default(canonicalCandidateProfileSchemaVersion),
    id: canonicalCandidateProfileIdSchema,
    version: canonicalCandidateProfileVersionSchema,
    parentVersion: canonicalCandidateProfileVersionSchema.nullable(),
    status: canonicalCandidateProfileStatusSchema,
    createdAt: strictTimestampSchema,
    updatedAt: strictTimestampSchema,
    reviewedAt: strictTimestampSchema.optional(),
    candidateKnowledgeSelection: canonicalCandidateProfileSelectionSchema.optional(),
    extraction: canonicalCandidateProfileExtractionIdentitySchema.optional(),
    facts: z
      .array(canonicalCandidateProfileFactSchema)
      .max(maximumCanonicalCandidateProfileFactCount),
    issues: z
      .array(canonicalCandidateProfileIssueSchema)
      .max(maximumCanonicalCandidateProfileIssueCount)
      .default([]),
  })
  .transform((profile) =>
    createCanonicalCandidateProfile(profile as unknown as CanonicalCandidateProfileDomainInput),
  );

export type CanonicalCandidateProfileSchemaInput = z.input<typeof canonicalCandidateProfileSchema>;
export type CanonicalCandidateProfileSchemaOutput = z.output<
  typeof canonicalCandidateProfileSchema
>;
export type CanonicalCandidateProfile = CanonicalCandidateProfileSchemaOutput;
export type CanonicalCandidateProfileInput = CanonicalCandidateProfileSchemaInput;

/** Serialize a validated profile without exposing a separate persistence shape. */
export function serializeCanonicalCandidateProfile(profile: unknown): string {
  return JSON.stringify(canonicalCandidateProfileSchema.parse(profile));
}

/** Reload a canonical profile through the same strict, immutable boundary. */
export function parseCanonicalCandidateProfile(
  serialized: string,
): CanonicalCandidateProfileSchemaOutput {
  return canonicalCandidateProfileSchema.parse(JSON.parse(serialized));
}
