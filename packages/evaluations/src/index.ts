export const readinessDimensions = [
  "relevance",
  "evidence",
  "accuracy",
  "differentiation",
  "clarity",
  "format",
  "credibility",
] as const;

export type ReadinessDimension = (typeof readinessDimensions)[number];

export interface ReadinessScore {
  readonly dimension: ReadinessDimension;
  readonly score: number;
  readonly rationale: string;
}
