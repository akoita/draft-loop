import {
  contextSchemaVersion,
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

const timestampSchema = nonEmptyString.refine(
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
});

export type EvidenceSource = z.infer<typeof evidenceSourceSchema>;

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
});

export type ModelSelection = z.infer<typeof modelSelectionSchema>;

export const modelConfigurationSchema = z
  .object({
    author: modelSelectionSchema,
    critic: modelSelectionSchema,
    requireProviderDiversity: z.boolean().default(true),
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
      configuration.author.company === configuration.critic.company
    ) {
      context.addIssue({
        code: "custom",
        path: ["critic", "company"],
        message: "author and critic must use different model companies in cross-company mode",
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
  readinessRubric: readinessRubricSchema,
  evidenceManifest: z.array(evidenceSourceSchema).min(1),
  modelConfiguration: modelConfigurationSchema,
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
  readinessRubric: readinessRubricSchema,
  evidenceManifest: z.array(evidenceSourceSchema).min(1),
  modelConfiguration: modelConfigurationSchema,
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
