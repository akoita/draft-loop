export type EmbeddingRole = "query" | "document";

export interface EmbeddingModelIdentity {
  readonly modelId: string;
  readonly sourceRepository: string;
  readonly revision: string;
  readonly modelFileSha256: string;
  readonly dimensions: number;
  readonly pooling: "cls" | "mean";
  readonly runtime: string;
}

export interface EmbedOptions {
  readonly signal?: AbortSignal;
}

/** Provider-independent port that turns text into L2-normalized vectors. */
export interface TextEmbedder {
  readonly identity: EmbeddingModelIdentity;
  embed(
    texts: readonly string[],
    role: EmbeddingRole,
    options?: EmbedOptions,
  ): Promise<Float32Array[]>;
  dispose(): Promise<void>;
}
