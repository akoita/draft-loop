import type { ContextSnapshot, ScoredEvidenceChunk } from "@draft-loop/domain";
import type { PreferredRequirementEvidence } from "./requirement-achievement-plan.js";
import type { GradedRequirementEvidenceMap } from "./requirement-evidence-grade.js";

import {
  buildRequirementEvidenceMap,
  type RequirementEvidenceMap,
} from "./requirement-evidence-map.js";
import {
  openRunEmbedder,
  type RunSemanticRetrievalOptions,
  runEmbeddingModelRoot,
} from "./run-semantic-retrieval.js";

/** Where a run uses its requirement-evidence map; each use is off unless the setting names it. */
export const requirementEvidenceMapUseSetting = "DRAFT_LOOP_EVIDENCE_MAP";

export const requirementEvidenceMapUses = ["fallback", "writer", "critic"] as const;
export type RequirementEvidenceMapUse = (typeof requirementEvidenceMapUses)[number];

/** The uses named in the setting, a comma-separated list such as `fallback,writer`. */
export function enabledRequirementEvidenceMapUses(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ReadonlySet<RequirementEvidenceMapUse> {
  const named = new Set(
    (env[requirementEvidenceMapUseSetting] ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase()),
  );
  return new Set(requirementEvidenceMapUses.filter((use) => named.has(use)));
}

/**
 * The writer's preferred evidence (#2983): each requirement's map candidates, best first, when
 * the setting names the `writer` use and the run builds a map. Undefined otherwise.
 */
export function preferredEvidenceFromMap(
  requirementEvidenceMap: (() => Promise<RequirementEvidenceMap | undefined>) | undefined,
  enabled: boolean = enabledRequirementEvidenceMapUses().has("writer"),
): (() => Promise<PreferredRequirementEvidence | undefined>) | undefined {
  if (!enabled || requirementEvidenceMap === undefined) return undefined;
  return async () => {
    const map = await requirementEvidenceMap();
    return map === undefined
      ? undefined
      : new Map(
          map.entries.map(({ requirementId, candidates }) => [
            requirementId,
            candidates.map(({ chunkId }) => chunkId),
          ]),
        );
  };
}

/**
 * The critic's view of the map (#2983): each requirement's candidates, best first, when the setting
 * names the `critic` use and the run builds a map. Undefined otherwise.
 */
export function criticEvidenceFromMap(
  requirementEvidenceMap: (() => Promise<RequirementEvidenceMap | undefined>) | undefined,
  enabled: boolean = enabledRequirementEvidenceMapUses().has("critic"),
): (() => Promise<PreferredRequirementEvidence | undefined>) | undefined {
  return preferredEvidenceFromMap(requirementEvidenceMap, enabled);
}

/** The map's candidates without the pairs the run's grade said do not support the requirement. */
export function withoutUnsupportedEvidence(
  evidence: PreferredRequirementEvidence,
  graded: GradedRequirementEvidenceMap | undefined,
): PreferredRequirementEvidence {
  if (graded === undefined) return evidence;
  const unsupported = new Set(
    graded.entries.flatMap(({ requirementId, candidates }) =>
      candidates
        .filter(({ grade }) => grade === "does-not-support")
        .map(({ chunkId }) => `${requirementId}\u0000${chunkId}`),
    ),
  );
  return new Map(
    [...evidence].map(([requirementId, chunkIds]) => [
      requirementId,
      chunkIds.filter((chunkId) => !unsupported.has(`${requirementId}\u0000${chunkId}`)),
    ]),
  );
}

export interface RequirementEvidenceMapRuntime {
  /** Every eligible chunk of the pinned sources; empty when the run does not use full source. */
  readonly fullSourceEvidence: () => Promise<readonly ScoredEvidenceChunk[]>;
}

export type RunRequirementEvidenceMapOptions = Pick<
  RunSemanticRetrievalOptions,
  "tier" | "modelService" | "createEmbedder" | "shareEmbedder" | "relevanceFloor"
> & { readonly modelRoot?: string };

/**
 * Give a run's retrieval a memoized requirement-evidence map (#2981). The map is built once, from
 * the same eligible chunks full source sends, with the process-shared local embedder when one is
 * installed. It is undefined when the job has no requirements or the run has no eligible chunks.
 */
export function withRequirementEvidenceMap<Runtime extends RequirementEvidenceMapRuntime>(
  runtime: Runtime,
  context: Pick<ContextSnapshot, "requirements">,
  options: RunRequirementEvidenceMapOptions,
): Runtime & {
  readonly requirementEvidenceMap: () => Promise<RequirementEvidenceMap | undefined>;
} {
  let map: Promise<RequirementEvidenceMap | undefined> | undefined;
  const requirementEvidenceMap = () => {
    map ??= (async () => {
      const requirements = (context.requirements ?? []).map(({ id, text }) => ({ id, text }));
      if (requirements.length === 0) return undefined;
      const eligible = await runtime.fullSourceEvidence();
      if (eligible.length === 0) return undefined;
      const opened = await openRunEmbedder({
        tier: options.tier,
        modelRoot: options.modelRoot ?? runEmbeddingModelRoot(),
        ...(options.modelService === undefined ? {} : { modelService: options.modelService }),
        ...(options.createEmbedder === undefined ? {} : { createEmbedder: options.createEmbedder }),
        ...(options.shareEmbedder === undefined ? {} : { shareEmbedder: options.shareEmbedder }),
      }).catch(() => ({ ok: false as const }));
      return buildRequirementEvidenceMap({
        requirements,
        eligible,
        ...(opened.ok ? { embedder: opened.embedder } : { unavailableReason: "no-model" as const }),
        ...(options.relevanceFloor === undefined ? {} : { floor: options.relevanceFloor }),
      });
    })();
    return map;
  };
  return { ...runtime, requirementEvidenceMap };
}
