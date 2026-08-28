import type {
  ApplicationReadinessStoppingDecisionStopReason,
  CandidateKnowledgeSelectionSnapshotInput,
  CanonicalCandidateProfileInput as CanonicalCandidateProfileDomainInput,
  RenderingLayoutProfileId,
  RenderingQaLimitationCode,
} from "@draft-loop/domain";
import {
  adjudicatedRevisionEffectStatuses,
  adjudicatedRevisionTraceSchemaVersion,
  applicationReadinessStoppingDecisionBlockerCodes,
  applicationReadinessStoppingDecisionLimitationCodes,
  applicationReadinessStoppingDecisionSchemaVersion,
  applicationReadinessStoppingDecisionStopReasons,
  authorAdjudicationDispositions,
  authorAdjudicationEffectRequirements,
  authorAdjudicationPlanSchemaVersion,
  candidateKnowledgeBaseStates,
  candidateKnowledgeRetentionClasses,
  candidateKnowledgeRetentionOverrideKinds,
  candidateKnowledgeRetentionRules,
  candidateKnowledgeSelectionLifecycleObservationStatuses,
  candidateKnowledgeSelectionSnapshotSchemaVersion,
  candidateKnowledgeSourceKinds,
  candidateKnowledgeSourceRetirementReasons,
  candidateKnowledgeStoreSchemaVersion,
  canonicalCandidateProfileExtractionSchemaVersion,
  canonicalCandidateProfileFactCategories,
  canonicalCandidateProfileIssueCodes,
  canonicalCandidateProfileIssueSeverities,
  canonicalCandidateProfileIssueStatuses,
  canonicalCandidateProfileProvenanceKinds,
  canonicalCandidateProfileSchemaVersion,
  canonicalCandidateProfileStatuses,
  contextSchemaVersion,
  createCandidateKnowledgeSelectionSnapshot,
  createCanonicalCandidateProfile,
  deriveModelLineage,
  independentReadinessReportFindingOrigins,
  independentReadinessReportInputAssessmentStatuses,
  independentReadinessReportSchemaVersion,
  independentReadinessReportTargetKinds,
  maximumCanonicalCandidateProfileFactCount,
  maximumCanonicalCandidateProfileFactIdLength,
  maximumCanonicalCandidateProfileFieldLength,
  maximumCanonicalCandidateProfileIdLength,
  maximumCanonicalCandidateProfileIssueCount,
  maximumCanonicalCandidateProfileIssueFactReferenceCount,
  maximumCanonicalCandidateProfileIssueMessageLength,
  maximumCanonicalCandidateProfileIssueSourceReferenceCount,
  maximumCanonicalCandidateProfileProvenanceCount,
  maximumCanonicalCandidateProfileSubjectIdLength,
  maximumCanonicalCandidateProfileValueLength,
  maximumIndependenceOverrideRationaleLength,
  maximumModelLineageLength,
  maximumWritingPolicyCharactersLength,
  maximumWritingPolicyPreferenceListEntries,
  maximumWritingPolicyPreferenceNameLength,
  maximumWritingPolicyRules,
  maximumWritingPolicySpellingLocaleLength,
  maximumWritingPolicyTermLength,
  normalizeWritingPolicySpellingLocale,
  opportunityBriefIssueCodes,
  opportunityBriefIssueSeverities,
  opportunityBriefIssueStatuses,
  opportunityBriefMaximumCollectionEntries,
  opportunityBriefMaximumIdLength,
  opportunityBriefMaximumMessageLength,
  opportunityBriefMaximumSourceCount,
  opportunityBriefMaximumSourceIds,
  opportunityBriefMaximumTextLength,
  opportunityBriefProvenanceKinds,
  opportunityBriefSchemaVersion,
  opportunityBriefSourceClassifications,
  opportunityBriefSourceStatuses,
  opportunityBriefStatuses,
  opportunityExtractionContradictionFields,
  opportunityExtractionSchemaVersion,
  outputFormats,
  readinessDimensionAgreementStatuses,
  readinessDimensions,
  renderingLayoutProfileIds,
  renderingQaActiveContentSignatures,
  renderingQaLimitationCodes,
  renderingQaReportSchemaVersion,
  renderingQaVisibleContentOrderSignals,
  requirementPriorities,
  writingPolicyPageTargets,
  writingPolicyRuleIdPattern,
  writingPolicyRuleKinds,
  writingPolicySchemaVersion,
  writingPolicySpellingLocalePattern,
  writingPolicyTones,
  writingPolicyVerbosityLevels,
} from "@draft-loop/domain";
import { z } from "zod";

export type { RenderingLayoutProfileId } from "@draft-loop/domain";

const nonEmptyString = z.string().trim().min(1, "must not be empty");

const checksumSchema = z
  .string()
  .regex(
    /^(?:[a-f0-9]{40}|[a-f0-9]{64}|[a-f0-9]{128}|sha1:[a-f0-9]{40}|sha256:[a-f0-9]{64}|sha512:[a-f0-9]{128})$/i,
    "must be a SHA-1, SHA-256, or SHA-512 checksum",
  );

const sha256ChecksumSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/iu, "must be a SHA-256 checksum")
  .transform((value) => value.toLowerCase());

const timestampSchema = nonEmptyString.refine(
  (value) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value)),
  "must be a valid ISO timestamp",
);

const strictTimestampSchema = z
  .string()
  .refine(
    (value) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
      !Number.isNaN(Date.parse(value)),
    "must be a valid ISO timestamp",
  );

export const workspaceInputSchema = z.object({
  jobDescription: nonEmptyString,
  language: nonEmptyString,
  instructions: z.string().default(""),
  truthfulnessPolicy: z.string().default("Do not add unsupported claims."),
});

export type WorkspaceInput = z.infer<typeof workspaceInputSchema>;

export const readinessRubricSchema = z.object({
  relevance: z.number().finite().min(0).max(1),
  evidence: z.number().finite().min(0).max(1),
  accuracy: z.number().finite().min(0).max(1),
  differentiation: z.number().finite().min(0).max(1),
  clarity: z.number().finite().min(0).max(1),
  format: z.number().finite().min(0).max(1),
  credibility: z.number().finite().min(0).max(1),
});

export type ReadinessRubric = z.infer<typeof readinessRubricSchema>;

export const jobRequirementSchema = z.object({
  id: nonEmptyString,
  text: nonEmptyString,
  priority: z.enum(requirementPriorities),
});

export type JobRequirement = z.infer<typeof jobRequirementSchema>;

export const jobRequirementInputSchema = z
  .object({
    id: nonEmptyString,
    text: nonEmptyString.optional(),
    description: nonEmptyString.optional(),
    priority: z.enum(requirementPriorities),
  })
  .refine((value) => value.text !== undefined || value.description !== undefined, {
    message: "text or description is required",
    path: ["text"],
  })
  .transform(({ description, text, ...requirement }) => ({
    ...requirement,
    text: text ?? description ?? "",
  }));

export type JobRequirementInput = z.input<typeof jobRequirementInputSchema>;

const opportunityBriefNonEmptyString = z.string().trim().min(1, "must not be empty");
const opportunityBriefIdSchema = opportunityBriefNonEmptyString.max(
  opportunityBriefMaximumIdLength,
);
const opportunityBriefTextSchema = opportunityBriefNonEmptyString.max(
  opportunityBriefMaximumTextLength,
);
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

const opportunityBriefSourceIdsSchema = z
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

const opportunityBriefApprovedUrlProvenanceSchema = z.strictObject({
  kind: z.literal("approved-url"),
  originalUrl: opportunityBriefUrlSchema,
  finalUrl: opportunityBriefUrlSchema.optional(),
  capturedAt: strictTimestampSchema,
  contentChecksum: opportunityBriefChecksumSchema.nullable(),
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

export const opportunityBriefStatusSchema = z.enum(opportunityBriefStatuses);
export const opportunityBriefSourceClassificationSchema = z.enum(
  opportunityBriefSourceClassifications,
);
export const opportunityBriefProvenanceKindSchema = z.enum(opportunityBriefProvenanceKinds);
export const opportunityBriefSourceStatusSchema = z.enum(opportunityBriefSourceStatuses);
export const opportunityBriefIssueCodeSchema = z.enum(opportunityBriefIssueCodes);
export const opportunityBriefIssueStatusSchema = z.enum(opportunityBriefIssueStatuses);
export const opportunityBriefIssueSeveritySchema = z.enum(opportunityBriefIssueSeverities);

export const opportunityBriefProvenanceSchema = z.discriminatedUnion("kind", [
  opportunityBriefApprovedUrlProvenanceSchema,
  opportunityBriefLocalFileProvenanceSchema,
  opportunityBriefPastedContentProvenanceSchema,
  opportunityBriefCandidateInputProvenanceSchema,
]);
export type OpportunityBriefProvenance = z.infer<typeof opportunityBriefProvenanceSchema>;

export const opportunityBriefSourceSchema = z
  .strictObject({
    id: opportunityBriefIdSchema,
    classification: opportunityBriefSourceClassificationSchema,
    status: opportunityBriefSourceStatusSchema,
    provenance: opportunityBriefProvenanceSchema,
  })
  .superRefine((source, context) => {
    const checksumField =
      source.provenance.kind === "approved-url" ? "contentChecksum" : "checksum";
    const checksum =
      source.provenance.kind === "approved-url"
        ? source.provenance.contentChecksum
        : source.provenance.checksum;
    const requiresChecksum = ["available", "partial", "stale"].includes(source.status);
    if (requiresChecksum && checksum === null) {
      context.addIssue({
        code: "custom",
        path: ["provenance", checksumField],
        message: `${source.status} sources require a captured content checksum`,
      });
    }
    if (!requiresChecksum && checksum !== null) {
      context.addIssue({
        code: "custom",
        path: ["provenance", checksumField],
        message: `${source.status} sources must not claim a captured content checksum`,
      });
    }
  });
export type OpportunityBriefSource = z.infer<typeof opportunityBriefSourceSchema>;

export const opportunityBriefSourcedTextSchema = z.strictObject({
  value: opportunityBriefTextSchema,
  sourceIds: opportunityBriefSourceIdsSchema,
});
export type OpportunityBriefSourcedText = z.infer<typeof opportunityBriefSourcedTextSchema>;

export const opportunityBriefResponsibilitySchema = z.strictObject({
  id: opportunityBriefIdSchema,
  text: opportunityBriefTextSchema,
  sourceIds: opportunityBriefSourceIdsSchema,
});
export type OpportunityBriefResponsibility = z.infer<typeof opportunityBriefResponsibilitySchema>;

export const opportunityBriefRequirementSchema = z.strictObject({
  id: opportunityBriefIdSchema,
  text: opportunityBriefTextSchema,
  priority: z.enum(requirementPriorities),
  sourceIds: opportunityBriefSourceIdsSchema,
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

const opportunityBriefCollectionSchema = <T extends z.ZodType>(schema: T) =>
  z.array(schema).max(opportunityBriefMaximumCollectionEntries);

function addOpportunityBriefDuplicateIdIssues(
  values: readonly { readonly id: string }[],
  field: string,
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value.id)) {
      context.addIssue({
        code: "custom",
        path: [field, index, "id"],
        message: `${field} ids must be unique`,
      });
    }
    seen.add(value.id);
  }
}

function addOpportunityBriefSourceReferenceIssues(
  references: readonly string[],
  path: readonly PropertyKey[],
  sourcesById: ReadonlyMap<string, OpportunityBriefSource>,
  context: z.RefinementCtx,
  mode: "any" | "extracted" | "candidate-instruction",
): void {
  for (const [index, sourceId] of references.entries()) {
    const source = sourcesById.get(sourceId);
    const referencePath = [...path, "sourceIds", index];
    if (source === undefined) {
      context.addIssue({
        code: "custom",
        path: referencePath,
        message: "sourceId must resolve to a source",
      });
      continue;
    }
    const isCandidateInstruction = source.classification === "candidate-instruction";
    if (
      mode !== "any" &&
      ((mode === "extracted" && isCandidateInstruction) ||
        (mode === "candidate-instruction" && !isCandidateInstruction))
    ) {
      context.addIssue({
        code: "custom",
        path: referencePath,
        message:
          mode === "extracted"
            ? "extracted opportunity facts must not cite candidate-instruction sources"
            : "candidate instruction fields must cite candidate-instruction sources",
      });
    }
  }
}

function addOpportunityBriefCandidateInstructionReferences(
  value: OpportunityBriefSourcedText | null,
  path: readonly PropertyKey[],
  sourcesById: ReadonlyMap<string, OpportunityBriefSource>,
  context: z.RefinementCtx,
): void {
  if (value !== null) {
    addOpportunityBriefSourceReferenceIssues(
      value.sourceIds,
      path,
      sourcesById,
      context,
      "candidate-instruction",
    );
  }
}

export const opportunityBriefSchema = z
  .strictObject({
    schemaVersion: z.literal(opportunityBriefSchemaVersion),
    id: opportunityBriefIdSchema,
    version: z
      .number()
      .finite()
      .int()
      .positive()
      .refine(Number.isSafeInteger, "must be a safe integer"),
    priorVersion: z.number().finite().int().positive().nullable(),
    status: opportunityBriefStatusSchema,
    createdAt: strictTimestampSchema,
    reviewedAt: strictTimestampSchema.nullable(),
    sources: z.array(opportunityBriefSourceSchema).min(1).max(opportunityBriefMaximumSourceCount),
    role: opportunityBriefSourcedTextSchema.nullable(),
    employer: opportunityBriefSourcedTextSchema.nullable(),
    responsibilities: opportunityBriefCollectionSchema(opportunityBriefResponsibilitySchema),
    requirements: opportunityBriefCollectionSchema(opportunityBriefRequirementSchema),
    priorities: opportunityBriefCollectionSchema(opportunityBriefPrioritySchema),
    candidateInstructions: opportunityBriefCandidateInstructionsSchema,
    issues: opportunityBriefCollectionSchema(opportunityBriefIssueSchema),
  })
  .superRefine((brief, context) => {
    if (brief.version === 1 && brief.priorVersion !== null) {
      context.addIssue({
        code: "custom",
        path: ["priorVersion"],
        message: "version 1 opportunity briefs must have priorVersion null",
      });
    }
    if (brief.version > 1 && brief.priorVersion !== brief.version - 1) {
      context.addIssue({
        code: "custom",
        path: ["priorVersion"],
        message: "opportunity brief priorVersion must immediately precede version",
      });
    }
    if (brief.status === "draft" && brief.reviewedAt !== null) {
      context.addIssue({
        code: "custom",
        path: ["reviewedAt"],
        message: "draft opportunity briefs must have reviewedAt null",
      });
    }
    if (brief.status === "reviewed") {
      if (brief.reviewedAt === null) {
        context.addIssue({
          code: "custom",
          path: ["reviewedAt"],
          message: "reviewed opportunity briefs require reviewedAt",
        });
      } else if (Date.parse(brief.reviewedAt) < Date.parse(brief.createdAt)) {
        context.addIssue({
          code: "custom",
          path: ["reviewedAt"],
          message: "reviewedAt must not precede createdAt",
        });
      }
      if (brief.role === null) {
        context.addIssue({
          code: "custom",
          path: ["role"],
          message: "reviewed opportunity briefs require a role",
        });
      }
      if (brief.employer === null) {
        context.addIssue({
          code: "custom",
          path: ["employer"],
          message: "reviewed opportunity briefs require an employer",
        });
      }
      if (brief.requirements.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["requirements"],
          message: "reviewed opportunity briefs require at least one requirement",
        });
      }
      if (brief.issues.some((issue) => issue.status === "open")) {
        context.addIssue({
          code: "custom",
          path: ["issues"],
          message: "reviewed opportunity briefs must not contain open issues",
        });
      }
    }

    addOpportunityBriefDuplicateIdIssues(brief.sources, "sources", context);
    addOpportunityBriefDuplicateIdIssues(brief.responsibilities, "responsibilities", context);
    addOpportunityBriefDuplicateIdIssues(brief.requirements, "requirements", context);
    addOpportunityBriefDuplicateIdIssues(brief.priorities, "priorities", context);
    addOpportunityBriefDuplicateIdIssues(brief.issues, "issues", context);

    const sourcesById = new Map(brief.sources.map((source) => [source.id, source] as const));
    const extractedReferences: Array<{
      readonly value: OpportunityBriefSourcedText;
      readonly path: readonly PropertyKey[];
    }> = [];
    if (brief.role !== null) extractedReferences.push({ value: brief.role, path: ["role"] });
    if (brief.employer !== null) {
      extractedReferences.push({ value: brief.employer, path: ["employer"] });
    }
    for (const [index, responsibility] of brief.responsibilities.entries()) {
      extractedReferences.push({
        value: { value: responsibility.text, sourceIds: responsibility.sourceIds },
        path: ["responsibilities", index],
      });
    }
    for (const [index, requirement] of brief.requirements.entries()) {
      extractedReferences.push({
        value: { value: requirement.text, sourceIds: requirement.sourceIds },
        path: ["requirements", index],
      });
    }
    for (const [index, priority] of brief.priorities.entries()) {
      extractedReferences.push({
        value: { value: priority.text, sourceIds: priority.sourceIds },
        path: ["priorities", index],
      });
    }
    for (const reference of extractedReferences) {
      addOpportunityBriefSourceReferenceIssues(
        reference.value.sourceIds,
        reference.path,
        sourcesById,
        context,
        "extracted",
      );
    }

    addOpportunityBriefCandidateInstructionReferences(
      brief.candidateInstructions.tone,
      ["candidateInstructions", "tone"],
      sourcesById,
      context,
    );
    addOpportunityBriefCandidateInstructionReferences(
      brief.candidateInstructions.applicationGoal,
      ["candidateInstructions", "applicationGoal"],
      sourcesById,
      context,
    );
    for (const [field, values] of [
      ["forbiddenLanguage", brief.candidateInstructions.forbiddenLanguage],
      ["focusAreas", brief.candidateInstructions.focusAreas],
    ] as const) {
      for (const [index, value] of values.entries()) {
        addOpportunityBriefCandidateInstructionReferences(
          value,
          ["candidateInstructions", field, index],
          sourcesById,
          context,
        );
      }
    }
    for (const [index, issue] of brief.issues.entries()) {
      addOpportunityBriefSourceReferenceIssues(
        issue.sourceIds,
        ["issues", index],
        sourcesById,
        context,
        "any",
      );
    }

    const requiredIssueCodeBySourceStatus: Partial<
      Record<
        (typeof opportunityBriefSourceStatuses)[number],
        (typeof opportunityBriefIssueCodes)[number]
      >
    > = {
      inaccessible: "inaccessible-source",
      unsupported: "unsupported-source",
      failed: "fetch-failure",
      partial: "partial-fetch",
      stale: "stale-source",
    };
    for (const [index, source] of brief.sources.entries()) {
      const requiredCode = requiredIssueCodeBySourceStatus[source.status];
      if (
        requiredCode !== undefined &&
        !brief.issues.some(
          (issue) => issue.code === requiredCode && issue.sourceIds.includes(source.id),
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["sources", index, "status"],
          message: `source status ${source.status} requires a ${requiredCode} issue referencing the source`,
        });
      }
    }
  });

export type OpportunityBrief = z.infer<typeof opportunityBriefSchema>;
export type OpportunityBriefInput = z.input<typeof opportunityBriefSchema>;

const opportunityExtractionSourcedTextSchema = z.strictObject({
  value: opportunityBriefTextSchema,
  sourceIds: opportunityBriefSourceIdsSchema,
});

const opportunityExtractionResponsibilitySchema = z.strictObject({
  text: opportunityBriefTextSchema,
  sourceIds: opportunityBriefSourceIdsSchema,
});

const opportunityExtractionRequirementSchema = z.strictObject({
  text: opportunityBriefTextSchema,
  priority: z.enum(requirementPriorities),
  sourceIds: opportunityBriefSourceIdsSchema,
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

export const evidenceSourceSchema = z.object({
  id: nonEmptyString,
  path: nonEmptyString,
  mediaType: nonEmptyString,
  checksum: checksumSchema,
  profileId: nonEmptyString.optional(),
});

export type EvidenceSource = z.infer<typeof evidenceSourceSchema>;

const writingPolicyRuleIdSchema = nonEmptyString.regex(
  writingPolicyRuleIdPattern,
  "must be an opaque compiler rule id",
);

const writingPolicyForbiddenTermRuleSchema = z.strictObject({
  id: writingPolicyRuleIdSchema,
  kind: z.literal("forbidden-term"),
  term: nonEmptyString.max(maximumWritingPolicyTermLength),
  caseSensitive: z.boolean(),
  wholeWord: z.boolean(),
});

const writingPolicyForbiddenCharactersSchema = z
  .string()
  .min(1, "must not be empty")
  .refine(
    (value) => [...value].length <= maximumWritingPolicyCharactersLength,
    `must contain at most ${maximumWritingPolicyCharactersLength} characters`,
  )
  .refine((value) => {
    const characters = [...value];
    return (
      new Set(characters).size === characters.length &&
      characters.every((character) => !/[\p{L}\p{N}\s]/u.test(character))
    );
  }, "must contain unique non-alphanumeric, non-whitespace characters");

const writingPolicyForbiddenCharactersRuleSchema = z.strictObject({
  id: writingPolicyRuleIdSchema,
  kind: z.literal("forbidden-characters"),
  characters: writingPolicyForbiddenCharactersSchema,
});

export const writingPolicyRuleKindSchema = z.enum(writingPolicyRuleKinds);

export const writingPolicyRuleSchema = z.discriminatedUnion("kind", [
  writingPolicyForbiddenTermRuleSchema,
  writingPolicyForbiddenCharactersRuleSchema,
]);

export const writingPolicyRulesSchema = z
  .array(writingPolicyRuleSchema)
  .max(maximumWritingPolicyRules)
  .superRefine((rules, context) => {
    const ids = new Set<string>();
    for (const [index, rule] of rules.entries()) {
      if (ids.has(rule.id)) {
        context.addIssue({
          code: "custom",
          path: [index, "id"],
          message: "rule ids must be unique",
        });
      }
      ids.add(rule.id);
    }
  });

export const writingPolicyToneSchema = z
  .string()
  .trim()
  .refine(
    (value) =>
      writingPolicyTones.includes(value.toLowerCase() as (typeof writingPolicyTones)[number]),
    "must be a supported writing policy tone",
  )
  .transform((value) => value.toLowerCase() as (typeof writingPolicyTones)[number]);

export const writingPolicySpellingLocaleSchema = z
  .string()
  .trim()
  .min(1, "must not be empty")
  .max(maximumWritingPolicySpellingLocaleLength)
  .refine(
    (value) => writingPolicySpellingLocalePattern.test(value),
    "must be a bounded BCP-47-shaped spelling locale",
  )
  .transform(normalizeWritingPolicySpellingLocale);

export const writingPolicyVerbositySchema = z
  .string()
  .trim()
  .refine(
    (value) =>
      writingPolicyVerbosityLevels.includes(
        value.toLowerCase() as (typeof writingPolicyVerbosityLevels)[number],
      ),
    "must be a supported writing policy verbosity",
  )
  .transform((value) => value.toLowerCase() as (typeof writingPolicyVerbosityLevels)[number]);

export const writingPolicyPageTargetSchema = z
  .string()
  .trim()
  .refine(
    (value) =>
      writingPolicyPageTargets.includes(
        value.toLowerCase() as (typeof writingPolicyPageTargets)[number],
      ),
    "must be one-page or two-page",
  )
  .transform((value) => value.toLowerCase() as (typeof writingPolicyPageTargets)[number]);

const writingPolicyPreferenceNameSchema = nonEmptyString
  .max(maximumWritingPolicyPreferenceNameLength)
  .transform((value) => value.replace(/\s+/gu, " "));

function normalizedWritingPolicyPreferenceName(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

const writingPolicyPreferenceNamesSchema = (label: string) =>
  z
    .array(writingPolicyPreferenceNameSchema)
    .min(1, `must contain at least one ${label}`)
    .max(
      maximumWritingPolicyPreferenceListEntries,
      `must contain at most ${maximumWritingPolicyPreferenceListEntries} entries`,
    )
    .superRefine((values, context) => {
      const seen = new Set<string>();
      for (const [index, value] of values.entries()) {
        const identity = normalizedWritingPolicyPreferenceName(value);
        if (seen.has(identity)) {
          context.addIssue({
            code: "custom",
            path: [index],
            message: `${label} must be unique`,
          });
        }
        seen.add(identity);
      }
    });

const writingPolicyIdentitySchema = z.strictObject({
  version: nonEmptyString,
  checksum: sha256ChecksumSchema,
});

export const writingPolicyLineageSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("workspace") }),
  z.strictObject({
    kind: z.literal("opportunity-override"),
    base: writingPolicyIdentitySchema,
    override: writingPolicyIdentitySchema,
  }),
]);

export const writingPolicyPreferencesSchema = z.strictObject({
  tone: writingPolicyToneSchema.optional(),
  spellingLocale: writingPolicySpellingLocaleSchema.optional(),
  verbosity: writingPolicyVerbositySchema.optional(),
  pageTarget: writingPolicyPageTargetSchema.optional(),
  sectionOrder: writingPolicyPreferenceNamesSchema("section names").optional(),
  emphasisAreas: writingPolicyPreferenceNamesSchema("emphasis areas").optional(),
});

export const writingPolicySchema = z
  .strictObject({
    schemaVersion: z
      .literal(writingPolicySchemaVersion)
      .optional()
      .default(writingPolicySchemaVersion),
    content: nonEmptyString,
    checksum: z.string().regex(/^[a-f0-9]{64}$/iu, "must be a SHA-256 checksum"),
    version: nonEmptyString,
    rules: writingPolicyRulesSchema.optional(),
    preferences: writingPolicyPreferencesSchema.optional(),
    lineage: writingPolicyLineageSchema.optional(),
  })
  .superRefine((policy, context) => {
    if (policy.lineage?.kind !== "opportunity-override") return;
    if (policy.lineage.base.checksum === policy.lineage.override.checksum) {
      context.addIssue({
        code: "custom",
        path: ["lineage", "override", "checksum"],
        message: "must differ from the immutable base policy checksum",
      });
    }
    if (policy.lineage.override.version !== policy.version) {
      context.addIssue({
        code: "custom",
        path: ["lineage", "override", "version"],
        message: "must match the current policy version",
      });
    }
    if (policy.lineage.override.checksum !== policy.checksum.toLowerCase()) {
      context.addIssue({
        code: "custom",
        path: ["lineage", "override", "checksum"],
        message: "must match the current policy checksum",
      });
    }
  });

export type WritingPolicyRule = z.infer<typeof writingPolicyRuleSchema>;
export type WritingPolicyPreferences = z.infer<typeof writingPolicyPreferencesSchema>;
export type WritingPolicy = z.infer<typeof writingPolicySchema>;
export type WritingPolicyInput = z.input<typeof writingPolicySchema>;

export const candidateProfileSchema = z.object({
  id: nonEmptyString,
  name: nonEmptyString,
  description: z.string().default(""),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type CandidateProfile = z.infer<typeof candidateProfileSchema>;

export const candidateKnowledgeStoreSchema = z.object({
  schemaVersion: z.literal(candidateKnowledgeStoreSchemaVersion),
  id: nonEmptyString,
  createdAt: z
    .string()
    .refine(
      (value) =>
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
        !Number.isNaN(Date.parse(value)),
      "must be a valid ISO timestamp",
    ),
});

export type CandidateKnowledgeStore = z.infer<typeof candidateKnowledgeStoreSchema>;

export const candidateKnowledgeBaseStateSchema = z.enum(candidateKnowledgeBaseStates);
export type CandidateKnowledgeBaseState = z.infer<typeof candidateKnowledgeBaseStateSchema>;

export const candidateKnowledgeBaseSchema = z
  .object({
    id: nonEmptyString,
    displayName: nonEmptyString,
    description: z.string().trim().default(""),
    isDefault: z.boolean().default(false),
    state: candidateKnowledgeBaseStateSchema.default("active"),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    archivedAt: timestampSchema.optional(),
  })
  .superRefine((knowledgeBase, context) => {
    if (Date.parse(knowledgeBase.updatedAt) < Date.parse(knowledgeBase.createdAt)) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "updatedAt must not precede createdAt",
      });
    }
    if (knowledgeBase.state === "active" && knowledgeBase.archivedAt !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["archivedAt"],
        message: "active candidate knowledge bases must not have archivedAt",
      });
    }
    if (knowledgeBase.state === "archived" && knowledgeBase.archivedAt === undefined) {
      context.addIssue({
        code: "custom",
        path: ["archivedAt"],
        message: "archived candidate knowledge bases require archivedAt",
      });
    }
    if (knowledgeBase.isDefault && knowledgeBase.state !== "active") {
      context.addIssue({
        code: "custom",
        path: ["state"],
        message: "the default candidate knowledge base must remain active",
      });
    }
    if (
      knowledgeBase.archivedAt !== undefined &&
      (Date.parse(knowledgeBase.archivedAt) < Date.parse(knowledgeBase.createdAt) ||
        Date.parse(knowledgeBase.archivedAt) > Date.parse(knowledgeBase.updatedAt))
    ) {
      context.addIssue({
        code: "custom",
        path: ["archivedAt"],
        message: "archivedAt must not precede createdAt or follow updatedAt",
      });
    }
  });

export type CandidateKnowledgeBase = z.infer<typeof candidateKnowledgeBaseSchema>;

export const candidateKnowledgeSourceKindSchema = z.enum(candidateKnowledgeSourceKinds);
export type CandidateKnowledgeSourceKind = z.infer<typeof candidateKnowledgeSourceKindSchema>;

export const candidateKnowledgeSourceSchema = z.object({
  id: nonEmptyString,
  knowledgeBaseId: nonEmptyString,
  kind: candidateKnowledgeSourceKindSchema,
  displayName: nonEmptyString,
  createdAt: strictTimestampSchema,
});

export type CandidateKnowledgeSource = z.infer<typeof candidateKnowledgeSourceSchema>;

export const candidateKnowledgeSourceRetirementReasonSchema = z.enum(
  candidateKnowledgeSourceRetirementReasons,
);
export type CandidateKnowledgeSourceRetirementReason = z.infer<
  typeof candidateKnowledgeSourceRetirementReasonSchema
>;

export const candidateKnowledgeSourceRetirementSchema = z.object({
  sourceId: nonEmptyString,
  retiredAt: strictTimestampSchema,
  reason: candidateKnowledgeSourceRetirementReasonSchema,
});
export type CandidateKnowledgeSourceRetirement = z.infer<
  typeof candidateKnowledgeSourceRetirementSchema
>;

export const candidateKnowledgeRetentionClassSchema = z.enum(candidateKnowledgeRetentionClasses);
export const candidateKnowledgeRetentionRuleSchema = z.enum(candidateKnowledgeRetentionRules);
export const candidateKnowledgeRetentionOverrideKindSchema = z.enum(
  candidateKnowledgeRetentionOverrideKinds,
);

export const candidateKnowledgeRetentionClassPolicySchema = z.discriminatedUnion("rule", [
  z
    .object({
      class: candidateKnowledgeRetentionClassSchema,
      rule: z.literal("retain-until-deletion"),
      expireAfterDays: z.null().optional(),
    })
    .strict(),
  z
    .object({
      class: candidateKnowledgeRetentionClassSchema,
      rule: z.literal("expire-after-days"),
      expireAfterDays: z.number().finite().int().positive().max(36_500),
    })
    .strict(),
]);

const exactRetentionClasses = z
  .array(candidateKnowledgeRetentionClassPolicySchema)
  .length(candidateKnowledgeRetentionClasses.length)
  .superRefine((classes, context) => {
    const values = classes.map((entry) => entry.class);
    if (
      new Set(values).size !== candidateKnowledgeRetentionClasses.length ||
      candidateKnowledgeRetentionClasses.some((value) => !values.includes(value))
    ) {
      context.addIssue({
        code: "custom",
        message: "each candidate knowledge retention class must appear exactly once",
      });
    }
  });

export const candidateKnowledgeRetentionPolicyUpdateSchema = z
  .object({
    expectedRevision: z.number().finite().int().nonnegative(),
    updatedAt: strictTimestampSchema,
    classes: exactRetentionClasses,
  })
  .strict();

export const candidateKnowledgeRetentionOverrideInputSchema = z
  .object({
    class: candidateKnowledgeRetentionClassSchema,
    kind: candidateKnowledgeRetentionOverrideKindSchema,
    expectedPolicyRevision: z.number().finite().int().nonnegative(),
    expectedState: z.enum(["none", "applied", "released"]),
    changedAt: strictTimestampSchema,
  })
  .strict();

export type CandidateKnowledgeRetentionClassPolicy = z.infer<
  typeof candidateKnowledgeRetentionClassPolicySchema
>;
export type CandidateKnowledgeRetentionPolicyUpdate = z.infer<
  typeof candidateKnowledgeRetentionPolicyUpdateSchema
>;
export type CandidateKnowledgeRetentionOverrideInput = z.infer<
  typeof candidateKnowledgeRetentionOverrideInputSchema
>;

export const candidateKnowledgeSourceVersionSchema = z
  .object({
    id: nonEmptyString,
    sourceId: nonEmptyString,
    version: z.number().finite().int().positive(),
    parentVersionId: nonEmptyString.optional(),
    mediaType: nonEmptyString,
    checksum: sha256ChecksumSchema,
    sizeBytes: z.number().finite().int().nonnegative(),
    createdAt: strictTimestampSchema,
  })
  .superRefine((sourceVersion, context) => {
    if (sourceVersion.version === 1 && sourceVersion.parentVersionId !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["parentVersionId"],
        message: "candidate knowledge source version 1 must not have a parent version",
      });
    }
    if (sourceVersion.version > 1 && sourceVersion.parentVersionId === undefined) {
      context.addIssue({
        code: "custom",
        path: ["parentVersionId"],
        message: "candidate knowledge source versions after version 1 require a parent version",
      });
    }
  });

export type CandidateKnowledgeSourceVersion = z.infer<typeof candidateKnowledgeSourceVersionSchema>;

export const candidateKnowledgePortableBackupFormat =
  "draft-loop-candidate-knowledge-backup" as const;
export const candidateKnowledgePortableBackupSchemaVersion = 1 as const;
export const candidateKnowledgePortableBackupIntegrityIndicator =
  "integrity-verified-not-authenticity" as const;
export const candidateKnowledgePortableBackupMaximumEntries = 1024 as const;
export const candidateKnowledgePortableBackupManifestFilename = "manifest.json" as const;
export const candidateKnowledgePortableBackupManifestChecksumFilename = "manifest.sha256" as const;
export const candidateKnowledgePortableBackupObjectsDirectory = "objects" as const;

const portableBackupObjectNameSchema = z
  .string()
  .regex(/^objects\/[a-f0-9]{64}\.bin$/u, "must be a safe portable backup object name");

const portableBackupStoreDescriptorSchema = z
  .object({
    schemaVersion: z.literal(candidateKnowledgeStoreSchemaVersion),
    id: nonEmptyString,
    createdAt: strictTimestampSchema,
  })
  .strict();

const portableBackupKnowledgeBaseSchema = z
  .object({
    id: nonEmptyString,
    displayName: nonEmptyString,
    description: z.string(),
    isDefault: z.boolean(),
    state: candidateKnowledgeBaseStateSchema,
    createdAt: strictTimestampSchema,
    updatedAt: strictTimestampSchema,
    archivedAt: strictTimestampSchema.nullable(),
  })
  .strict()
  .superRefine((knowledgeBase, context) => {
    if (Date.parse(knowledgeBase.updatedAt) < Date.parse(knowledgeBase.createdAt)) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "updatedAt must not precede createdAt",
      });
    }
    if (knowledgeBase.state === "active" && knowledgeBase.archivedAt !== null) {
      context.addIssue({
        code: "custom",
        path: ["archivedAt"],
        message: "active stores must not have archivedAt",
      });
    }
    if (knowledgeBase.state === "archived" && knowledgeBase.archivedAt === null) {
      context.addIssue({
        code: "custom",
        path: ["archivedAt"],
        message: "archived stores require archivedAt",
      });
    }
  });

const portableBackupUrlKindSchema = z.enum([
  "github",
  "certification",
  "profile",
  "portfolio",
  "job-description",
  "generic",
]);

const portableBackupUrlProvenanceSchema = z
  .object({
    fetchedAt: strictTimestampSchema,
    kind: portableBackupUrlKindSchema,
  })
  .strict();

const portableBackupRefreshObservationSchema = z
  .object({
    observedVersionId: nonEmptyString,
    status: z.enum(["current", "changed", "missing", "inaccessible", "unbound"]),
    checkedAt: strictTimestampSchema,
    lastRefreshedVersionId: nonEmptyString.nullable(),
    lastRefreshedAt: strictTimestampSchema.nullable(),
  })
  .strict();

const portableBackupRetirementSchema = z
  .object({
    retiredAt: strictTimestampSchema,
    reason: z.literal("user-requested"),
  })
  .strict();

const portableBackupSourceVersionSchema = z
  .object({
    id: nonEmptyString,
    sourceId: nonEmptyString,
    version: z.number().finite().int().positive(),
    parentVersionId: nonEmptyString.nullable(),
    mediaType: nonEmptyString,
    checksum: sha256ChecksumSchema,
    sizeBytes: z.number().finite().int().nonnegative(),
    createdAt: strictTimestampSchema,
    contentObject: portableBackupObjectNameSchema,
    urlProvenance: portableBackupUrlProvenanceSchema.optional(),
  })
  .strict()
  .superRefine((version, context) => {
    if (version.version === 1 && version.parentVersionId !== null) {
      context.addIssue({
        code: "custom",
        path: ["parentVersionId"],
        message: "version 1 must not have a parent version",
      });
    }
    if (version.version > 1 && version.parentVersionId === null) {
      context.addIssue({
        code: "custom",
        path: ["parentVersionId"],
        message: "versions after version 1 require a parent version",
      });
    }
  });

const portableBackupSourceSchema = z
  .object({
    id: nonEmptyString,
    knowledgeBaseId: nonEmptyString,
    kind: candidateKnowledgeSourceKindSchema,
    displayName: nonEmptyString,
    createdAt: strictTimestampSchema,
    versions: z
      .array(portableBackupSourceVersionSchema)
      .min(1)
      .max(candidateKnowledgePortableBackupMaximumEntries),
    refreshObservation: portableBackupRefreshObservationSchema.nullable(),
    retirement: portableBackupRetirementSchema.nullable(),
  })
  .strict()
  .superRefine((source, context) => {
    const versionIds = new Set<string>();
    const versionsById = new Map<string, (typeof source.versions)[number]>();
    let previousVersion = 0;
    for (const [index, version] of source.versions.entries()) {
      if (version.sourceId !== source.id) {
        context.addIssue({
          code: "custom",
          path: ["versions", index, "sourceId"],
          message: "version sourceId must match its source",
        });
      }
      if (versionIds.has(version.id)) {
        context.addIssue({
          code: "custom",
          path: ["versions", index, "id"],
          message: "version ids must be unique",
        });
      }
      versionIds.add(version.id);
      versionsById.set(version.id, version);
      if (Date.parse(version.createdAt) < Date.parse(source.createdAt)) {
        context.addIssue({
          code: "custom",
          path: ["versions", index, "createdAt"],
          message: "version createdAt must not precede its source",
        });
      }
      if (version.version !== previousVersion + 1) {
        context.addIssue({
          code: "custom",
          path: ["versions", index, "version"],
          message: "source versions must be contiguous",
        });
      }
      if (version.version > 1 && version.parentVersionId !== source.versions[index - 1]?.id) {
        context.addIssue({
          code: "custom",
          path: ["versions", index, "parentVersionId"],
          message: "source version parent must be the preceding version",
        });
      }
      const parentVersion = source.versions[index - 1];
      if (
        parentVersion !== undefined &&
        Date.parse(version.createdAt) < Date.parse(parentVersion.createdAt)
      ) {
        context.addIssue({
          code: "custom",
          path: ["versions", index, "createdAt"],
          message: "version createdAt must not precede its parent",
        });
      }
      if (version.urlProvenance !== undefined && source.kind !== "url") {
        context.addIssue({
          code: "custom",
          path: ["versions", index, "urlProvenance"],
          message: "URL provenance is only valid for URL sources",
        });
      }
      if (version.contentObject !== `objects/${version.checksum}.bin`) {
        context.addIssue({
          code: "custom",
          path: ["versions", index, "contentObject"],
          message: "version contentObject must be derived from its checksum",
        });
      }
      previousVersion = version.version;
    }
    const refresh = source.refreshObservation;
    if (refresh !== null) {
      const observedVersion = versionsById.get(refresh.observedVersionId);
      if (observedVersion === undefined) {
        context.addIssue({
          code: "custom",
          path: ["refreshObservation", "observedVersionId"],
          message: "refresh observedVersionId must refer to a source version",
        });
      } else if (Date.parse(refresh.checkedAt) < Date.parse(observedVersion.createdAt)) {
        context.addIssue({
          code: "custom",
          path: ["refreshObservation", "checkedAt"],
          message: "refresh checkedAt must not precede the observed version",
        });
      }
      if (Date.parse(refresh.checkedAt) < Date.parse(source.createdAt)) {
        context.addIssue({
          code: "custom",
          path: ["refreshObservation", "checkedAt"],
          message: "refresh checkedAt must not precede its source",
        });
      }
      if (refresh.lastRefreshedVersionId === null) {
        if (refresh.lastRefreshedAt !== null) {
          context.addIssue({
            code: "custom",
            path: ["refreshObservation", "lastRefreshedAt"],
            message: "lastRefreshedAt requires lastRefreshedVersionId",
          });
        }
      } else {
        const refreshedVersion = versionsById.get(refresh.lastRefreshedVersionId);
        if (refreshedVersion === undefined) {
          context.addIssue({
            code: "custom",
            path: ["refreshObservation", "lastRefreshedVersionId"],
            message: "lastRefreshedVersionId must refer to a source version",
          });
        }
        if (refresh.lastRefreshedAt === null) {
          context.addIssue({
            code: "custom",
            path: ["refreshObservation", "lastRefreshedAt"],
            message: "lastRefreshedVersionId requires lastRefreshedAt",
          });
        } else {
          if (
            refreshedVersion !== undefined &&
            Date.parse(refresh.lastRefreshedAt) < Date.parse(refreshedVersion.createdAt)
          ) {
            context.addIssue({
              code: "custom",
              path: ["refreshObservation", "lastRefreshedAt"],
              message: "lastRefreshedAt must not precede the refreshed version",
            });
          }
          if (Date.parse(refresh.lastRefreshedAt) > Date.parse(refresh.checkedAt)) {
            context.addIssue({
              code: "custom",
              path: ["refreshObservation", "lastRefreshedAt"],
              message: "lastRefreshedAt must not follow checkedAt",
            });
          }
        }
      }
    }
    if (source.retirement !== null) {
      const latestVersion = source.versions[source.versions.length - 1];
      if (
        Date.parse(source.retirement.retiredAt) < Date.parse(source.createdAt) ||
        (latestVersion !== undefined &&
          Date.parse(source.retirement.retiredAt) < Date.parse(latestVersion.createdAt))
      ) {
        context.addIssue({
          code: "custom",
          path: ["retirement", "retiredAt"],
          message: "retiredAt must not precede the source or its latest version",
        });
      }
    }
    if (
      source.kind === "url" &&
      source.versions.some((version) => version.urlProvenance === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["versions"],
        message: "URL sources require safe URL provenance for every version",
      });
    }
  });

const portableBackupRetentionOverrideSchema = z
  .object({
    class: candidateKnowledgeRetentionClassSchema,
    kind: candidateKnowledgeRetentionOverrideKindSchema,
    state: z.literal("applied").default("applied"),
    sequence: z.number().finite().int().positive(),
    overrideRevision: z.number().finite().int().nonnegative(),
    policyRevision: z.number().finite().int().nonnegative(),
    changedAt: strictTimestampSchema,
  })
  .strict();

const portableBackupRetentionPolicySchema = z
  .object({
    revision: z.number().finite().int().nonnegative(),
    overrideRevision: z.number().finite().int().nonnegative(),
    updatedAt: strictTimestampSchema,
    classes: exactRetentionClasses,
    activeOverrides: z
      .array(portableBackupRetentionOverrideSchema)
      .max(candidateKnowledgePortableBackupMaximumEntries),
  })
  .strict()
  .superRefine((policy, context) => {
    const overrides = new Set<string>();
    const overrideRevisions = new Set<number>();
    for (const [index, override] of policy.activeOverrides.entries()) {
      const key = `${override.class}\u0000${override.kind}`;
      if (overrides.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["activeOverrides", index],
          message: "active retention overrides must be unique by class and kind",
        });
      }
      overrides.add(key);
      if (overrideRevisions.has(override.overrideRevision)) {
        context.addIssue({
          code: "custom",
          path: ["activeOverrides", index, "overrideRevision"],
          message: "active override revisions must be unique",
        });
      }
      overrideRevisions.add(override.overrideRevision);
      if (override.overrideRevision === 0 || override.overrideRevision > policy.overrideRevision) {
        context.addIssue({
          code: "custom",
          path: ["activeOverrides", index, "overrideRevision"],
          message: "active override revision must be within the policy override revision",
        });
      }
      if (override.policyRevision > policy.revision) {
        context.addIssue({
          code: "custom",
          path: ["activeOverrides", index, "policyRevision"],
          message: "active override policy revision must be within the policy revision",
        });
      }
    }
  });

const portableBackupKnowledgeBaseEntrySchema = z
  .object({
    knowledgeBase: portableBackupKnowledgeBaseSchema,
    sources: z
      .array(portableBackupSourceSchema)
      .max(candidateKnowledgePortableBackupMaximumEntries),
    retentionPolicy: portableBackupRetentionPolicySchema,
  })
  .strict()
  .superRefine((entry, context) => {
    const sourceIds = new Set<string>();
    for (const [index, source] of entry.sources.entries()) {
      if (source.knowledgeBaseId !== entry.knowledgeBase.id) {
        context.addIssue({
          code: "custom",
          path: ["sources", index, "knowledgeBaseId"],
          message: "source knowledgeBaseId must match its knowledge base",
        });
      }
      if (sourceIds.has(source.id)) {
        context.addIssue({
          code: "custom",
          path: ["sources", index, "id"],
          message: "source ids must be unique within a knowledge base",
        });
      }
      sourceIds.add(source.id);
    }
  });

const portableBackupContentObjectSchema = z
  .object({
    name: portableBackupObjectNameSchema,
    checksum: sha256ChecksumSchema,
    sizeBytes: z.number().finite().int().nonnegative(),
  })
  .strict();

export const candidateKnowledgePortableBackupManifestSchema = z
  .object({
    format: z.literal(candidateKnowledgePortableBackupFormat),
    schemaVersion: z.literal(candidateKnowledgePortableBackupSchemaVersion),
    createdAt: strictTimestampSchema,
    descriptor: portableBackupStoreDescriptorSchema,
    knowledgeBases: z
      .array(portableBackupKnowledgeBaseEntrySchema)
      .max(candidateKnowledgePortableBackupMaximumEntries),
    contentObjects: z
      .array(portableBackupContentObjectSchema)
      .max(candidateKnowledgePortableBackupMaximumEntries),
  })
  .strict()
  .superRefine((manifest, context) => {
    const names = new Set<string>();
    const referencedObjectNames = new Set<string>();
    const objectsByName = new Map<string, (typeof manifest.contentObjects)[number]>();
    for (const [index, object] of manifest.contentObjects.entries()) {
      if (object.name !== `objects/${object.checksum}.bin`) {
        context.addIssue({
          code: "custom",
          path: ["contentObjects", index, "name"],
          message: "content object names must be derived from their checksum",
        });
      }
      if (names.has(object.name)) {
        context.addIssue({
          code: "custom",
          path: ["contentObjects", index, "name"],
          message: "content object names must be unique",
        });
      }
      names.add(object.name);
      objectsByName.set(object.name, object);
    }
    const versionIds = new Set<string>();
    const knowledgeBaseIds = new Set<string>();
    const sourceIds = new Set<string>();
    let defaultKnowledgeBaseCount = 0;
    for (const entry of manifest.knowledgeBases) {
      if (knowledgeBaseIds.has(entry.knowledgeBase.id)) {
        context.addIssue({
          code: "custom",
          path: ["knowledgeBases"],
          message: "knowledge base ids must be unique in a portable backup",
        });
      }
      knowledgeBaseIds.add(entry.knowledgeBase.id);
      if (entry.knowledgeBase.isDefault) defaultKnowledgeBaseCount += 1;
      for (const source of entry.sources) {
        if (sourceIds.has(source.id)) {
          context.addIssue({
            code: "custom",
            path: ["knowledgeBases"],
            message: "source ids must be unique in a portable backup",
          });
        }
        sourceIds.add(source.id);
        for (const version of source.versions) {
          if (versionIds.has(version.id)) {
            context.addIssue({
              code: "custom",
              path: ["knowledgeBases"],
              message: "source version ids must be unique in a portable backup",
            });
          }
          versionIds.add(version.id);
          referencedObjectNames.add(version.contentObject);
          if (!names.has(version.contentObject)) {
            context.addIssue({
              code: "custom",
              path: ["knowledgeBases"],
              message: "every source version must reference a declared content object",
            });
          } else {
            const object = objectsByName.get(version.contentObject);
            if (object?.checksum !== version.checksum || object.sizeBytes !== version.sizeBytes) {
              context.addIssue({
                code: "custom",
                path: ["knowledgeBases"],
                message: "source version integrity must match its content object",
              });
            }
          }
        }
      }
    }
    if (defaultKnowledgeBaseCount !== 1) {
      context.addIssue({
        code: "custom",
        path: ["knowledgeBases"],
        message: "a portable backup must contain exactly one default knowledge base",
      });
    }
    for (const object of manifest.contentObjects) {
      if (!referencedObjectNames.has(object.name)) {
        context.addIssue({
          code: "custom",
          path: ["contentObjects"],
          message: "every content object must be referenced by a source version",
        });
      }
    }
    if (Date.parse(manifest.createdAt) < Date.parse(manifest.descriptor.createdAt)) {
      context.addIssue({
        code: "custom",
        path: ["createdAt"],
        message: "backup createdAt must not precede its store descriptor",
      });
    }
  });

export type CandidateKnowledgePortableBackupManifest = z.output<
  typeof candidateKnowledgePortableBackupManifestSchema
>;

export const candidateKnowledgePortableBackupInspectionSchema = z
  .object({
    format: z.literal(candidateKnowledgePortableBackupFormat),
    schemaVersion: z.literal(candidateKnowledgePortableBackupSchemaVersion),
    status: z.enum(["valid", "exported"]),
    descriptorSchemaVersion: z.literal(candidateKnowledgeStoreSchemaVersion),
    storeId: nonEmptyString,
    createdAt: strictTimestampSchema,
    manifestChecksum: sha256ChecksumSchema,
    knowledgeBaseCount: z.number().finite().int().nonnegative(),
    sourceCount: z.number().finite().int().nonnegative(),
    versionCount: z.number().finite().int().nonnegative(),
    contentObjectCount: z.number().finite().int().nonnegative(),
    contentBytes: z.number().finite().int().nonnegative(),
    integrity: z.literal(candidateKnowledgePortableBackupIntegrityIndicator),
  })
  .strict();

export type CandidateKnowledgePortableBackupInspection = z.infer<
  typeof candidateKnowledgePortableBackupInspectionSchema
>;

export const candidateKnowledgePortableBackupRestoreCollisionModes = [
  "fail-if-destination-exists",
] as const;
export type CandidateKnowledgePortableBackupRestoreCollisionMode =
  (typeof candidateKnowledgePortableBackupRestoreCollisionModes)[number];

export const candidateKnowledgePortableBackupRestoreOptionsSchema = z
  .object({
    collision: z.literal("fail-if-destination-exists").default("fail-if-destination-exists"),
  })
  .strict();

export type CandidateKnowledgePortableBackupRestoreOptions = z.input<
  typeof candidateKnowledgePortableBackupRestoreOptionsSchema
>;

export const candidateKnowledgePortableBackupRestoreResultSchema = z
  .object({
    status: z.literal("restored"),
    format: z.literal(candidateKnowledgePortableBackupFormat),
    schemaVersion: z.literal(candidateKnowledgePortableBackupSchemaVersion),
    storeId: nonEmptyString,
    manifestChecksum: sha256ChecksumSchema,
    knowledgeBaseCount: z.number().finite().int().nonnegative(),
    sourceCount: z.number().finite().int().nonnegative(),
    versionCount: z.number().finite().int().nonnegative(),
    contentObjectCount: z.number().finite().int().nonnegative(),
    contentBytes: z.number().finite().int().nonnegative(),
    integrity: z.literal(candidateKnowledgePortableBackupIntegrityIndicator),
  })
  .strict();

export type CandidateKnowledgePortableBackupRestoreResult = z.infer<
  typeof candidateKnowledgePortableBackupRestoreResultSchema
>;

const candidateKnowledgeSelectionLifecycleObservationSchema = z.object({
  observedVersionId: nonEmptyString,
  status: z.enum(candidateKnowledgeSelectionLifecycleObservationStatuses),
  checkedAt: strictTimestampSchema,
  lastRefreshedVersionId: nonEmptyString.nullable(),
  lastRefreshedAt: strictTimestampSchema.nullable(),
  stale: z.boolean(),
});

const candidateKnowledgeSelectionLifecycleRetirementSchema = z.object({
  retiredAt: strictTimestampSchema,
  reason: z.literal("user-requested"),
});

const candidateKnowledgeSelectionLifecycleDirectorySchema = z.object({
  directoryId: nonEmptyString,
  rootRevision: z.number().finite().int().positive(),
  rootBoundAt: strictTimestampSchema,
  memberRevision: z.number().finite().int().positive(),
  memberBoundAt: strictTimestampSchema,
});

const candidateKnowledgeSelectionLifecycleRevisionSchema = z.object({
  knowledgeBaseState: candidateKnowledgeBaseStateSchema,
  knowledgeBaseArchivedAt: strictTimestampSchema.nullable(),
  versionId: nonEmptyString,
  version: z.number().finite().int().positive(),
  createdAt: strictTimestampSchema,
  managed: z.boolean(),
  originBoundAt: strictTimestampSchema.nullable(),
  observation: candidateKnowledgeSelectionLifecycleObservationSchema.nullable(),
  retirement: candidateKnowledgeSelectionLifecycleRetirementSchema.nullable(),
  provenanceFetchedAt: strictTimestampSchema.nullable(),
  directory: candidateKnowledgeSelectionLifecycleDirectorySchema.nullable(),
});

const candidateKnowledgeSelectionSnapshotSourceSchema = z.object({
  sourceId: nonEmptyString,
  versionId: nonEmptyString,
  lifecycleRevision: candidateKnowledgeSelectionLifecycleRevisionSchema,
});

const candidateKnowledgeSelectionSnapshotEntrySchema = z.object({
  storeId: nonEmptyString,
  knowledgeBaseId: nonEmptyString,
  sources: z.array(candidateKnowledgeSelectionSnapshotSourceSchema).min(1),
});

export const candidateKnowledgeSelectionSnapshotSchema = z
  .object({
    schemaVersion: z.literal(candidateKnowledgeSelectionSnapshotSchemaVersion).optional(),
    capturedAt: strictTimestampSchema,
    entries: z.array(candidateKnowledgeSelectionSnapshotEntrySchema).min(1),
  })
  .transform((snapshot) =>
    createCandidateKnowledgeSelectionSnapshot(
      snapshot as unknown as CandidateKnowledgeSelectionSnapshotInput,
    ),
  );

export type CandidateKnowledgeSelectionSnapshotSchemaInput = z.input<
  typeof candidateKnowledgeSelectionSnapshotSchema
>;
export type CandidateKnowledgeSelectionSnapshotSchemaOutput = z.output<
  typeof candidateKnowledgeSelectionSnapshotSchema
>;

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

export const canonicalCandidateProfileFactSchema = z.strictObject({
  id: canonicalCandidateProfileFactIdSchema,
  category: canonicalCandidateProfileFactCategorySchema,
  subjectId: canonicalCandidateProfileSubjectIdSchema.optional(),
  field: canonicalCandidateProfileFieldSchema,
  value: canonicalCandidateProfileValueSchema,
  provenance: z
    .array(canonicalCandidateProfileProvenanceReferenceSchema)
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

export const outputConstraintsSchema = z.object({
  format: z.enum(outputFormats).default("markdown"),
  maxWords: z.number().finite().int().positive().optional(),
  maxCharacters: z.number().finite().int().positive().optional(),
  maxLength: z.number().finite().int().positive().optional(),
  requiredSections: z.array(nonEmptyString).default([]),
  tone: nonEmptyString.optional(),
});

export type OutputConstraints = z.infer<typeof outputConstraintsSchema>;

export const modelSelectionSchema = z.object({
  company: nonEmptyString,
  modelId: nonEmptyString,
  role: z.enum(["author", "critic"]),
  promptTemplateVersion: nonEmptyString,
  /** Derived from company and model id when absent; see `deriveModelLineage`. */
  lineage: nonEmptyString.max(maximumModelLineageLength).optional(),
});

export type ModelSelection = z.infer<typeof modelSelectionSchema>;

/** What independence was claimed for a run, and whether the claim held. */
export const independentReviewSchema = z.object({
  authorLineage: nonEmptyString,
  criticLineage: nonEmptyString,
  lineagesDistinct: z.boolean(),
  required: z.boolean(),
  overrideRationale: nonEmptyString.max(maximumIndependenceOverrideRationaleLength).optional(),
});

export type IndependentReview = z.infer<typeof independentReviewSchema>;

/*
 * Independent-readiness reports are an exchange boundary. Keep their text
 * values intact while rejecting empty (including whitespace-only) values;
 * callers should be able to audit exactly what the assembler was given.
 */
const independentReadinessReportNonEmptyString = z
  .string()
  .refine((value) => value.trim().length > 0, "must not be empty");

const independentReadinessReportScoreSchema = z.number().finite().min(0).max(1);

const independentReadinessReportTargetIdSchema = independentReadinessReportNonEmptyString;

/** A report finding target. Rubric targets are limited to canonical dimensions. */
export const independentReadinessReportTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal(independentReadinessReportTargetKinds[0]),
    id: independentReadinessReportTargetIdSchema,
  }),
  z.strictObject({
    kind: z.literal(independentReadinessReportTargetKinds[1]),
    id: independentReadinessReportTargetIdSchema,
  }),
  z.strictObject({
    kind: z.literal(independentReadinessReportTargetKinds[2]),
    id: independentReadinessReportTargetIdSchema,
  }),
  z.strictObject({
    kind: z.literal(independentReadinessReportTargetKinds[3]),
    id: independentReadinessReportTargetIdSchema,
  }),
  z.strictObject({
    kind: z.literal(independentReadinessReportTargetKinds[4]),
    id: independentReadinessReportTargetIdSchema,
  }),
  z.strictObject({
    kind: z.literal(independentReadinessReportTargetKinds[5]),
    id: z.enum(readinessDimensions),
  }),
]);

export type IndependentReadinessReportTarget = z.infer<
  typeof independentReadinessReportTargetSchema
>;

const independentReadinessReportFindingCategorySchema = z.enum([
  "format",
  "factuality",
  "coverage",
  "evidence",
  "quality",
]);

const independentReadinessReportFindingSeveritySchema = z.enum(["error", "warning"]);

/** A complete finding with provenance assigned by the producer. */
export const independentReadinessReportFindingSchema = z.strictObject({
  id: independentReadinessReportNonEmptyString,
  origin: z.enum(independentReadinessReportFindingOrigins),
  code: independentReadinessReportNonEmptyString,
  category: independentReadinessReportFindingCategorySchema,
  severity: independentReadinessReportFindingSeveritySchema,
  rationale: independentReadinessReportNonEmptyString.max(400),
  target: independentReadinessReportTargetSchema,
  recommendedAction: independentReadinessReportNonEmptyString.max(400),
  confidence: z.number().finite().min(0).max(1),
});

export type IndependentReadinessReportFinding = z.infer<
  typeof independentReadinessReportFindingSchema
>;

/** Finding input used by the pure assembler before it assigns `origin`. */
export type IndependentReadinessReportFindingInput = Omit<
  IndependentReadinessReportFinding,
  "origin"
>;

const independentReadinessReportCompleteMissingInputsSchema = z
  .array(independentReadinessReportNonEmptyString)
  .length(0);

const independentReadinessReportIncompleteMissingInputsSchema = z
  .array(independentReadinessReportNonEmptyString)
  .min(1)
  .superRefine((missingInputs, context) => {
    if (new Set(missingInputs).size !== missingInputs.length) {
      context.addIssue({
        code: "custom",
        message: "missingInputs must contain unique values",
      });
    }
  });

/** Indicates whether all inputs needed for an independent report were present. */
export const independentReadinessReportInputAssessmentSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal(independentReadinessReportInputAssessmentStatuses[0]),
    missingInputs: independentReadinessReportCompleteMissingInputsSchema,
  }),
  z.strictObject({
    status: z.literal(independentReadinessReportInputAssessmentStatuses[1]),
    missingInputs: independentReadinessReportIncompleteMissingInputsSchema,
  }),
]);

export type IndependentReadinessReportInputAssessment = z.infer<
  typeof independentReadinessReportInputAssessmentSchema
>;

const independentReadinessReportScoresSchema = z
  .array(
    z.strictObject({
      dimension: z.enum(readinessDimensions),
      score: independentReadinessReportScoreSchema,
      rationale: independentReadinessReportNonEmptyString,
    }),
  )
  .length(readinessDimensions.length)
  .superRefine((scores, context) => {
    const counts = new Map<string, number>();
    for (const score of scores) {
      counts.set(score.dimension, (counts.get(score.dimension) ?? 0) + 1);
    }
    for (const dimension of readinessDimensions) {
      if (counts.get(dimension) !== 1) {
        context.addIssue({
          code: "custom",
          path: ["dimension"],
          message: `readiness dimension ${dimension} must appear exactly once in scores`,
        });
      }
    }
  });

const independentReadinessReportThresholdResultsSchema = z
  .array(
    z.strictObject({
      dimension: z.enum(readinessDimensions),
      score: independentReadinessReportScoreSchema,
      threshold: independentReadinessReportScoreSchema,
      meets: z.boolean(),
    }),
  )
  .length(readinessDimensions.length)
  .superRefine((thresholdResults, context) => {
    const counts = new Map<string, number>();
    for (const thresholdResult of thresholdResults) {
      counts.set(thresholdResult.dimension, (counts.get(thresholdResult.dimension) ?? 0) + 1);
    }
    for (const dimension of readinessDimensions) {
      if (counts.get(dimension) !== 1) {
        context.addIssue({
          code: "custom",
          path: ["dimension"],
          message: `readiness dimension ${dimension} must appear exactly once in thresholdResults`,
        });
      }
    }
  });

/** The persisted evaluation fields, independent of the evaluations package. */
export const independentReadinessReportEvaluationSchema = z
  .strictObject({
    scores: independentReadinessReportScoresSchema,
    thresholdResults: independentReadinessReportThresholdResultsSchema,
    meetsRubric: z.boolean(),
  })
  .superRefine((evaluation, context) => {
    const scoresByDimension = new Map(
      evaluation.scores.map((score, index) => [score.dimension, { score, index }] as const),
    );
    const thresholdResultsByDimension = new Map(
      evaluation.thresholdResults.map(
        (thresholdResult, index) =>
          [thresholdResult.dimension, { thresholdResult, index }] as const,
      ),
    );

    for (const dimension of readinessDimensions) {
      const scoreEntry = scoresByDimension.get(dimension);
      const thresholdEntry = thresholdResultsByDimension.get(dimension);
      if (scoreEntry === undefined || thresholdEntry === undefined) {
        continue;
      }

      if (scoreEntry.score.score !== thresholdEntry.thresholdResult.score) {
        context.addIssue({
          code: "custom",
          path: ["thresholdResults", thresholdEntry.index, "score"],
          message: `score for ${dimension} must match the corresponding score entry`,
        });
      }
      if (
        thresholdEntry.thresholdResult.meets !==
        thresholdEntry.thresholdResult.score >= thresholdEntry.thresholdResult.threshold
      ) {
        context.addIssue({
          code: "custom",
          path: ["thresholdResults", thresholdEntry.index, "meets"],
          message: `meets for ${dimension} must equal score >= threshold`,
        });
      }
    }

    const allThresholdsMeet = evaluation.thresholdResults.every(
      (thresholdResult) => thresholdResult.meets,
    );
    if (evaluation.meetsRubric !== allThresholdsMeet) {
      context.addIssue({
        code: "custom",
        path: ["meetsRubric"],
        message: "meetsRubric must equal whether every threshold result meets",
      });
    }
  });

export type IndependentReadinessReportEvaluation = z.infer<
  typeof independentReadinessReportEvaluationSchema
>;

export const artifactIdentitySchema = z.strictObject({
  id: independentReadinessReportNonEmptyString,
  version: z.number().finite().int().positive(),
});

const independentReadinessReportArtifactIdentitySchema = artifactIdentitySchema;

const independentReadinessReportFindingsSchema = z
  .array(independentReadinessReportFindingSchema)
  .superRefine((findings, context) => {
    const seen = new Set<string>();
    for (const [index, finding] of findings.entries()) {
      if (seen.has(finding.id)) {
        context.addIssue({
          code: "custom",
          path: [index, "id"],
          message: "finding ids must be globally unique",
        });
      }
      seen.add(finding.id);
    }
  });

/** Versioned, provider-independent output for an independent readiness read. */
export const independentReadinessReportSchema = z
  .strictObject({
    schemaVersion: z.literal(independentReadinessReportSchemaVersion),
    contextSnapshotId: independentReadinessReportNonEmptyString,
    artifact: independentReadinessReportArtifactIdentitySchema,
    createdAt: strictTimestampSchema,
    summary: independentReadinessReportNonEmptyString.max(1200),
    independentReview: independentReviewSchema.strict(),
    inputAssessment: independentReadinessReportInputAssessmentSchema,
    evaluation: independentReadinessReportEvaluationSchema,
    findings: independentReadinessReportFindingsSchema,
  })
  .superRefine((report, context) => {
    const artifactId = report.artifact?.id;
    if (typeof artifactId !== "string") {
      return;
    }

    for (const [index, finding] of report.findings.entries()) {
      if (finding.target.kind === "artifact" && finding.target.id !== artifactId) {
        context.addIssue({
          code: "custom",
          path: ["findings", index, "target", "id"],
          message: "artifact finding targets must match the report artifact id",
        });
      }
    }
  });

export type IndependentReadinessReport = z.infer<typeof independentReadinessReportSchema>;

const uniqueArtifactDiffIdsSchema = z
  .array(independentReadinessReportNonEmptyString)
  .superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "artifact diff ids must be unique within each array",
      });
    }
  });

/** Strict, provider-independent projection of the artifact changes. */
export const artifactDiffSchema = z
  .strictObject({
    addedClaimIds: uniqueArtifactDiffIdsSchema,
    removedClaimIds: uniqueArtifactDiffIdsSchema,
    changedClaimIds: uniqueArtifactDiffIdsSchema,
    changedEvidenceClaimIds: uniqueArtifactDiffIdsSchema,
    addedSectionIds: uniqueArtifactDiffIdsSchema,
    removedSectionIds: uniqueArtifactDiffIdsSchema,
    changedSectionIds: uniqueArtifactDiffIdsSchema,
  })
  .superRefine((diff, context) => {
    const assertDisjoint = (
      leftName:
        | "addedClaimIds"
        | "removedClaimIds"
        | "changedClaimIds"
        | "addedSectionIds"
        | "removedSectionIds"
        | "changedSectionIds",
      rightName:
        | "addedClaimIds"
        | "removedClaimIds"
        | "changedClaimIds"
        | "addedSectionIds"
        | "removedSectionIds"
        | "changedSectionIds",
    ): void => {
      const right = new Set(diff[rightName]);
      for (const [index, id] of diff[leftName].entries()) {
        if (right.has(id)) {
          context.addIssue({
            code: "custom",
            path: [leftName, index],
            message: `${leftName} and ${rightName} must be disjoint`,
          });
        }
      }
    };

    assertDisjoint("addedClaimIds", "removedClaimIds");
    assertDisjoint("addedClaimIds", "changedClaimIds");
    assertDisjoint("removedClaimIds", "changedClaimIds");
    assertDisjoint("addedSectionIds", "removedSectionIds");
    assertDisjoint("addedSectionIds", "changedSectionIds");
    assertDisjoint("removedSectionIds", "changedSectionIds");

    const addedOrRemovedClaims = new Set([...diff.addedClaimIds, ...diff.removedClaimIds]);
    for (const [index, id] of diff.changedEvidenceClaimIds.entries()) {
      if (addedOrRemovedClaims.has(id)) {
        context.addIssue({
          code: "custom",
          path: ["changedEvidenceClaimIds", index],
          message: "changed evidence claim ids must not be added or removed claim ids",
        });
      }
    }
  });

export type ArtifactDiff = z.infer<typeof artifactDiffSchema>;

// Descriptive alias for callers that want to distinguish this from the full
// in-memory artifact diff helper.
export const artifactDiffProjectionSchema = artifactDiffSchema;
export type ArtifactDiffProjection = ArtifactDiff;

const authorAdjudicationDecisionInputShape = {
  findingId: independentReadinessReportNonEmptyString,
  disposition: z.enum(authorAdjudicationDispositions),
  rationale: independentReadinessReportNonEmptyString.max(500),
};

/** The only author input accepted when adjudicating a report finding. */
export const authorAdjudicationDecisionInputSchema = z.strictObject(
  authorAdjudicationDecisionInputShape,
);
export type AuthorAdjudicationDecisionInput = z.infer<typeof authorAdjudicationDecisionInputSchema>;

const authorAdjudicationDecisionFindingShape = {
  findingId: independentReadinessReportNonEmptyString,
  origin: z.enum(independentReadinessReportFindingOrigins),
  code: independentReadinessReportNonEmptyString,
  severity: z.enum(["error", "warning"]),
  target: independentReadinessReportTargetSchema,
  recommendedAction: independentReadinessReportNonEmptyString.max(400),
  rationale: independentReadinessReportNonEmptyString.max(500),
};

/** A report finding plus the author's bounded, explicit decision. */
export const authorAdjudicationDecisionSchema = z.discriminatedUnion("disposition", [
  z.strictObject({
    ...authorAdjudicationDecisionFindingShape,
    disposition: z.literal(authorAdjudicationDispositions[0]),
    effectRequirement: z.literal(authorAdjudicationEffectRequirements[0]),
  }),
  z.strictObject({
    ...authorAdjudicationDecisionFindingShape,
    disposition: z.literal(authorAdjudicationDispositions[1]),
    effectRequirement: z.literal(authorAdjudicationEffectRequirements[1]),
  }),
  z.strictObject({
    ...authorAdjudicationDecisionFindingShape,
    disposition: z.literal(authorAdjudicationDispositions[2]),
    effectRequirement: z.literal(authorAdjudicationEffectRequirements[1]),
  }),
]);

export type AuthorAdjudicationDecision = z.infer<typeof authorAdjudicationDecisionSchema>;

const authorAdjudicationSourceReportSchema = z.strictObject({
  schemaVersion: z.literal(independentReadinessReportSchemaVersion),
  createdAt: strictTimestampSchema,
  artifact: artifactIdentitySchema,
});

const uniqueAuthorAdjudicationDecisionsSchema = z
  .array(authorAdjudicationDecisionSchema)
  .superRefine((decisions, context) => {
    const seen = new Set<string>();
    for (const [index, decision] of decisions.entries()) {
      if (seen.has(decision.findingId)) {
        context.addIssue({
          code: "custom",
          path: [index, "findingId"],
          message: "adjudication decision finding ids must be unique",
        });
      }
      seen.add(decision.findingId);
    }
  });

/** Versioned, strict author adjudication plan bound to one readiness report. */
export const authorAdjudicationPlanSchema = z
  .strictObject({
    schemaVersion: z.literal(authorAdjudicationPlanSchemaVersion),
    contextSnapshotId: independentReadinessReportNonEmptyString,
    sourceReport: authorAdjudicationSourceReportSchema,
    sourceArtifact: artifactIdentitySchema,
    createdAt: strictTimestampSchema,
    decisions: uniqueAuthorAdjudicationDecisionsSchema,
  })
  .superRefine((plan, context) => {
    if (
      plan.sourceReport.artifact.id !== plan.sourceArtifact.id ||
      plan.sourceReport.artifact.version !== plan.sourceArtifact.version
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceArtifact"],
        message: "source artifact must match the source report artifact identity",
      });
    }
    if (Date.parse(plan.createdAt) < Date.parse(plan.sourceReport.createdAt)) {
      context.addIssue({
        code: "custom",
        path: ["createdAt"],
        message: "adjudication plan createdAt must not precede source report createdAt",
      });
    }
  });

export type AuthorAdjudicationPlan = z.infer<typeof authorAdjudicationPlanSchema>;

const adjudicatedRevisionEffectRationaleSchema = independentReadinessReportNonEmptyString.max(500);

/** One bounded, observable effect of a plan decision on a revised artifact. */
export const adjudicatedRevisionEffectSchema = z.discriminatedUnion("status", [
  z.strictObject({
    findingId: independentReadinessReportNonEmptyString,
    status: z.literal(adjudicatedRevisionEffectStatuses[0]),
  }),
  z.strictObject({
    findingId: independentReadinessReportNonEmptyString,
    status: z.literal(adjudicatedRevisionEffectStatuses[1]),
    rationale: adjudicatedRevisionEffectRationaleSchema,
  }),
  z.strictObject({
    findingId: independentReadinessReportNonEmptyString,
    status: z.literal(adjudicatedRevisionEffectStatuses[2]),
  }),
  z.strictObject({
    findingId: independentReadinessReportNonEmptyString,
    status: z.literal(adjudicatedRevisionEffectStatuses[3]),
  }),
]);

export type AdjudicatedRevisionEffect = z.infer<typeof adjudicatedRevisionEffectSchema>;

export const adjudicatedRevisionEffectOverrideSchema = z.strictObject({
  findingId: independentReadinessReportNonEmptyString,
  rationale: adjudicatedRevisionEffectRationaleSchema,
});

export type AdjudicatedRevisionEffectOverride = z.infer<
  typeof adjudicatedRevisionEffectOverrideSchema
>;

const uniqueAdjudicatedRevisionEffectsSchema = z
  .array(adjudicatedRevisionEffectSchema)
  .superRefine((effects, context) => {
    const seen = new Set<string>();
    for (const [index, effect] of effects.entries()) {
      if (seen.has(effect.findingId)) {
        context.addIssue({
          code: "custom",
          path: [index, "findingId"],
          message: "revision effect finding ids must be unique",
        });
      }
      seen.add(effect.findingId);
    }
  });

const revisedArtifactIdentitySchema = z.strictObject({
  ...artifactIdentitySchema.shape,
  parentVersionId: independentReadinessReportNonEmptyString,
});

/** Versioned, strict projection of one adjudication's artifact revision. */
export const adjudicatedRevisionTraceSchema = z
  .strictObject({
    schemaVersion: z.literal(adjudicatedRevisionTraceSchemaVersion),
    adjudication: authorAdjudicationPlanSchema,
    revisedArtifact: revisedArtifactIdentitySchema,
    createdAt: strictTimestampSchema,
    diff: artifactDiffSchema,
    effects: uniqueAdjudicatedRevisionEffectsSchema,
    valid: z.boolean(),
  })
  .superRefine((trace, context) => {
    if (trace.revisedArtifact.id === trace.adjudication.sourceArtifact.id) {
      context.addIssue({
        code: "custom",
        path: ["revisedArtifact", "id"],
        message: "revised artifact must have a distinct id from the source artifact",
      });
    }
    if (trace.revisedArtifact.parentVersionId !== trace.adjudication.sourceArtifact.id) {
      context.addIssue({
        code: "custom",
        path: ["revisedArtifact", "parentVersionId"],
        message: "revised artifact must link to the adjudication source artifact",
      });
    }
    if (trace.revisedArtifact.version !== trace.adjudication.sourceArtifact.version + 1) {
      context.addIssue({
        code: "custom",
        path: ["revisedArtifact", "version"],
        message: "revised artifact version must immediately follow the source version",
      });
    }
    const decisionsById = new Map(
      trace.adjudication.decisions.map((decision) => [decision.findingId, decision]),
    );
    const effectsById = new Map(trace.effects.map((effect) => [effect.findingId, effect]));
    if (
      effectsById.size !== decisionsById.size ||
      effectsById.size !== trace.effects.length ||
      decisionsById.size !== trace.adjudication.decisions.length ||
      [...decisionsById.keys()].some((findingId) => !effectsById.has(findingId))
    ) {
      context.addIssue({
        code: "custom",
        path: ["effects"],
        message: "revision effects must cover each adjudication decision exactly once",
      });
    }
    for (const decision of trace.adjudication.decisions) {
      const effect = effectsById.get(decision.findingId);
      if (effect === undefined) {
        continue;
      }
      const acceptedStatus =
        effect.status === "verified" ||
        effect.status === "overridden" ||
        effect.status === "missing";
      if (decision.disposition === "accept" && !acceptedStatus) {
        context.addIssue({
          code: "custom",
          path: ["effects"],
          message: `accepted finding ${decision.findingId} must have a revision effect status`,
        });
      }
      if (decision.disposition !== "accept" && effect.status !== "disagreement-preserved") {
        context.addIssue({
          code: "custom",
          path: ["effects"],
          message: `finding ${decision.findingId} must preserve its disagreement`,
        });
      }
    }
    if (Date.parse(trace.createdAt) < Date.parse(trace.adjudication.createdAt)) {
      context.addIssue({
        code: "custom",
        path: ["createdAt"],
        message: "revision trace createdAt must not precede adjudication createdAt",
      });
    }
    const expectedValid = trace.effects.every(
      (effect) => effect.status !== adjudicatedRevisionEffectStatuses[2],
    );
    if (trace.valid !== expectedValid) {
      context.addIssue({
        code: "custom",
        path: ["valid"],
        message: "valid must equal the absence of missing revision effects",
      });
    }
  });

export type AdjudicatedRevisionTrace = z.infer<typeof adjudicatedRevisionTraceSchema>;

const stoppingDecisionReferenceIdSchema = independentReadinessReportNonEmptyString.max(200);
const stoppingDecisionCategorySchema = z.enum([
  "format",
  "factuality",
  "coverage",
  "evidence",
  "quality",
]);

/** One explicit, bounded agreement for a canonical readiness dimension. */
export const readinessDimensionAgreementSchema = z.strictObject({
  dimension: z.enum(readinessDimensions),
  status: z.enum(readinessDimensionAgreementStatuses),
  rationale: independentReadinessReportNonEmptyString.max(500),
});

export type ReadinessDimensionAgreement = z.infer<typeof readinessDimensionAgreementSchema>;

const canonicalReadinessDimensionAgreementsSchema = z
  .array(readinessDimensionAgreementSchema)
  .length(readinessDimensions.length)
  .superRefine((agreements, context) => {
    const counts = new Map<string, number>();
    for (const agreement of agreements) {
      counts.set(agreement.dimension, (counts.get(agreement.dimension) ?? 0) + 1);
    }

    for (const [index, dimension] of readinessDimensions.entries()) {
      const agreement = agreements[index];
      if (counts.get(dimension) !== 1) {
        context.addIssue({
          code: "custom",
          path: [index, "dimension"],
          message: `readiness dimension ${dimension} must appear exactly once in agreements`,
        });
      }
      if (agreement?.dimension !== dimension) {
        context.addIssue({
          code: "custom",
          path: [index, "dimension"],
          message: `readiness agreements must use canonical dimension order: ${readinessDimensions.join(", ")}`,
        });
      }
    }
  });

/** Content-free projection of one deterministic validation diagnostic. */
export const applicationReadinessDeterministicCheckSchema = z.strictObject({
  code: stoppingDecisionReferenceIdSchema,
  severity: z.enum(["error", "warning"]),
  category: stoppingDecisionCategorySchema,
  claimId: stoppingDecisionReferenceIdSchema.optional(),
  sectionId: stoppingDecisionReferenceIdSchema.optional(),
  requirementId: stoppingDecisionReferenceIdSchema.optional(),
});

export type ApplicationReadinessDeterministicCheck = z.infer<
  typeof applicationReadinessDeterministicCheckSchema
>;

type StoppingDecisionReferenceKeyInput = {
  readonly code: string;
} & Partial<
  Readonly<{
    readonly checkCode: string | undefined;
    readonly findingId: string | undefined;
    readonly inputId: string | undefined;
    readonly dimension: string | undefined;
    readonly claimId: string | undefined;
    readonly sectionId: string | undefined;
    readonly requirementId: string | undefined;
  }>
>;

const referenceKey = (reference: StoppingDecisionReferenceKeyInput): string =>
  [
    reference.code,
    reference.checkCode,
    reference.findingId,
    reference.inputId,
    reference.dimension,
    reference.claimId,
    reference.sectionId,
    reference.requirementId,
  ]
    .map((value) => value ?? "")
    .join("\u0000");

type StoppingDecisionTargetReferences = Pick<
  StoppingDecisionReferenceKeyInput,
  "dimension" | "claimId" | "sectionId" | "requirementId"
>;

const deterministicCheckKey = (
  check: Pick<
    ApplicationReadinessDeterministicCheck,
    "code" | "severity" | "category" | "claimId" | "sectionId" | "requirementId"
  >,
): string =>
  [check.code, check.severity, check.category, check.claimId, check.sectionId, check.requirementId]
    .map((value) => value ?? "")
    .join("\u0000");

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function orderStoppingDecisionReferences<T extends StoppingDecisionReferenceKeyInput>(
  references: readonly T[],
): readonly T[] {
  return [...references].sort((left, right) =>
    compareStrings(referenceKey(left), referenceKey(right)),
  );
}

function targetReferences(
  target: IndependentReadinessReport["findings"][number]["target"],
): StoppingDecisionTargetReferences {
  switch (target.kind) {
    case "rubric":
      return { dimension: target.id };
    case "claim":
      return { claimId: target.id };
    case "section":
      return { sectionId: target.id };
    case "requirement":
      return { requirementId: target.id };
    case "artifact":
    case "evidence":
      return {};
  }
}

/** The only blocker reference shape accepted for each blocker code. */
export const applicationReadinessStoppingDecisionBlockerSchema = z.discriminatedUnion("code", [
  z.strictObject({
    code: z.literal("incomplete-report-inputs"),
    inputId: stoppingDecisionReferenceIdSchema,
  }),
  z.strictObject({ code: z.literal("independent-review-incomplete") }),
  z.strictObject({
    code: z.literal("deterministic-error"),
    checkCode: stoppingDecisionReferenceIdSchema,
    claimId: stoppingDecisionReferenceIdSchema.optional(),
    sectionId: stoppingDecisionReferenceIdSchema.optional(),
    requirementId: stoppingDecisionReferenceIdSchema.optional(),
  }),
  z.strictObject({
    code: z.literal("report-error"),
    findingId: stoppingDecisionReferenceIdSchema,
    dimension: z.enum(readinessDimensions).optional(),
    claimId: stoppingDecisionReferenceIdSchema.optional(),
    sectionId: stoppingDecisionReferenceIdSchema.optional(),
    requirementId: stoppingDecisionReferenceIdSchema.optional(),
  }),
  z.strictObject({
    code: z.literal("unmet-rubric-threshold"),
    dimension: z.enum(readinessDimensions),
  }),
  z.strictObject({
    code: z.literal("disputed-dimension"),
    dimension: z.enum(readinessDimensions),
  }),
  z.strictObject({
    code: z.literal("missing-revision-effect"),
    findingId: stoppingDecisionReferenceIdSchema,
  }),
]);
export type ApplicationReadinessStoppingDecisionBlocker = z.infer<
  typeof applicationReadinessStoppingDecisionBlockerSchema
>;

/** The only limitation reference shape accepted for each limitation code. */
export const applicationReadinessStoppingDecisionLimitationSchema = z.discriminatedUnion("code", [
  z.strictObject({
    code: z.literal("deterministic-warning"),
    checkCode: stoppingDecisionReferenceIdSchema,
    claimId: stoppingDecisionReferenceIdSchema.optional(),
    sectionId: stoppingDecisionReferenceIdSchema.optional(),
    requirementId: stoppingDecisionReferenceIdSchema.optional(),
  }),
  z.strictObject({
    code: z.literal("report-warning"),
    findingId: stoppingDecisionReferenceIdSchema,
    dimension: z.enum(readinessDimensions).optional(),
    claimId: stoppingDecisionReferenceIdSchema.optional(),
    sectionId: stoppingDecisionReferenceIdSchema.optional(),
    requirementId: stoppingDecisionReferenceIdSchema.optional(),
  }),
  z.strictObject({
    code: z.literal("revision-effect-overridden"),
    findingId: stoppingDecisionReferenceIdSchema,
  }),
  z.strictObject({
    code: z.literal("disagreement-preserved"),
    findingId: stoppingDecisionReferenceIdSchema,
  }),
]);
export type ApplicationReadinessStoppingDecisionLimitation = z.infer<
  typeof applicationReadinessStoppingDecisionLimitationSchema
>;

function addReferenceOrderAndUniquenessIssues<T extends StoppingDecisionReferenceKeyInput>(
  references: readonly T[],
  context: z.RefinementCtx,
  label: string,
): void {
  const seen = new Set<string>();
  let previousKey: string | undefined;
  for (const [index, reference] of references.entries()) {
    const key = referenceKey(reference);
    if (seen.has(key)) {
      context.addIssue({
        code: "custom",
        path: [index],
        message: `${label} references must be unique`,
      });
    }
    if (previousKey !== undefined && compareStrings(previousKey, key) >= 0) {
      context.addIssue({
        code: "custom",
        path: [index],
        message: `${label} references must use canonical order`,
      });
    }
    seen.add(key);
    previousKey = key;
  }
}

const uniqueStoppingDecisionBlockersSchema = z
  .array(applicationReadinessStoppingDecisionBlockerSchema)
  .superRefine((blockers, context) => {
    addReferenceOrderAndUniquenessIssues(blockers, context, "stopping decision blocker");
  });

const uniqueStoppingDecisionLimitationsSchema = z
  .array(applicationReadinessStoppingDecisionLimitationSchema)
  .superRefine((limitations, context) => {
    addReferenceOrderAndUniquenessIssues(limitations, context, "stopping decision limitation");
  });

const applicationReadinessStoppingDecisionChecksSchema = z
  .array(applicationReadinessDeterministicCheckSchema)
  .superRefine((checks, context) => {
    const seen = new Set<string>();
    let previousKey: string | undefined;
    for (const [index, check] of checks.entries()) {
      const key = deterministicCheckKey(check);
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "deterministic check references must be unique",
        });
      }
      if (previousKey !== undefined && compareStrings(previousKey, key) >= 0) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "deterministic checks must use canonical order",
        });
      }
      seen.add(key);
      previousKey = key;
    }
  });

const positiveSafeIntegerSchema = z
  .number()
  .finite()
  .int()
  .positive()
  .refine(Number.isSafeInteger, "must be a safe integer");

/** Bounded loop state used to derive the stopping reason. */
export const applicationReadinessStoppingLoopContextSchema = z.strictObject({
  round: positiveSafeIntegerSchema,
  maxRounds: positiveSafeIntegerSchema,
  stable: z.boolean(),
  budgetExhausted: z.boolean(),
  cancelled: z.boolean(),
});

export type ApplicationReadinessStoppingLoopContext = z.infer<
  typeof applicationReadinessStoppingLoopContextSchema
>;

/** The artifact identity and chronology projection carried by a decision. */
export const applicationReadinessStoppingDecisionArtifactSchema = z
  .strictObject({
    ...artifactIdentitySchema.shape,
    createdAt: strictTimestampSchema,
    parentVersionId: independentReadinessReportNonEmptyString.nullable(),
  })
  .superRefine((artifact, context) => {
    if (artifact.version === 1 && artifact.parentVersionId !== null) {
      context.addIssue({
        code: "custom",
        path: ["parentVersionId"],
        message: "version 1 decision artifacts must not have a parent version",
      });
    }
    if (artifact.version > 1 && artifact.parentVersionId === null) {
      context.addIssue({
        code: "custom",
        path: ["parentVersionId"],
        message: "decision artifact versions after version 1 must link to a parent version",
      });
    }
  });

export type ApplicationReadinessStoppingDecisionArtifact = z.infer<
  typeof applicationReadinessStoppingDecisionArtifactSchema
>;

function expectedStoppingDecisionBlockers(
  report: IndependentReadinessReport,
  deterministicChecks: readonly ApplicationReadinessDeterministicCheck[],
  agreements: readonly ReadinessDimensionAgreement[],
  latestRevisionTrace: AdjudicatedRevisionTrace | undefined,
): readonly StoppingDecisionReferenceKeyInput[] {
  const blockers: StoppingDecisionReferenceKeyInput[] = [];
  if (report.inputAssessment.status === "incomplete") {
    for (const inputId of report.inputAssessment.missingInputs) {
      blockers.push({ code: "incomplete-report-inputs", inputId });
    }
  }

  const independentReview = report.independentReview;
  if (
    !independentReview.required ||
    (!independentReview.lineagesDistinct && independentReview.overrideRationale === undefined)
  ) {
    blockers.push({ code: "independent-review-incomplete" });
  }

  for (const check of deterministicChecks) {
    if (check.severity === "error") {
      blockers.push({
        code: "deterministic-error",
        checkCode: check.code,
        ...(check.claimId === undefined ? {} : { claimId: check.claimId }),
        ...(check.sectionId === undefined ? {} : { sectionId: check.sectionId }),
        ...(check.requirementId === undefined ? {} : { requirementId: check.requirementId }),
      });
    }
  }

  for (const finding of report.findings) {
    if (finding.severity === "error") {
      blockers.push({
        code: "report-error",
        findingId: finding.id,
        ...targetReferences(finding.target),
      });
    }
  }

  for (const thresholdResult of report.evaluation.thresholdResults) {
    if (!thresholdResult.meets) {
      blockers.push({ code: "unmet-rubric-threshold", dimension: thresholdResult.dimension });
    }
  }

  for (const agreement of agreements) {
    if (agreement.status === "disputed") {
      blockers.push({ code: "disputed-dimension", dimension: agreement.dimension });
    }
  }

  if (latestRevisionTrace !== undefined) {
    const decisionsById = new Map(
      latestRevisionTrace.adjudication.decisions.map((decision) => [decision.findingId, decision]),
    );
    for (const effect of latestRevisionTrace.effects) {
      const decision = decisionsById.get(effect.findingId);
      if (decision?.disposition === "accept" && effect.status === "missing") {
        blockers.push({ code: "missing-revision-effect", findingId: effect.findingId });
      }
    }
  }

  return orderStoppingDecisionReferences(blockers);
}

function expectedStoppingDecisionLimitations(
  report: IndependentReadinessReport,
  deterministicChecks: readonly ApplicationReadinessDeterministicCheck[],
  latestRevisionTrace: AdjudicatedRevisionTrace | undefined,
): readonly StoppingDecisionReferenceKeyInput[] {
  const limitations: StoppingDecisionReferenceKeyInput[] = [];
  for (const check of deterministicChecks) {
    if (check.severity === "warning") {
      limitations.push({
        code: "deterministic-warning",
        checkCode: check.code,
        ...(check.claimId === undefined ? {} : { claimId: check.claimId }),
        ...(check.sectionId === undefined ? {} : { sectionId: check.sectionId }),
        ...(check.requirementId === undefined ? {} : { requirementId: check.requirementId }),
      });
    }
  }
  for (const finding of report.findings) {
    if (finding.severity === "warning") {
      limitations.push({
        code: "report-warning",
        findingId: finding.id,
        ...targetReferences(finding.target),
      });
    }
  }
  if (latestRevisionTrace !== undefined) {
    for (const effect of latestRevisionTrace.effects) {
      if (effect.status === "overridden") {
        limitations.push({ code: "revision-effect-overridden", findingId: effect.findingId });
      } else if (effect.status === "disagreement-preserved") {
        limitations.push({ code: "disagreement-preserved", findingId: effect.findingId });
      }
    }
  }
  return orderStoppingDecisionReferences(limitations);
}

function referenceArraysMatch(
  actual: readonly StoppingDecisionReferenceKeyInput[],
  expected: readonly StoppingDecisionReferenceKeyInput[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((reference, index) => {
      const expectedReference = expected[index];
      return (
        expectedReference !== undefined &&
        referenceKey(reference) === referenceKey(expectedReference)
      );
    })
  );
}

function expectedStoppingDecisionReason(
  applicationReady: boolean,
  loopContext: ApplicationReadinessStoppingLoopContext,
): ApplicationReadinessStoppingDecisionStopReason {
  if (applicationReady) return "application-ready";
  if (loopContext.cancelled) return "cancelled";
  if (loopContext.budgetExhausted) return "budget-exhausted";
  if (loopContext.round >= loopContext.maxRounds) return "max-rounds";
  if (loopContext.stable) return "stable-convergence";
  return "continue";
}

/** Versioned, provider-independent application-readiness stopping decision. */
export const applicationReadinessStoppingDecisionSchema = z
  .strictObject({
    schemaVersion: z.literal(applicationReadinessStoppingDecisionSchemaVersion),
    contextSnapshotId: independentReadinessReportNonEmptyString,
    artifact: applicationReadinessStoppingDecisionArtifactSchema,
    createdAt: strictTimestampSchema,
    report: independentReadinessReportSchema,
    latestRevisionTrace: adjudicatedRevisionTraceSchema.optional(),
    deterministicChecks: applicationReadinessStoppingDecisionChecksSchema,
    agreements: canonicalReadinessDimensionAgreementsSchema,
    blockers: uniqueStoppingDecisionBlockersSchema,
    limitations: uniqueStoppingDecisionLimitationsSchema,
    loopContext: applicationReadinessStoppingLoopContextSchema,
    applicationReady: z.boolean(),
    shouldStop: z.boolean(),
    bestAvailable: z.boolean(),
    stopReason: z.enum(applicationReadinessStoppingDecisionStopReasons),
    humanApprovalRequired: z.literal(true),
  })
  .superRefine((decision, context) => {
    if (
      decision.artifact.id !== decision.report.artifact.id ||
      decision.artifact.version !== decision.report.artifact.version
    ) {
      context.addIssue({
        code: "custom",
        path: ["artifact"],
        message: "decision artifact must match the readiness report artifact identity",
      });
    }
    if (decision.contextSnapshotId !== decision.report.contextSnapshotId) {
      context.addIssue({
        code: "custom",
        path: ["contextSnapshotId"],
        message: "decision context must match the readiness report context",
      });
    }
    if (Date.parse(decision.report.createdAt) > Date.parse(decision.createdAt)) {
      context.addIssue({
        code: "custom",
        path: ["createdAt"],
        message: "decision createdAt must not precede the readiness report",
      });
    }
    if (Date.parse(decision.report.createdAt) < Date.parse(decision.artifact.createdAt)) {
      context.addIssue({
        code: "custom",
        path: ["report", "createdAt"],
        message: "readiness report createdAt must not precede artifact creation",
      });
    }

    const trace = decision.latestRevisionTrace;
    if (trace !== undefined) {
      if (
        trace.revisedArtifact.id !== decision.artifact.id ||
        trace.revisedArtifact.version !== decision.artifact.version ||
        trace.revisedArtifact.parentVersionId !== decision.artifact.parentVersionId
      ) {
        context.addIssue({
          code: "custom",
          path: ["latestRevisionTrace", "revisedArtifact"],
          message: "revision trace must describe the decision artifact",
        });
      }
      if (trace.adjudication.contextSnapshotId !== decision.contextSnapshotId) {
        context.addIssue({
          code: "custom",
          path: ["latestRevisionTrace", "adjudication", "contextSnapshotId"],
          message: "revision trace context must match the decision context",
        });
      }
      if (Date.parse(trace.createdAt) > Date.parse(decision.report.createdAt)) {
        context.addIssue({
          code: "custom",
          path: ["report", "createdAt"],
          message: "readiness report createdAt must not precede its revision trace",
        });
      }
    }

    const expectedBlockers = expectedStoppingDecisionBlockers(
      decision.report,
      decision.deterministicChecks,
      decision.agreements,
      trace,
    );
    const expectedLimitations = expectedStoppingDecisionLimitations(
      decision.report,
      decision.deterministicChecks,
      trace,
    );
    if (!referenceArraysMatch(decision.blockers, expectedBlockers)) {
      context.addIssue({
        code: "custom",
        path: ["blockers"],
        message: "blockers must exactly cover the derived blocking references in canonical order",
      });
    }
    if (!referenceArraysMatch(decision.limitations, expectedLimitations)) {
      context.addIssue({
        code: "custom",
        path: ["limitations"],
        message:
          "limitations must exactly cover the derived non-blocking references in canonical order",
      });
    }

    const expectedApplicationReady = expectedBlockers.length === 0;
    if (decision.applicationReady !== expectedApplicationReady) {
      context.addIssue({
        code: "custom",
        path: ["applicationReady"],
        message: "applicationReady must equal whether the derived blocker set is absent",
      });
    }
    const expectedReason = expectedStoppingDecisionReason(
      expectedApplicationReady,
      decision.loopContext,
    );
    if (decision.stopReason !== expectedReason) {
      context.addIssue({
        code: "custom",
        path: ["stopReason"],
        message: "stopReason must equal the loop-context precedence result",
      });
    }
    const expectedShouldStop = expectedReason !== "continue";
    if (decision.shouldStop !== expectedShouldStop) {
      context.addIssue({
        code: "custom",
        path: ["shouldStop"],
        message: "shouldStop must equal whether the derived stop reason is not continue",
      });
    }
    if (decision.bestAvailable !== (expectedShouldStop && !expectedApplicationReady)) {
      context.addIssue({
        code: "custom",
        path: ["bestAvailable"],
        message: "bestAvailable must equal stopped and not derived application-ready",
      });
    }
  });

export type ApplicationReadinessStoppingDecision = z.infer<
  typeof applicationReadinessStoppingDecisionSchema
>;

export const modelConfigurationSchema = z
  .object({
    author: modelSelectionSchema,
    critic: modelSelectionSchema,
    /** Historic name; the property it gates is lineage distinctness. */
    requireProviderDiversity: z.boolean().default(true),
    independenceOverrideRationale: nonEmptyString
      .max(maximumIndependenceOverrideRationaleLength)
      .optional(),
    /** Absent on snapshots written before independence became recorded. */
    independentReview: independentReviewSchema.optional(),
  })
  .superRefine((configuration, context) => {
    if (configuration.author.role !== "author") {
      context.addIssue({
        code: "custom",
        path: ["author", "role"],
        message: "the author selection must have the author role",
      });
    }
    if (configuration.critic.role !== "critic") {
      context.addIssue({
        code: "custom",
        path: ["critic", "role"],
        message: "the critic selection must have the critic role",
      });
    }
    if (
      configuration.requireProviderDiversity &&
      configuration.independenceOverrideRationale === undefined &&
      configuration.independentReview?.overrideRationale === undefined &&
      deriveModelLineage(configuration.author) === deriveModelLineage(configuration.critic)
    ) {
      context.addIssue({
        code: "custom",
        path: ["critic", "lineage"],
        message:
          "author and critic must use different model lineages; record an independenceOverrideRationale to proceed with one lineage",
      });
    }
  });

export type ModelConfiguration = z.infer<typeof modelConfigurationSchema>;

export const agentContextReferenceSchema = z
  .object({
    contextSnapshotId: nonEmptyString,
    role: z.enum(["author", "critic"]),
    model: modelSelectionSchema,
  })
  .superRefine((reference, context) => {
    if (reference.role !== reference.model.role) {
      context.addIssue({
        code: "custom",
        path: ["model", "role"],
        message: "the referenced model role must match the agent role",
      });
    }
  });

export type AgentContextReference = z.infer<typeof agentContextReferenceSchema>;

function duplicateIndices(values: readonly { id: string }[]): number[] {
  const seen = new Set<string>();
  const duplicates: number[] = [];
  values.forEach((value, index) => {
    if (seen.has(value.id)) {
      duplicates.push(index);
    } else {
      seen.add(value.id);
    }
  });
  return duplicates;
}

/** The exact reviewed opportunity brief version bound to a run context. */
const opportunityBriefReferenceChecksumSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u, "must be a lowercase SHA-256 checksum");

export const opportunityBriefReferenceSchema = z.strictObject({
  briefId: opportunityBriefIdSchema,
  version: z
    .number()
    .finite()
    .int()
    .positive()
    .refine(Number.isSafeInteger, "must be a safe integer"),
  checksum: opportunityBriefReferenceChecksumSchema,
});

export type OpportunityBriefReference = z.infer<typeof opportunityBriefReferenceSchema>;
export type OpportunityBriefReferenceInput = z.input<typeof opportunityBriefReferenceSchema>;

const contextSnapshotShape = z.object({
  schemaVersion: z.literal(contextSchemaVersion),
  id: nonEmptyString,
  workspaceId: nonEmptyString,
  createdAt: timestampSchema,
  jobDescription: nonEmptyString,
  requirements: z.array(jobRequirementSchema).min(1),
  candidateInstructions: z.string().default(""),
  language: nonEmptyString,
  outputConstraints: outputConstraintsSchema,
  truthfulnessPolicy: nonEmptyString.default("Do not add unsupported claims."),
  writingPolicy: writingPolicySchema.optional(),
  readinessRubric: readinessRubricSchema,
  evidenceManifest: z.array(evidenceSourceSchema).min(1),
  modelConfiguration: modelConfigurationSchema,
  candidateKnowledgeSelection: candidateKnowledgeSelectionSnapshotSchema.optional(),
  opportunityBriefReference: opportunityBriefReferenceSchema.optional(),
  profileId: nonEmptyString.optional(),
});

export const contextSnapshotSchema = contextSnapshotShape.superRefine((snapshot, context) => {
  for (const index of duplicateIndices(snapshot.requirements)) {
    context.addIssue({
      code: "custom",
      path: ["requirements", index, "id"],
      message: "requirement ids must be unique",
    });
  }
  for (const index of duplicateIndices(snapshot.evidenceManifest)) {
    context.addIssue({
      code: "custom",
      path: ["evidenceManifest", index, "id"],
      message: "evidence source ids must be unique",
    });
  }
});

export type ContextSnapshotSchemaInput = z.input<typeof contextSnapshotSchema>;
export type ContextSnapshotSchemaOutput = z.output<typeof contextSnapshotSchema>;

const contextSnapshotInputShape = z.object({
  schemaVersion: z.literal(contextSchemaVersion).optional(),
  id: nonEmptyString,
  workspaceId: nonEmptyString,
  createdAt: timestampSchema,
  jobDescription: nonEmptyString,
  requirements: z.array(jobRequirementInputSchema).min(1),
  candidateInstructions: z.string().default(""),
  language: nonEmptyString,
  outputConstraints: outputConstraintsSchema.default({
    format: "markdown",
    requiredSections: [],
  }),
  truthfulnessPolicy: nonEmptyString.default("Do not add unsupported claims."),
  writingPolicy: writingPolicySchema.optional(),
  readinessRubric: readinessRubricSchema,
  evidenceManifest: z.array(evidenceSourceSchema).min(1),
  modelConfiguration: modelConfigurationSchema,
  candidateKnowledgeSelection: candidateKnowledgeSelectionSnapshotSchema.optional(),
  opportunityBriefReference: opportunityBriefReferenceSchema.optional(),
  profileId: nonEmptyString.optional(),
});

export const contextSnapshotInputSchema = contextSnapshotInputShape.superRefine(
  (snapshot, context) => {
    for (const index of duplicateIndices(snapshot.requirements)) {
      context.addIssue({
        code: "custom",
        path: ["requirements", index, "id"],
        message: "requirement ids must be unique",
      });
    }
    for (const index of duplicateIndices(snapshot.evidenceManifest)) {
      context.addIssue({
        code: "custom",
        path: ["evidenceManifest", index, "id"],
        message: "evidence source ids must be unique",
      });
    }
  },
);

export type ContextSnapshotInput = z.input<typeof contextSnapshotInputSchema>;
export type ContextSnapshot = z.output<typeof contextSnapshotInputSchema>;

/**
 * Serialize a validated snapshot at the persistence boundary. The schema parse
 * is intentional: callers cannot persist a structurally compatible object that
 * bypasses the canonical context contract.
 */
export function serializeContextSnapshot(snapshot: unknown): string {
  return JSON.stringify(contextSnapshotSchema.parse(snapshot));
}

/**
 * Reload a snapshot from local persistence while preserving provenance,
 * constraints, rubric, and model identity through schema validation.
 */
export function parseContextSnapshot(serialized: string): ContextSnapshot {
  return contextSnapshotSchema.parse(JSON.parse(serialized));
}

export const contextSnapshotSchemaVersion = contextSchemaVersion;
export const checksumPattern = checksumSchema;

// Keep the dimensions exported alongside the schemas so consumers do not have
// to duplicate the rubric's canonical keys.
export {
  adjudicatedRevisionEffectStatuses,
  adjudicatedRevisionTraceSchemaVersion,
  applicationReadinessStoppingDecisionBlockerCodes,
  applicationReadinessStoppingDecisionLimitationCodes,
  applicationReadinessStoppingDecisionSchemaVersion,
  applicationReadinessStoppingDecisionStopReasons,
  authorAdjudicationDispositions,
  authorAdjudicationEffectRequirements,
  authorAdjudicationPlanSchemaVersion,
  canonicalCandidateProfileExtractionSchemaVersion,
  canonicalCandidateProfileFactCategories,
  canonicalCandidateProfileIssueCodes,
  canonicalCandidateProfileIssueSeverities,
  canonicalCandidateProfileIssueStatuses,
  canonicalCandidateProfileProvenanceKinds,
  canonicalCandidateProfileSchemaVersion,
  canonicalCandidateProfileStatuses,
  independentReadinessReportFindingOrigins,
  independentReadinessReportInputAssessmentStatuses,
  independentReadinessReportSchemaVersion,
  independentReadinessReportTargetKinds,
  opportunityBriefIssueCodes,
  opportunityBriefIssueSeverities,
  opportunityBriefIssueStatuses,
  opportunityBriefMaximumCollectionEntries,
  opportunityBriefMaximumIdLength,
  opportunityBriefMaximumMessageLength,
  opportunityBriefMaximumSourceCount,
  opportunityBriefMaximumSourceIds,
  opportunityBriefMaximumTextLength,
  opportunityBriefProvenanceKinds,
  opportunityBriefSchemaVersion,
  opportunityBriefSourceClassifications,
  opportunityBriefSourceStatuses,
  opportunityBriefStatuses,
  outputFormats,
  readinessDimensionAgreementStatuses,
  readinessDimensions,
  renderingLayoutProfileIds,
  renderingQaActiveContentSignatures,
  renderingQaLimitationCodes,
  renderingQaReportSchemaVersion,
  renderingQaVisibleContentOrderSignals,
  requirementPriorities,
  writingPolicyPageTargets,
  writingPolicySchemaVersion,
};

export const artifactSchemaVersion = 1 as const;

export const artifactKinds = ["cv", "cover-letter", "application-qa"] as const;
export type ArtifactKind = (typeof artifactKinds)[number];

export const artifactSectionKinds = [
  "summary",
  "experience",
  "education",
  "skills",
  "projects",
  "custom",
  "salutation",
  "hook",
  "alignment",
  "closing",
  "question",
  "answer",
] as const;

export const artifactBlockTypes = ["paragraph", "bullet"] as const;
export const claimStatuses = ["unverified", "verified", "disputed"] as const;
export const artifactDecisionTypes = [
  "edit",
  "accept-finding",
  "reject-finding",
  "approve",
] as const;

const authorArtifactClaimProposalSchema = z.strictObject({
  text: nonEmptyString,
  substantive: z.boolean(),
  evidenceChunkIds: z.array(nonEmptyString).superRefine((ids, context) => {
    const seen = new Set<string>();
    for (const [index, id] of ids.entries()) {
      if (seen.has(id)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "evidence chunk ids must be unique within a claim",
        });
      }
      seen.add(id);
    }
  }),
});

const authorArtifactBlockProposalSchema = z.strictObject({
  type: z.enum(artifactBlockTypes),
  text: nonEmptyString,
  claims: z.array(authorArtifactClaimProposalSchema),
});

const authorArtifactSectionProposalSchema = z.strictObject({
  title: nonEmptyString,
  kind: z.enum(artifactSectionKinds),
  blocks: z.array(authorArtifactBlockProposalSchema).min(1),
});

/**
 * The provider-facing author contract contains content and local evidence
 * references only. Canonical artifact metadata is assigned by the
 * application after this proposal has been validated.
 */
export const authorArtifactProposalSchema = z.strictObject({
  sections: z.array(authorArtifactSectionProposalSchema).min(1),
});

export type AuthorArtifactProposal = z.infer<typeof authorArtifactProposalSchema>;

/**
 * Keep provider JSON schemas derived from the same Zod contract. The draft-07
 * form is accepted by both live adapters; the provider boundary does not need
 * the informational `$schema` property.
 */
const authorArtifactProposalJsonSchemaWithMeta = z.toJSONSchema(authorArtifactProposalSchema, {
  target: "draft-7",
});

const { $schema: _authorArtifactProposalSchemaMetadata, ...authorArtifactProposalJsonSchemaValue } =
  authorArtifactProposalJsonSchemaWithMeta;

export const authorArtifactProposalJsonSchema = authorArtifactProposalJsonSchemaValue;

type AuthorProposalJsonSchemaShape = {
  properties: {
    sections: {
      items: {
        properties: {
          blocks: {
            items: {
              properties: {
                claims: {
                  items: {
                    properties: {
                      evidenceChunkIds: Record<string, unknown>;
                    };
                  };
                };
              };
            };
          };
        };
      };
    };
  };
};

/**
 * Narrow the provider contract to evidence IDs included in this exact request.
 * The canonical Zod boundary still performs the authoritative local check.
 */
export function authorArtifactProposalJsonSchemaForEvidence(
  evidenceChunkIds: readonly string[],
): typeof authorArtifactProposalJsonSchema {
  const schema = structuredClone(
    authorArtifactProposalJsonSchema,
  ) as unknown as AuthorProposalJsonSchemaShape;
  const allowedIds = [...new Set(evidenceChunkIds)];
  const evidenceIdsSchema =
    schema.properties.sections.items.properties.blocks.items.properties.claims.items.properties
      .evidenceChunkIds;

  if (allowedIds.length > 0) {
    evidenceIdsSchema.items = { type: "string", enum: allowedIds };
  }

  return schema as unknown as typeof authorArtifactProposalJsonSchema;
}

const uniqueStrings = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;

const evidenceReferenceShape = z.object({
  sourcePath: nonEmptyString,
  sourceChecksum: checksumSchema.optional(),
  locator: nonEmptyString.optional(),
  excerpt: nonEmptyString,
});

export const artifactEvidenceReferenceSchema = evidenceReferenceShape;
export type ArtifactEvidenceReference = z.infer<typeof artifactEvidenceReferenceSchema>;

export const artifactBlockSchema = z.object({
  id: nonEmptyString,
  type: z.enum(artifactBlockTypes),
  text: nonEmptyString,
  claimIds: z
    .array(nonEmptyString)
    .refine(uniqueStrings, "claim ids must be unique within a block"),
});
export type ArtifactBlock = z.infer<typeof artifactBlockSchema>;

export const artifactSectionSchema = z.object({
  id: nonEmptyString,
  title: nonEmptyString,
  kind: z.enum(artifactSectionKinds),
  order: z.number().finite().int().nonnegative(),
  blocks: z.array(artifactBlockSchema),
});
export type ArtifactSection = z.infer<typeof artifactSectionSchema>;

export const artifactClaimSchema = z.object({
  id: nonEmptyString,
  text: nonEmptyString,
  sectionId: nonEmptyString,
  blockId: nonEmptyString,
  substantive: z.boolean(),
  status: z.enum(claimStatuses),
  evidence: z.array(artifactEvidenceReferenceSchema),
});
export type ArtifactClaim = z.infer<typeof artifactClaimSchema>;

export const artifactDecisionSchema = z.object({
  id: nonEmptyString,
  type: z.enum(artifactDecisionTypes),
  rationale: nonEmptyString,
  createdAt: timestampSchema,
  claimId: nonEmptyString.optional(),
});
export type ArtifactDecision = z.infer<typeof artifactDecisionSchema>;

const artifactVersionShape = z.object({
  schemaVersion: z.literal(artifactSchemaVersion),
  id: nonEmptyString,
  kind: z.enum(artifactKinds).optional(),
  version: z.number().finite().int().positive(),
  parentVersionId: nonEmptyString.nullable(),
  createdAt: timestampSchema,
  language: nonEmptyString,
  sections: z.array(artifactSectionSchema).min(1),
  claims: z.array(artifactClaimSchema),
  decisions: z.array(artifactDecisionSchema),
});

export const draftArtifactSchema = artifactVersionShape.superRefine((artifact, context) => {
  if (artifact.version === 1 && artifact.parentVersionId !== null) {
    context.addIssue({
      code: "custom",
      path: ["parentVersionId"],
      message: "version 1 artifacts must not have a parent version",
    });
  }
  if (artifact.version > 1 && artifact.parentVersionId === null) {
    context.addIssue({
      code: "custom",
      path: ["parentVersionId"],
      message: "artifact versions after version 1 must link to a parent version",
    });
  }

  const sectionIds = artifact.sections.map((section) => section.id);
  const blockIds = artifact.sections.flatMap((section) => section.blocks.map((block) => block.id));
  const blockSectionIds = new Map(
    artifact.sections.flatMap((section) =>
      section.blocks.map((block) => [block.id, section.id] as const),
    ),
  );
  const claimIds = artifact.claims.map((claim) => claim.id);
  const decisionIds = artifact.decisions.map((decision) => decision.id);

  for (const [field, values] of [
    ["sections", sectionIds],
    ["blocks", blockIds],
    ["claims", claimIds],
    ["decisions", decisionIds],
  ] as const) {
    if (!uniqueStrings(values)) {
      context.addIssue({ code: "custom", path: [field], message: `${field} ids must be unique` });
    }
  }

  const sectionIdSet = new Set(sectionIds);
  const blockIdSet = new Set(blockIds);
  const claimIdSet = new Set(claimIds);
  for (const [index, claim] of artifact.claims.entries()) {
    if (!sectionIdSet.has(claim.sectionId)) {
      context.addIssue({
        code: "custom",
        path: ["claims", index, "sectionId"],
        message: "claim section must reference an existing section",
      });
    }
    if (!blockIdSet.has(claim.blockId)) {
      context.addIssue({
        code: "custom",
        path: ["claims", index, "blockId"],
        message: "claim block must reference an existing block",
      });
    } else if (blockSectionIds.get(claim.blockId) !== claim.sectionId) {
      context.addIssue({
        code: "custom",
        path: ["claims", index, "sectionId"],
        message: "claim section must match the section containing its block",
      });
    }
  }
  for (const [sectionIndex, section] of artifact.sections.entries()) {
    for (const [blockIndex, block] of section.blocks.entries()) {
      for (const [claimIndex, claimId] of block.claimIds.entries()) {
        if (!claimIdSet.has(claimId)) {
          context.addIssue({
            code: "custom",
            path: ["sections", sectionIndex, "blocks", blockIndex, "claimIds", claimIndex],
            message: "block claim must reference an existing claim",
          });
        }
      }
    }
  }
  for (const [index, decision] of artifact.decisions.entries()) {
    if (decision.claimId !== undefined && !claimIdSet.has(decision.claimId)) {
      context.addIssue({
        code: "custom",
        path: ["decisions", index, "claimId"],
        message: "decision claim must reference an existing claim",
      });
    }
  }
});

export type DraftArtifactInput = z.input<typeof draftArtifactSchema>;
export type DraftArtifact = z.output<typeof draftArtifactSchema>;

/*
 * Rendering QA is deliberately a content-free exchange boundary.  It carries
 * checksums, counts, ordering signals, and bounded observations; rendered
 * text, source paths, bytes, prompts, and provider responses do not cross it.
 */
export const renderingLayoutProfileSchema = z.enum(renderingLayoutProfileIds);

export const renderingQaOutputFormats = ["markdown", "pdf", "docx"] as const;
export const renderingQaOutputFormatSchema = z.enum(renderingQaOutputFormats);
export type RenderingQaOutputFormat = z.infer<typeof renderingQaOutputFormatSchema>;

const nonNegativeSafeIntegerSchema = z
  .number()
  .finite()
  .int()
  .nonnegative()
  .refine(Number.isSafeInteger, "must be a safe integer");

function addCanonicalNumberArrayIssues(
  values: readonly number[],
  context: z.RefinementCtx,
  label: string,
): void {
  const seen = new Set<number>();
  let previous: number | undefined;
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        path: [index],
        message: `${label} must contain unique values`,
      });
    }
    if (previous !== undefined && value <= previous) {
      context.addIssue({
        code: "custom",
        path: [index],
        message: `${label} must use ascending canonical order`,
      });
    }
    seen.add(value);
    previous = value;
  }
}

function addCanonicalStringArrayIssues(
  values: readonly string[],
  context: z.RefinementCtx,
  label: string,
): void {
  const seen = new Set<string>();
  let previous: string | undefined;
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        path: [index],
        message: `${label} must contain unique values`,
      });
    }
    if (previous !== undefined && compareStrings(previous, value) >= 0) {
      context.addIssue({
        code: "custom",
        path: [index],
        message: `${label} must use ascending canonical order`,
      });
    }
    seen.add(value);
    previous = value;
  }
}

const renderingQaPageNumbersSchema = z
  .array(positiveSafeIntegerSchema)
  .superRefine((values, context) => {
    addCanonicalNumberArrayIssues(values, context, "page numbers");
  });

const renderingQaOrphanSectionIdsSchema = z
  .array(independentReadinessReportNonEmptyString)
  .superRefine((values, context) => {
    addCanonicalStringArrayIssues(values, context, "orphan section ids");
  });

const boundedViewerNameSchema = independentReadinessReportNonEmptyString.max(120);
const boundedViewerVersionSchema = independentReadinessReportNonEmptyString.max(80);

/** Optional independent viewer evidence, bound to one rendered checksum. */
export const renderingQaViewerObservationSchema = z
  .strictObject({
    renderedChecksum: sha256ChecksumSchema,
    viewerName: boundedViewerNameSchema,
    viewerVersion: boundedViewerVersionSchema,
    recoveredVisibleContentChecksum: sha256ChecksumSchema,
    recoveredVisibleContentCount: nonNegativeSafeIntegerSchema,
    recoveredVisibleContentOrder: z.enum(renderingQaVisibleContentOrderSignals),
    pageCount: positiveSafeIntegerSchema,
    blankPageNumbers: renderingQaPageNumbersSchema,
    overflowPageNumbers: renderingQaPageNumbersSchema,
    orphanSectionIds: renderingQaOrphanSectionIdsSchema,
    clippedText: z.boolean(),
  })
  .superRefine((observation, context) => {
    for (const [field, values] of [
      ["blankPageNumbers", observation.blankPageNumbers],
      ["overflowPageNumbers", observation.overflowPageNumbers],
    ] as const) {
      for (const [index, page] of values.entries()) {
        if (page > observation.pageCount) {
          context.addIssue({
            code: "custom",
            path: [field, index],
            message: `${field} must refer to a page in pageCount`,
          });
        }
      }
    }
  });

export type RenderingQaViewerObservation = z.infer<typeof renderingQaViewerObservationSchema>;

/** Render metadata copied into a QA report and checked against the bytes. */
export const renderingQaRenderedMetadataSchema = z.strictObject({
  artifactId: independentReadinessReportNonEmptyString,
  artifactVersion: positiveSafeIntegerSchema,
  format: renderingQaOutputFormatSchema,
  generatedAt: strictTimestampSchema,
  templateVersion: independentReadinessReportNonEmptyString.max(200),
  layoutProfile: renderingLayoutProfileSchema,
  checksum: sha256ChecksumSchema,
  sourceContentChecksum: sha256ChecksumSchema,
});
export type RenderingQaRenderedMetadata = z.infer<typeof renderingQaRenderedMetadataSchema>;

const renderingQaTargetPageCounts: Readonly<Record<RenderingLayoutProfileId, 1 | 2>> = {
  "compact-one-page": 1,
  "standard-two-page": 2,
};

/** Deterministic integrity metrics; this object never contains raw content. */
export const renderingQaContentIntegritySchema = z
  .strictObject({
    expectedVisibleContentChecksum: sha256ChecksumSchema,
    recoveredVisibleContentChecksum: sha256ChecksumSchema,
    expectedVisibleContentCount: nonNegativeSafeIntegerSchema,
    recoveredVisibleContentCount: nonNegativeSafeIntegerSchema,
    visibleContentMatches: z.boolean(),
    sectionOrderMatches: z.boolean(),
    blockOrderMatches: z.boolean(),
    duplicateContentPreserved: z.boolean(),
    punctuationPreserved: z.boolean(),
  })
  .superRefine((integrity, context) => {
    const expectedMatch =
      integrity.expectedVisibleContentChecksum === integrity.recoveredVisibleContentChecksum &&
      integrity.expectedVisibleContentCount === integrity.recoveredVisibleContentCount;
    if (integrity.visibleContentMatches !== expectedMatch) {
      context.addIssue({
        code: "custom",
        path: ["visibleContentMatches"],
        message: "visibleContentMatches must equal the checksum and count comparison",
      });
    }
  });
export type RenderingQaContentIntegrity = z.infer<typeof renderingQaContentIntegritySchema>;

/** Local active-content scan output, represented only by finite signatures. */
export const renderingQaActiveContentSchema = z
  .strictObject({
    detected: z.boolean(),
    signatures: z
      .array(z.enum(renderingQaActiveContentSignatures))
      .superRefine((values, context) => {
        addCanonicalStringArrayIssues(values, context, "active-content signatures");
      }),
  })
  .superRefine((activeContent, context) => {
    if (activeContent.detected !== activeContent.signatures.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["detected"],
        message: "active-content detected must equal whether signatures are present",
      });
    }
  });
export type RenderingQaActiveContent = z.infer<typeof renderingQaActiveContentSchema>;

const renderingQaLimitationsSchema = z
  .array(z.enum(renderingQaLimitationCodes))
  .superRefine((values, context) => {
    const seen = new Set<string>();
    let previousIndex = -1;
    for (const [index, value] of values.entries()) {
      const valueIndex = renderingQaLimitationCodes.indexOf(value);
      if (seen.has(value)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "rendering QA limitations must be unique",
        });
      }
      if (valueIndex <= previousIndex) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "rendering QA limitations must use canonical order",
        });
      }
      seen.add(value);
      previousIndex = valueIndex;
    }
  });

function expectedRenderingQaLimitations(
  rendered: RenderingQaRenderedMetadata,
  deterministicPageCount: number | null,
  viewerObservation: RenderingQaViewerObservation | null,
): readonly RenderingQaLimitationCode[] {
  return [
    ...(rendered.format !== "pdf" || deterministicPageCount === null
      ? ["deterministic-page-count-not-assessed" as const]
      : []),
    ...(rendered.format !== "markdown" && viewerObservation === null
      ? ["independent-viewer-observation-not-run" as const]
      : []),
    "structured-images-unsupported",
    "structured-links-unsupported",
  ];
}

export const renderingQaReportSchema = z
  .strictObject({
    schemaVersion: z.literal(renderingQaReportSchemaVersion),
    artifact: artifactIdentitySchema,
    rendered: renderingQaRenderedMetadataSchema,
    createdAt: strictTimestampSchema,
    contentIntegrity: renderingQaContentIntegritySchema,
    activeContent: renderingQaActiveContentSchema,
    targetPageCount: positiveSafeIntegerSchema,
    deterministicPageCount: positiveSafeIntegerSchema.nullable(),
    viewerObservation: renderingQaViewerObservationSchema.nullable(),
    limitations: renderingQaLimitationsSchema,
    deterministicPassed: z.boolean(),
    complete: z.boolean(),
    passed: z.boolean(),
  })
  .superRefine((report, context) => {
    if (
      report.artifact.id !== report.rendered.artifactId ||
      report.artifact.version !== report.rendered.artifactVersion
    ) {
      context.addIssue({
        code: "custom",
        path: ["artifact"],
        message: "report artifact must match rendered metadata identity",
      });
    }

    const expectedTargetPageCount = renderingQaTargetPageCounts[report.rendered.layoutProfile];
    if (report.targetPageCount !== expectedTargetPageCount) {
      context.addIssue({
        code: "custom",
        path: ["targetPageCount"],
        message: "targetPageCount must equal the selected layout profile target",
      });
    }
    if (Date.parse(report.createdAt) < Date.parse(report.rendered.generatedAt)) {
      context.addIssue({
        code: "custom",
        path: ["createdAt"],
        message: "createdAt must not precede rendered.generatedAt",
      });
    }
    if (report.rendered.format !== "pdf" && report.deterministicPageCount !== null) {
      context.addIssue({
        code: "custom",
        path: ["deterministicPageCount"],
        message: "only PDF reports may include a deterministic page count",
      });
    }

    const observation = report.viewerObservation;
    if (observation !== null && observation.renderedChecksum !== report.rendered.checksum) {
      context.addIssue({
        code: "custom",
        path: ["viewerObservation", "renderedChecksum"],
        message: "viewer observation must bind to the rendered checksum",
      });
    }

    if (
      report.rendered.format === "pdf" &&
      observation !== null &&
      report.deterministicPageCount !== null &&
      observation.pageCount !== report.deterministicPageCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["viewerObservation", "pageCount"],
        message: "PDF viewer pageCount must equal the deterministic page count",
      });
    }

    const expectedLimitations = expectedRenderingQaLimitations(
      report.rendered,
      report.deterministicPageCount,
      observation,
    );
    if (
      report.limitations.length !== expectedLimitations.length ||
      report.limitations.some((limitation, index) => limitation !== expectedLimitations[index])
    ) {
      context.addIssue({
        code: "custom",
        path: ["limitations"],
        message: "rendering QA limitations must exactly match the report state",
      });
    }

    const pageTargetPassed =
      report.rendered.format !== "pdf" ||
      (report.deterministicPageCount !== null &&
        report.deterministicPageCount <= report.targetPageCount);
    const deterministicPassed =
      report.contentIntegrity.visibleContentMatches &&
      report.contentIntegrity.sectionOrderMatches &&
      report.contentIntegrity.blockOrderMatches &&
      report.contentIntegrity.duplicateContentPreserved &&
      report.contentIntegrity.punctuationPreserved &&
      !report.activeContent.detected &&
      pageTargetPassed;
    if (report.deterministicPassed !== deterministicPassed) {
      context.addIssue({
        code: "custom",
        path: ["deterministicPassed"],
        message: "deterministicPassed must equal the deterministic QA result",
      });
    }

    const expectedComplete = report.rendered.format === "markdown" || observation !== null;
    if (report.complete !== expectedComplete) {
      context.addIssue({
        code: "custom",
        path: ["complete"],
        message: "complete must require independent observation for PDF and DOCX",
      });
    }

    let observationPassed = report.rendered.format === "markdown" && observation === null;
    if (observation !== null) {
      observationPassed =
        observation.recoveredVisibleContentChecksum ===
          report.contentIntegrity.expectedVisibleContentChecksum &&
        observation.recoveredVisibleContentCount ===
          report.contentIntegrity.expectedVisibleContentCount &&
        observation.recoveredVisibleContentOrder === "preserved" &&
        (report.rendered.format !== "pdf" ||
          report.deterministicPageCount === null ||
          observation.pageCount === report.deterministicPageCount) &&
        observation.pageCount <= report.targetPageCount &&
        observation.blankPageNumbers.length === 0 &&
        observation.overflowPageNumbers.length === 0 &&
        observation.orphanSectionIds.length === 0 &&
        !observation.clippedText;
    }
    const passed = report.deterministicPassed && report.complete && observationPassed;
    if (report.passed !== passed) {
      context.addIssue({
        code: "custom",
        path: ["passed"],
        message: "passed must equal the deterministic, completeness, and viewer result",
      });
    }
  });

export type RenderingQaReport = z.infer<typeof renderingQaReportSchema>;
