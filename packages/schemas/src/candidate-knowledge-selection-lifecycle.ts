import {
  candidateKnowledgeBaseStates,
  candidateKnowledgeSelectionLifecycleObservationStatuses,
} from "@draft-loop/domain";
import { z } from "zod";

import { nonEmptyString, strictTimestampSchema } from "./schema-primitives.js";

export const candidateKnowledgeSelectionLifecycleObservationSchema = z.object({
  observedVersionId: nonEmptyString,
  status: z.enum(candidateKnowledgeSelectionLifecycleObservationStatuses),
  checkedAt: strictTimestampSchema,
  lastRefreshedVersionId: nonEmptyString.nullable(),
  lastRefreshedAt: strictTimestampSchema.nullable(),
  stale: z.boolean(),
});

export const candidateKnowledgeSelectionLifecycleRetirementSchema = z.object({
  retiredAt: strictTimestampSchema,
  reason: z.literal("user-requested"),
});

export const candidateKnowledgeSelectionLifecycleDirectorySchema = z.object({
  directoryId: nonEmptyString,
  rootRevision: z.number().finite().int().positive(),
  rootBoundAt: strictTimestampSchema,
  memberRevision: z.number().finite().int().positive(),
  memberBoundAt: strictTimestampSchema,
});

export const candidateKnowledgeSelectionLifecycleRevisionSchema = z.object({
  knowledgeBaseState: z.enum(candidateKnowledgeBaseStates),
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
