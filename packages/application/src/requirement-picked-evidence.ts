import type { ContextSnapshot, RetrievalPort, ScoredEvidenceChunk } from "@draft-loop/domain";

import type { EvidenceModeDecision } from "./full-source-evidence.js";
import type { RequirementEvidenceMap } from "./requirement-evidence-map.js";

/**
 * Requirement-picked evidence (#2667, #2907): what a run sends when its full source passes the
 * workspace cost cap or the models' context budget. Retrieval's composed excerpts stay as they
 * are, reserved contact, chronology and priority evidence included. The room left under the cap or
 * budget is then filled with the eligible chunks that best match each job requirement, so a large
 * collection is cut to what the job asks for instead of to a fixed twenty excerpts. Selection is
 * local and deterministic: no model call.
 */

/** Most chunks one requirement may add; the cap in characters is the other bound. */
export const maximumPicksPerRequirement = 8;

const minimumTokenLength = 3;

/** Case-folded letter and digit runs without diacritics, as lexical retrieval tokenizes text. */
function tokens(text: string): ReadonlySet<string> {
  return new Set(
    (
      text
        .normalize("NFD")
        .replace(/\p{M}+/gu, "")
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu) ?? []
    ).filter((token) => token.length >= minimumTokenLength),
  );
}

interface PickCandidate {
  readonly chunk: ScoredEvidenceChunk;
  readonly index: number;
  readonly words: ReadonlySet<string>;
}

/** Candidates sharing a word with the requirement, best first; rare words count more. */
function rankedCandidates(
  candidates: readonly PickCandidate[],
  requirement: string,
): readonly PickCandidate[] {
  const documentFrequency = new Map<string, number>();
  for (const { words } of candidates) {
    for (const word of words) documentFrequency.set(word, (documentFrequency.get(word) ?? 0) + 1);
  }
  const weight = (word: string) =>
    Math.log(1 + candidates.length / (documentFrequency.get(word) ?? candidates.length));
  const wanted = [...tokens(requirement)].filter((word) => documentFrequency.has(word));
  return candidates
    .map((candidate) => ({
      candidate,
      score: wanted.reduce(
        (sum, word) => (candidate.words.has(word) ? sum + weight(word) : sum),
        0,
      ),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.candidate.index - right.candidate.index)
    .map(({ candidate }) => candidate);
}

/**
 * The chunks that share a word with one requirement, best first, rare words counting more. The
 * requirement-evidence map uses it for its keyword candidates.
 */
export function rankRequirementEvidence(
  eligible: readonly ScoredEvidenceChunk[],
  requirement: string,
): readonly ScoredEvidenceChunk[] {
  const candidates = eligible.map((chunk, index) => ({ chunk, index, words: tokens(chunk.text) }));
  return rankedCandidates(candidates, requirement).map(({ chunk }) => chunk);
}

export interface PickRequirementEvidenceRequest {
  /** Every eligible chunk, in the order full source would send them. */
  readonly eligible: readonly ScoredEvidenceChunk[];
  /** Evidence already selected; its ids are never picked again. */
  readonly selected: readonly ScoredEvidenceChunk[];
  readonly requirements: readonly string[];
  /** Serialized characters the picks may add. */
  readonly budgetCharacters: number;
  /**
   * Each requirement's chunk ids, best first, from the requirement-evidence map (#2983). When
   * given, they replace the shared-word rankings; ids that are not eligible are skipped.
   */
  readonly rankings?: readonly (readonly string[])[];
}

/**
 * The chunks to add, in eligible order. Each requirement ranks the chunks that share a word with
 * it, rare words counting more, and the requirements take turns so that none crowds out another.
 */
export function pickRequirementEvidence(
  request: PickRequirementEvidenceRequest,
): readonly ScoredEvidenceChunk[] {
  const selectedIds = new Set(request.selected.map(({ id }) => id));
  const candidates = request.eligible
    .map((chunk, index) => ({ chunk, index, words: tokens(chunk.text) }))
    .filter(({ chunk }) => !selectedIds.has(chunk.id));
  if (candidates.length === 0 || request.budgetCharacters <= 0) return [];

  const byId = new Map(candidates.map((candidate) => [candidate.chunk.id, candidate]));
  const rankings =
    request.rankings === undefined
      ? request.requirements.map((requirement) =>
          rankedCandidates(candidates, requirement).slice(0, maximumPicksPerRequirement),
        )
      : request.rankings.map((ids) =>
          ids
            .flatMap((id) => {
              const candidate = byId.get(id);
              return candidate === undefined ? [] : [candidate];
            })
            .slice(0, maximumPicksPerRequirement),
        );

  const picked = new Map<string, (typeof candidates)[number]>();
  let remaining = request.budgetCharacters;
  for (let turn = 0; turn < maximumPicksPerRequirement; turn += 1) {
    for (const ranking of rankings) {
      const candidate = ranking[turn];
      if (candidate === undefined || picked.has(candidate.chunk.id)) continue;
      // One more array element costs its serialized form and a separating comma.
      const cost = JSON.stringify(candidate.chunk).length + 1;
      if (cost > remaining) continue;
      picked.set(candidate.chunk.id, candidate);
      remaining -= cost;
    }
  }
  return [...picked.values()]
    .sort((left, right) => left.index - right.index)
    .map(({ chunk }) => chunk);
}

export interface RequirementPickedRuntime {
  readonly port: RetrievalPort;
  readonly evidenceModeDecision: () => Promise<EvidenceModeDecision>;
  /** Every eligible chunk of the pinned sources, as full source would send them. */
  readonly fullSourceEvidence: () => Promise<readonly ScoredEvidenceChunk[]>;
  /** The run's requirement-evidence map, when the run builds one (#2981). */
  readonly requirementEvidenceMap?: () => Promise<RequirementEvidenceMap | undefined>;
}

export interface RequirementPickedOptions {
  /** Rank the picks with the requirement-evidence map instead of shared words (#2983). */
  readonly useEvidenceMap?: boolean;
}

/** Each requirement's map candidates in requirement order, or undefined to rank by words. */
async function mapRankings(
  runtime: RequirementPickedRuntime,
  options: RequirementPickedOptions,
): Promise<readonly (readonly string[])[] | undefined> {
  if (options.useEvidenceMap !== true || runtime.requirementEvidenceMap === undefined) {
    return undefined;
  }
  const map = await runtime.requirementEvidenceMap();
  return map?.entries.map(({ candidates }) => candidates.map(({ chunkId }) => chunkId));
}

/**
 * Wrap a run's retrieval so a cost-cap or budget fallback sends requirement-picked evidence, and
 * no role or project the job asks about is left with nothing. Full source, a run that asked for
 * retrieval, and a source with no eligible chunks pass through unchanged.
 */
export function withRequirementPickedEvidence<Runtime extends RequirementPickedRuntime>(
  runtime: Runtime,
  context: Pick<ContextSnapshot, "requirements">,
  pickOptions: RequirementPickedOptions = {},
): Runtime {
  const port: RetrievalPort = {
    queryEvidence: async (text, options) => {
      const selected = await runtime.port.queryEvidence(text, options);
      const decision = await runtime.evidenceModeDecision();
      if (
        decision.fallbackReason !== "cost-cap-exceeded" &&
        decision.fallbackReason !== "budget-exceeded"
      ) {
        return selected;
      }
      const requirements = (context.requirements ?? []).map((requirement) => requirement.text);
      const rankings = await mapRankings(runtime, pickOptions);
      const picks = pickRequirementEvidence({
        eligible: await runtime.fullSourceEvidence(),
        selected,
        requirements: requirements.length === 0 ? [text] : requirements,
        budgetCharacters: decision.budgetCharacters - JSON.stringify(selected).length,
        ...(rankings === undefined ? {} : { rankings }),
      });
      return picks.length === 0 ? selected : [...selected, ...picks];
    },
  };
  return { ...runtime, port };
}
