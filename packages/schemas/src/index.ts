import { z } from "zod";

export const workspaceInputSchema = z.object({
  jobDescription: z.string().min(1),
  language: z.string().min(1),
  instructions: z.string().default(""),
  truthfulnessPolicy: z.string().default("Do not add unsupported claims."),
});

export type WorkspaceInput = z.infer<typeof workspaceInputSchema>;

export const readinessRubricSchema = z.object({
  relevance: z.number().min(0).max(1),
  evidence: z.number().min(0).max(1),
  accuracy: z.number().min(0).max(1),
  differentiation: z.number().min(0).max(1),
  clarity: z.number().min(0).max(1),
  format: z.number().min(0).max(1),
  credibility: z.number().min(0).max(1),
});

export type ReadinessRubric = z.infer<typeof readinessRubricSchema>;
