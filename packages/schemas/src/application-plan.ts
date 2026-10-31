import { z } from "zod";

import { nonEmptyString } from "./schema-primitives.js";

/*
 * The application plan (#1304): a short, structured decision on what the CV should lead with,
 * made before the first draft. It is guidance for the author, never evidence. Every accomplishment
 * it names is an id of approved evidence in the same request, so the plan carries no facts of its
 * own; a central theme the evidence does not support is a gap, not something to claim.
 *
 * The plan holds concise, user-visible text only (theme titles, one-line rationale, moves), not
 * reasoning transcripts.
 */

export const minimumApplicationPlanThemes = 3;
export const maximumApplicationPlanThemes = 5;
export const minimumApplicationPlanCoreAreas = 3;
export const maximumApplicationPlanCoreAreas = 5;
export const maximumApplicationPlanCuts = 6;
export const maximumApplicationPlanReviewPoints = 5;

const shortText = (maximum: number) => z.string().min(1).max(maximum);
const themeRank = z.number().int().min(1).max(maximumApplicationPlanThemes);

export const applicationPlanThemeSchema = z
  .strictObject({
    /** A short name for the theme, in the job's own terms. */
    title: shortText(120),
    /** One user-visible sentence on why the job centres on it. */
    rationale: shortText(300),
    /** The requirement or responsibility ids of the context that carry the theme. */
    requirementIds: z.array(nonEmptyString).max(8),
    /** The approved evidence ids whose accomplishments best prove the theme; empty for a gap. */
    evidenceChunkIds: z.array(nonEmptyString).max(6),
    /** True when no approved evidence supports the theme: tell the candidate, never claim it. */
    gap: z.boolean(),
  })
  .superRefine((theme, context) => {
    if (theme.gap && theme.evidenceChunkIds.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["evidenceChunkIds"],
        message: "a gap theme has no supporting evidence",
      });
    }
    if (!theme.gap && theme.evidenceChunkIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["evidenceChunkIds"],
        message: "a supported theme cites the evidence that proves it",
      });
    }
  });
export type ApplicationPlanTheme = z.infer<typeof applicationPlanThemeSchema>;

export const applicationPlanCutActions = ["drop", "compress"] as const;

export const applicationPlanSchema = z.strictObject({
  /** The job's central themes, most important first. */
  themes: z
    .array(applicationPlanThemeSchema)
    .min(minimumApplicationPlanThemes)
    .max(maximumApplicationPlanThemes),
  /** What the CV leads with. */
  leads: z.strictObject({
    summaryAngle: shortText(300),
    coreAreas: z
      .array(
        z.strictObject({
          text: shortText(120),
          /** The 1-based rank of the supported theme the core area serves. */
          themeRank,
        }),
      )
      .min(minimumApplicationPlanCoreAreas)
      .max(maximumApplicationPlanCoreAreas),
  }),
  /** What to drop or compress, such as a long certification list or a role the job ignores. */
  cuts: z
    .array(
      z.strictObject({
        action: z.enum(applicationPlanCutActions),
        target: shortText(160),
        reason: shortText(200),
      }),
    )
    .max(maximumApplicationPlanCuts),
});
export type ApplicationPlan = z.infer<typeof applicationPlanSchema>;

export const applicationPlanReviewVerdicts = ["accept", "revise"] as const;

export const applicationPlanReviewSchema = z
  .strictObject({
    verdict: z.enum(applicationPlanReviewVerdicts),
    /** Specific points for the author; a revise carries at least one. */
    points: z
      .array(
        z.strictObject({
          text: shortText(240),
          /** The 1-based rank of the theme the point concerns, or null for the plan as a whole. */
          themeRank: themeRank.nullable(),
        }),
      )
      .max(maximumApplicationPlanReviewPoints),
  })
  .superRefine((review, context) => {
    if (review.verdict === "revise" && review.points.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["points"],
        message: "a revise names what to change",
      });
    }
  });
export type ApplicationPlanReview = z.infer<typeof applicationPlanReviewSchema>;

export const applicationPlanStepNames = ["plan", "review", "revision"] as const;
export type ApplicationPlanStepName = (typeof applicationPlanStepNames)[number];

/** Content-free record of one provider call of the plan step, so its cost is counted. */
export const applicationPlanStepRecordSchema = z.strictObject({
  step: z.enum(applicationPlanStepNames),
  provider: nonEmptyString,
  modelId: nonEmptyString,
  /** The endpoint that served the call; absent on runs that predate route identity. */
  route: nonEmptyString.optional(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  /** Prompt-cache reads and writes the provider reported (#1986); absent when it reported none. */
  cachedInputTokens: z.number().int().nonnegative().optional(),
  cacheWriteInputTokens: z.number().int().nonnegative().optional(),
  estimatedUsd: z.number().nonnegative().nullable(),
  completedAt: nonEmptyString,
  /**
   * On a revision the plan checks rejected, which checks failed: issue codes and paths, never
   * text. The reviewed plan then stands as the revision.
   */
  rejectedDiagnostics: z
    .array(z.strictObject({ code: nonEmptyString, path: z.string() }))
    .min(1)
    .max(10)
    .optional(),
});
export type ApplicationPlanStepRecord = z.infer<typeof applicationPlanStepRecordSchema>;

/**
 * The plan step of a run: the author's plan, the critic's review, and at most one revision.
 * Persisted after each call so a run resumes where it stopped. Lists, not maps keyed by data.
 */
export const applicationPlanStateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  plan: applicationPlanSchema,
  review: applicationPlanReviewSchema.nullable(),
  revisedPlan: applicationPlanSchema.nullable(),
  steps: z.array(applicationPlanStepRecordSchema).max(3),
});
export type ApplicationPlanState = z.infer<typeof applicationPlanStateSchema>;

/** The review is in and, when it asked for changes, the one revision is done. */
export function isApplicationPlanComplete(state: ApplicationPlanState | null | undefined): boolean {
  if (state === null || state === undefined || state.review === null) return false;
  return state.review.verdict === "accept" || state.revisedPlan !== null;
}

/** The plan the author drafts from: the revision when there is one. */
export function guidingApplicationPlan(state: ApplicationPlanState): ApplicationPlan {
  return state.revisedPlan ?? state.plan;
}

/** The themes the plan names as gaps, in rank order. */
export function applicationPlanGaps(plan: ApplicationPlan): readonly ApplicationPlanTheme[] {
  return plan.themes.filter(({ gap }) => gap);
}

export type ApplicationPlanIssueCode =
  | "unknown-evidence-id"
  | "unknown-requirement-id"
  | "core-area-theme-out-of-range"
  | "core-area-on-gap-theme"
  | "review-point-theme-out-of-range";

export interface ApplicationPlanIssue {
  readonly code: ApplicationPlanIssueCode;
  readonly path: string;
}

export interface ApplicationPlanReferences {
  /** The approved evidence ids of this request. */
  readonly evidenceChunkIds: Iterable<string>;
  /** The requirement ids of the run's context. */
  readonly requirementIds: Iterable<string>;
}

/**
 * Check a plan against the request it was made for. An evidence or requirement id the request does
 * not hold is rejected, and a core area may not serve a gap, so the plan cannot lead the author to
 * claim what the evidence lacks.
 */
export function validateApplicationPlan(
  plan: ApplicationPlan,
  references: ApplicationPlanReferences,
): readonly ApplicationPlanIssue[] {
  const evidence = new Set(references.evidenceChunkIds);
  const requirements = new Set(references.requirementIds);
  const issues: ApplicationPlanIssue[] = [];
  plan.themes.forEach((theme, index) => {
    theme.evidenceChunkIds.forEach((id, at) => {
      if (!evidence.has(id)) {
        issues.push({
          code: "unknown-evidence-id",
          path: `themes.${index}.evidenceChunkIds.${at}`,
        });
      }
    });
    theme.requirementIds.forEach((id, at) => {
      if (!requirements.has(id)) {
        issues.push({
          code: "unknown-requirement-id",
          path: `themes.${index}.requirementIds.${at}`,
        });
      }
    });
  });
  plan.leads.coreAreas.forEach(({ themeRank: rank }, index) => {
    const theme = plan.themes[rank - 1];
    if (theme === undefined) {
      issues.push({ code: "core-area-theme-out-of-range", path: `leads.coreAreas.${index}` });
    } else if (theme.gap) {
      issues.push({ code: "core-area-on-gap-theme", path: `leads.coreAreas.${index}` });
    }
  });
  return issues;
}

/** Check that a review's points name themes the plan has. */
export function validateApplicationPlanReview(
  review: ApplicationPlanReview,
  plan: ApplicationPlan,
): readonly ApplicationPlanIssue[] {
  return review.points.flatMap(({ themeRank: rank }, index) =>
    rank !== null && rank > plan.themes.length
      ? [{ code: "review-point-theme-out-of-range" as const, path: `points.${index}` }]
      : [],
  );
}

function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _metadata, ...value } = z.toJSONSchema(schema, { target: "draft-7" });
  return value;
}

export const applicationPlanJsonSchema = jsonSchemaOf(applicationPlanSchema);
export const applicationPlanReviewJsonSchema = jsonSchemaOf(applicationPlanReviewSchema);

/** Narrow every evidence and requirement id list to the ids of this exact request. */
export function applicationPlanJsonSchemaForReferences(
  schema: Record<string, unknown>,
  references: {
    readonly evidenceChunkIds: readonly string[];
    readonly requirementIds: readonly string[];
  },
): Record<string, unknown> {
  const evidence = [...new Set(references.evidenceChunkIds)];
  const requirements = [...new Set(references.requirementIds)];
  const narrow = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(narrow);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const record = value as Record<string, unknown>;
    const properties = record.properties;
    if (typeof properties === "object" && properties !== null) {
      for (const [name, allowed] of [
        ["evidenceChunkIds", evidence],
        ["requirementIds", requirements],
      ] as const) {
        const list = (properties as Record<string, unknown>)[name];
        if (allowed.length > 0 && typeof list === "object" && list !== null) {
          (list as Record<string, unknown>).items = { type: "string", enum: allowed };
        }
      }
    }
    Object.values(record).forEach(narrow);
  };
  const narrowed = structuredClone(schema);
  narrow(narrowed);
  return narrowed;
}
