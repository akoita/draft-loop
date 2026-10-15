import { z } from "zod";

import { nonEmptyString } from "./schema-primitives.js";

/*
 * Finding attribution (#1108): which accepted critic finding each revised block was meant to
 * address, and how the next critic pass judged those findings. Everything here is content-free:
 * ids, positional block keys and counts only, never block text or finding messages.
 */

/** Trace versions. Version 1 predates attribution; version 2 requires it. */
export const adjudicatedRevisionTraceSchemaVersions = [1, 2] as const;

const attributionIdSchema = nonEmptyString.max(300);

/** Deterministic cross-round matching key for a finding; see `findingIdentity` in the orchestrator. */
export const findingIdentitySchema = attributionIdSchema;

export const revisionBlockChanges = ["added", "changed", "removed"] as const;
export type RevisionBlockChange = (typeof revisionBlockChanges)[number];

export const revisionFindingSeverities = ["error", "warning"] as const;

const uniqueIds = (ids: readonly string[]): boolean => new Set(ids).size === ids.length;

/** One changed block and the accepted findings it was changed to address. */
export const revisionBlockAttributionSchema = z.strictObject({
  /** Positional key of the block, stable across revisions (artifact ids are not). */
  blockKey: attributionIdSchema,
  /** The block id in the revised artifact, or in the source artifact when the block was removed. */
  blockId: attributionIdSchema,
  change: z.enum(revisionBlockChanges),
  findingIds: z.array(attributionIdSchema).refine(uniqueIds, "finding ids must be unique"),
});

export type RevisionBlockAttribution = z.infer<typeof revisionBlockAttributionSchema>;

/** The matching identity of one adjudicated finding. */
export const revisionFindingIdentitySchema = z.strictObject({
  findingId: attributionIdSchema,
  findingIdentity: findingIdentitySchema,
});

/** Block-level attribution of an adjudicated revision. */
export const adjudicatedRevisionAttributionSchema = z.strictObject({
  /** Every adjudicated finding, accepted or not, so later rounds can match against all of them. */
  findings: z.array(revisionFindingIdentitySchema),
  blocks: z.array(revisionBlockAttributionSchema),
  /** Accepted findings that no changed block could be tied to. */
  unattributedFindingIds: z
    .array(attributionIdSchema)
    .refine(uniqueIds, "finding ids must be unique"),
});

export type AdjudicatedRevisionAttribution = z.infer<typeof adjudicatedRevisionAttributionSchema>;

/** The trace fields that carry attribution; spread into the trace object schema. */
export const revisionAttributionTraceShape = {
  schemaVersion: z.literal(adjudicatedRevisionTraceSchemaVersions),
  attribution: adjudicatedRevisionAttributionSchema.optional(),
};

interface AttributedTraceShape {
  readonly schemaVersion: number;
  readonly attribution?: AdjudicatedRevisionAttribution | undefined;
  readonly adjudication: {
    readonly decisions: readonly { readonly findingId: string; readonly disposition: string }[];
  };
}

/** Superrefine check for the trace: version 2 requires attribution, version 1 forbids it. */
export function checkRevisionAttribution(trace: AttributedTraceShape, context: z.RefinementCtx) {
  const { attribution } = trace;
  const issue = (path: (string | number)[], message: string): void =>
    context.addIssue({ code: "custom", path, message });
  if (trace.schemaVersion === 1) {
    if (attribution !== undefined) issue(["attribution"], "version 1 traces carry no attribution");
    return;
  }
  if (attribution === undefined) {
    issue(["attribution"], "version 2 traces require attribution");
    return;
  }
  const decisionIds = trace.adjudication.decisions.map(({ findingId }) => findingId);
  const accepted = new Set(
    trace.adjudication.decisions
      .filter(({ disposition }) => disposition === "accept")
      .map(({ findingId }) => findingId),
  );
  const attributedIds = attribution.findings.map(({ findingId }) => findingId);
  if (
    !uniqueIds(attributedIds) ||
    attributedIds.length !== decisionIds.length ||
    decisionIds.some((id) => !attributedIds.includes(id))
  ) {
    issue(["attribution", "findings"], "attribution must identify each adjudicated finding once");
  }
  if (!uniqueIds(attribution.blocks.map(({ blockKey }) => blockKey))) {
    issue(["attribution", "blocks"], "attributed block keys must be unique");
  }
  const inBlocks = new Set(attribution.blocks.flatMap(({ findingIds }) => findingIds));
  const unattributed = new Set(attribution.unattributedFindingIds);
  for (const id of [...inBlocks, ...unattributed]) {
    if (!accepted.has(id)) {
      issue(["attribution"], `attributed finding ${id} must be an accepted decision`);
    }
  }
  for (const id of accepted) {
    if (inBlocks.has(id) === unattributed.has(id)) {
      issue(["attribution"], `accepted finding ${id} must be attributed or unattributed, not both`);
    }
  }
}

export const findingClassificationStatuses = ["resolved", "persisting", "new"] as const;
export type FindingClassificationStatus = (typeof findingClassificationStatuses)[number];

/** Version of the content-free finding classification stored on a critic execution. */
export const revisionFindingClassificationSchemaVersion = 1 as const;

/**
 * One classified finding. `findingId` is the adjudicated finding for `resolved` and `persisting`,
 * and the critic-pass finding for `new`. `currentFindingId` names the matching critic-pass finding
 * of a `persisting` entry.
 */
export const classifiedFindingSchema = z
  .strictObject({
    status: z.enum(findingClassificationStatuses),
    findingId: attributionIdSchema,
    findingIdentity: findingIdentitySchema,
    severity: z.enum(revisionFindingSeverities),
    currentFindingId: attributionIdSchema.optional(),
  })
  .superRefine((entry, context) => {
    if ((entry.status === "persisting") !== (entry.currentFindingId !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["currentFindingId"],
        message: "only persisting findings name a current finding",
      });
    }
  });

export type ClassifiedFinding = z.infer<typeof classifiedFindingSchema>;

/** Resolved, persisting and new findings after the critic pass that reviewed a revision. */
export const revisionFindingClassificationSchema = z
  .strictObject({
    schemaVersion: z.literal(revisionFindingClassificationSchemaVersion),
    /** The revised artifact that the critic pass reviewed. */
    reviewedArtifact: z.strictObject({ id: attributionIdSchema, version: z.number().int().min(1) }),
    findings: z.array(classifiedFindingSchema),
    summary: z.strictObject({
      resolved: z.number().int().min(0),
      persisting: z.number().int().min(0),
      new: z.number().int().min(0),
    }),
  })
  .superRefine((classification, context) => {
    for (const status of findingClassificationStatuses) {
      const count = classification.findings.filter((entry) => entry.status === status).length;
      if (classification.summary[status] !== count) {
        context.addIssue({
          code: "custom",
          path: ["summary", status],
          message: `summary ${status} must equal the number of ${status} findings`,
        });
      }
    }
  });

export type RevisionFindingClassification = z.infer<typeof revisionFindingClassificationSchema>;
