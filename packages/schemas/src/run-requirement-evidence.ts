import { z } from "zod";

/*
 * Which evidence supports each job requirement of a run (#3009, #2984): the run's
 * requirement-evidence map read back from its audit events. It holds ids, source names, line
 * ranges, origins, scores and grades, never evidence text or the grader's reasons.
 */

export const requirementEvidenceOrigins = ["semantic", "keyword", "both"] as const;
export const requirementEvidenceGradeValues = [
  "supports",
  "partly-supports",
  "does-not-support",
] as const;

export const runRequirementEvidenceCandidateSchema = z
  .object({
    chunkId: z.string().min(1),
    origin: z.enum(requirementEvidenceOrigins),
    /** Cosine similarity, rounded; absent for a keyword-only candidate. */
    score: z.number().min(-1).max(1).optional(),
    /** The source's name as the run recorded it; absent for a run recorded before #3009. */
    source: z.string().min(1).optional(),
    lineStart: z.number().int().nonnegative().optional(),
    lineEnd: z.number().int().nonnegative().optional(),
    grade: z.enum(requirementEvidenceGradeValues).optional(),
  })
  .strict();
export type RunRequirementEvidenceCandidate = z.infer<typeof runRequirementEvidenceCandidateSchema>;

export const runRequirementEvidenceSchema = z
  .object({
    runId: z.string().min(1),
    /** `semantic` when the local model ranked by meaning, `keyword` otherwise. */
    mode: z.enum(["semantic", "keyword"]),
    /** Why the map is keyword-only: no-model, uncalibrated-model or embedding-failed. */
    reason: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
    chunkCount: z.number().int().nonnegative(),
    /** `graded` or `failed` when the run graded the map; absent when it did not. */
    grading: z.enum(["graded", "failed"]).optional(),
    requirements: z.array(
      z
        .object({
          requirementId: z.string().min(1),
          /** The requirement's text from the run's job, when the run recorded it. */
          text: z.string().optional(),
          candidates: z.array(runRequirementEvidenceCandidateSchema),
        })
        .strict(),
    ),
  })
  .strict();
export type RunRequirementEvidence = z.infer<typeof runRequirementEvidenceSchema>;
