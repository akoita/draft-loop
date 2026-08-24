import type { CandidateKnowledgeSelectionSnapshotInput } from "@draft-loop/domain";
import {
  candidateKnowledgeBaseStates,
  candidateKnowledgeRetentionClasses,
  candidateKnowledgeRetentionOverrideKinds,
  candidateKnowledgeRetentionRules,
  candidateKnowledgeSelectionLifecycleObservationStatuses,
  candidateKnowledgeSelectionSnapshotSchemaVersion,
  candidateKnowledgeSourceKinds,
  candidateKnowledgeSourceRetirementReasons,
  candidateKnowledgeStoreSchemaVersion,
  contextSchemaVersion,
  createCandidateKnowledgeSelectionSnapshot,
  deriveModelLineage,
  maximumIndependenceOverrideRationaleLength,
  maximumModelLineageLength,
  outputFormats,
  readinessDimensions,
  requirementPriorities,
} from "@draft-loop/domain";
import { z } from "zod";

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

export const evidenceSourceSchema = z.object({
  id: nonEmptyString,
  path: nonEmptyString,
  mediaType: nonEmptyString,
  checksum: checksumSchema,
  profileId: nonEmptyString.optional(),
});

export type EvidenceSource = z.infer<typeof evidenceSourceSchema>;

export const writingPolicySchema = z.object({
  content: nonEmptyString,
  checksum: z.string().regex(/^[a-f0-9]{64}$/iu, "must be a SHA-256 checksum"),
  version: nonEmptyString,
});

export type WritingPolicy = z.infer<typeof writingPolicySchema>;

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
export { outputFormats, readinessDimensions, requirementPriorities };

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
