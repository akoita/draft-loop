import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import { type CrossEncoder, createOnnxCrossEncoder } from "@draft-loop/embeddings";

import type { RequirementEvidenceMap } from "./requirement-evidence-map.js";

/*
 * Rerank the requirement-evidence map (#3022, finding in #3020). The local cross-encoder reads
 * each requirement with each candidate chunk. On graded runs it ordered supporting chunks above
 * unsupportive ones far more often than cosine similarity, but its absolute scores are low, so it
 * only reorders: every candidate stays. Off by default; a missing or failing model leaves the map
 * as it was.
 */

/** `on` reorders each requirement's candidates by cross-encoder score; anything else leaves it. */
export const requirementEvidenceRerankSetting = "DRAFT_LOOP_EVIDENCE_RERANK";

/** The directory holding the pinned cross-encoder's files. */
export const rerankerModelDirectorySetting = "DRAFT_LOOP_RERANKER_MODEL_DIR";

/** Characters of a requirement or chunk the encoder reads; it truncates to its token limit anyway. */
const maximumCharacters = 20_000;

export function requirementEvidenceRerankEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return (env[requirementEvidenceRerankSetting] ?? "").trim().toLowerCase() === "on";
}

export type RequirementEvidenceRerankStatus = "reranked" | "no-model" | "failed";

export interface RequirementEvidenceRerank {
  readonly status: RequirementEvidenceRerankStatus;
  readonly modelId?: string;
  /** Wall-clock time spent scoring, rounded to the millisecond. */
  readonly durationMs: number;
  /** Requirement-chunk pairs scored. */
  readonly pairCount: number;
}

export interface RerankRequirementEvidenceMapRequest {
  readonly map: RequirementEvidenceMap;
  readonly requirements: readonly { readonly id: string; readonly text: string }[];
  readonly eligible: readonly ScoredEvidenceChunk[];
  /** The opened encoder, or undefined when none is installed. */
  readonly encoder: CrossEncoder | undefined;
  readonly now?: () => number;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Reorders each requirement's candidates by cross-encoder score, best first; ties and chunks
 * without text keep their order. A failure leaves the map's order and says so.
 */
export async function rerankRequirementEvidenceMap(
  request: RerankRequirementEvidenceMapRequest,
): Promise<RequirementEvidenceMap> {
  const { map, encoder } = request;
  const now = request.now ?? (() => performance.now());
  if (encoder === undefined) {
    return Object.freeze({
      ...map,
      rerank: { status: "no-model" as const, durationMs: 0, pairCount: 0 },
    });
  }
  const texts = new Map(request.eligible.map((chunk) => [chunk.id, chunk.text]));
  const requirementTexts = new Map(request.requirements.map(({ id, text }) => [id, text]));
  const started = now();
  let pairCount = 0;
  try {
    const entries = [];
    for (const entry of map.entries) {
      const query = requirementTexts.get(entry.requirementId)?.trim() ?? "";
      const scorable = entry.candidates
        .map((candidate, index) => ({ candidate, index, text: texts.get(candidate.chunkId) }))
        .filter(
          (item): item is typeof item & { text: string } =>
            item.text !== undefined && item.text.trim() !== "",
        );
      if (query === "" || scorable.length < 2) {
        entries.push(entry);
        continue;
      }
      const scores = await encoder.score(
        query.slice(0, maximumCharacters),
        scorable.map(({ text }) => text.slice(0, maximumCharacters)),
      );
      pairCount += scorable.length;
      const scoreOf = new Map(scorable.map(({ index }, position) => [index, scores[position]]));
      const ordered = entry.candidates
        .map((candidate, index) => ({
          candidate,
          index,
          score: scoreOf.get(index) ?? Number.NEGATIVE_INFINITY,
        }))
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .map(({ candidate }) => candidate);
      entries.push({ requirementId: entry.requirementId, candidates: ordered });
    }
    return Object.freeze({
      ...map,
      entries,
      rerank: {
        status: "reranked" as const,
        modelId: encoder.identity.modelId,
        durationMs: Math.round(now() - started),
        pairCount,
      },
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    return Object.freeze({
      ...map,
      rerank: {
        status: "failed" as const,
        modelId: encoder.identity.modelId,
        durationMs: Math.round(now() - started),
        pairCount,
      },
    });
  }
}

export type CrossEncoderOpener = (modelDirectory: string) => Promise<CrossEncoder>;

const sharedEncoders = new Map<string, Promise<CrossEncoder | undefined>>();

/**
 * The process-shared cross-encoder for a model directory, or undefined when the setting names no
 * directory or the model cannot be opened. A failed open is not cached, so a later run retries.
 */
export function openRunCrossEncoder(
  options: { readonly modelDirectory?: string; readonly open?: CrossEncoderOpener } = {},
): Promise<CrossEncoder | undefined> {
  const modelDirectory =
    options.modelDirectory ?? process.env[rerankerModelDirectorySetting]?.trim() ?? "";
  if (modelDirectory === "") return Promise.resolve(undefined);
  const open =
    options.open ?? ((directory) => createOnnxCrossEncoder({ modelDirectory: directory }));
  if (options.open !== undefined) return open(modelDirectory).catch(() => undefined);
  const cached = sharedEncoders.get(modelDirectory);
  if (cached !== undefined) return cached;
  const pending = open(modelDirectory).catch(() => {
    sharedEncoders.delete(modelDirectory);
    return undefined;
  });
  sharedEncoders.set(modelDirectory, pending);
  return pending;
}

/** One preflight clause: whether the map was reordered by the local reranker. */
export function requirementEvidenceRerankClause(rerank: RequirementEvidenceRerank): string {
  switch (rerank.status) {
    case "reranked":
      return `, reordered by the local reranker in ${(rerank.durationMs / 1000).toFixed(1)} s`;
    case "failed":
      return ", not reordered (the local reranker failed)";
    default:
      return ", not reordered (no local reranker is installed)";
  }
}
