export type EmbeddingModelUnavailableReason = "missing-file" | "size-mismatch";

/** A pinned model file is absent or does not have the manifest size. */
export class EmbeddingModelUnavailableError extends Error {
  readonly reason: EmbeddingModelUnavailableReason;
  /** Path relative to the model directory; never the absolute location. */
  readonly relativePath: string;

  constructor(reason: EmbeddingModelUnavailableReason, relativePath: string) {
    super(
      reason === "missing-file"
        ? `Embedding model file is missing: ${relativePath}`
        : `Embedding model file has an unexpected size: ${relativePath}`,
    );
    this.name = "EmbeddingModelUnavailableError";
    this.reason = reason;
    this.relativePath = relativePath;
  }
}

export type EmbeddingInputProblem = "blank" | "too-long";

/** An input text cannot be embedded. Carries the index, never the text. */
export class EmbeddingInputError extends Error {
  readonly index: number;
  readonly problem: EmbeddingInputProblem;

  constructor(index: number, problem: EmbeddingInputProblem, maxCharacters?: number) {
    super(
      problem === "blank"
        ? `Text at index ${index} is empty or whitespace-only.`
        : `Text at index ${index} exceeds the ${maxCharacters ?? "configured"} character limit.`,
    );
    this.name = "EmbeddingInputError";
    this.index = index;
    this.problem = problem;
  }
}
