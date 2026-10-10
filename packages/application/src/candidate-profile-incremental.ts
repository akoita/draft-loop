import type {
  CandidateKnowledgeSelectionSnapshot,
  CanonicalCandidateProfileExtractionIdentity,
  CanonicalCandidateProfileSensitivityIdentity,
} from "@draft-loop/domain";
import {
  type SourceSensitivityTier,
  sourceSensitivityTiers,
} from "@draft-loop/domain/source-sensitivity";
import type {
  CanonicalCandidateProfileFact,
  CanonicalCandidateProfileIssue,
  CanonicalCandidateProfileProvenanceReference,
} from "@draft-loop/schemas";
import type { CanonicalCandidateProfileVersionRecord } from "@draft-loop/storage";

import type { CanonicalCandidateProfileExtractionMaterial } from "./candidate-profile-extraction.js";
import { evidenceKindChangedSince } from "./canonical-profile-evidence-kinds.js";
import { referenceKey } from "./canonical-profile-fact-keys.js";
import {
  type CanonicalProfileSensitivityRulesApplied,
  canonicalProfileExcludedSensitivityTiers,
} from "./canonical-profile-sensitivity-filter.js";

/** The earlier profile version's facts that still hold, and the sources that need extraction. */
export interface IncrementalCanonicalProfilePlan {
  /** Materials still to be sent for extraction; every material when nothing can be reused. */
  readonly materials: readonly CanonicalCandidateProfileExtractionMaterial[];
  readonly reusedFacts: readonly CanonicalCandidateProfileFact[];
  readonly carriedIssues: readonly CanonicalCandidateProfileIssue[];
  /** Selected source versions whose earlier facts are reused instead of extracted again. */
  readonly reusedSourceCount: number;
  readonly extractedSourceCount: number;
}

export interface PlanIncrementalCanonicalProfileInput {
  readonly latest: CanonicalCandidateProfileVersionRecord | undefined;
  readonly identity: CanonicalCandidateProfileExtractionIdentity | undefined;
  readonly fullExtraction: boolean;
  readonly snapshot: CandidateKnowledgeSelectionSnapshot;
  readonly materials: readonly CanonicalCandidateProfileExtractionMaterial[];
  /** The sensitivity filtering of this run; see {@link currentSensitivityIdentity}. */
  readonly sensitivity: CanonicalCandidateProfileSensitivityIdentity;
}

/**
 * The sensitivity filtering of one derivation, as recorded on the profile version: the excluded
 * tiers (the default set when the run names none) in tier order, and the rules applied per
 * knowledge base ordered by store then knowledge base.
 */
export function currentSensitivityIdentity(
  excludedTiers: ReadonlySet<SourceSensitivityTier> | undefined,
  rulesApplied: readonly CanonicalProfileSensitivityRulesApplied[],
): CanonicalCandidateProfileSensitivityIdentity {
  const effective = excludedTiers ?? canonicalProfileExcludedSensitivityTiers;
  return {
    excludedTiers: sourceSensitivityTiers.filter((tier) => effective.has(tier)),
    rules: rulesApplied
      .map((rule) => ({
        storeId: rule.storeId,
        knowledgeBaseId: rule.knowledgeBaseId,
        rulesVersion: rule.rulesVersion,
        rulesChecksum: rule.rulesChecksum,
      }))
      .sort((left, right) =>
        compareOrdinal(
          knowledgeBaseKey(left.storeId, left.knowledgeBaseId),
          knowledgeBaseKey(right.storeId, right.knowledgeBaseId),
        ),
      ),
  };
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function knowledgeBaseKey(storeId: string, knowledgeBaseId: string): string {
  return JSON.stringify([storeId, knowledgeBaseId]);
}

function rulesByKnowledgeBase(
  sensitivity: CanonicalCandidateProfileSensitivityIdentity,
): Map<string, string> {
  return new Map(
    sensitivity.rules.map((rule) => [
      knowledgeBaseKey(rule.storeId, rule.knowledgeBaseId),
      JSON.stringify([rule.rulesVersion, rule.rulesChecksum]),
    ]),
  );
}

function sameTiers(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((tier, index) => tier === right[index]);
}

/**
 * Knowledge bases whose earlier facts were extracted under different sensitivity filtering. A
 * version recorded without sensitivity cannot vouch for any knowledge base that has rules now.
 */
function knowledgeBasesFilteredDifferently(
  previous: CanonicalCandidateProfileSensitivityIdentity | undefined,
  current: CanonicalCandidateProfileSensitivityIdentity,
): (key: string) => boolean {
  const currentRules = rulesByKnowledgeBase(current);
  if (previous === undefined) return (key) => currentRules.has(key);
  const previousRules = rulesByKnowledgeBase(previous);
  const tiersMatch = sameTiers(previous.excludedTiers, current.excludedTiers);
  return (key) => {
    const rules = currentRules.get(key);
    if (rules !== previousRules.get(key)) return true;
    return rules !== undefined && !tiersMatch;
  };
}

function sameIdentity(
  left: CanonicalCandidateProfileExtractionIdentity,
  right: CanonicalCandidateProfileExtractionIdentity,
): boolean {
  return (
    left.company === right.company &&
    left.modelId === right.modelId &&
    left.promptTemplateVersion === right.promptTemplateVersion &&
    left.extractionProfile?.id === right.extractionProfile?.id &&
    left.extractionProfile?.version === right.extractionProfile?.version
  );
}

function candidateSourceKey(
  storeId: string,
  knowledgeBaseId: string,
  sourceId: string,
  versionId: string,
): string {
  return referenceKey({
    storeId,
    knowledgeBaseId,
    sourceId,
    versionId,
    kind: "candidate-provided",
  });
}

/** Source versions are immutable, so the version number and creation time pin the content. */
export function sourceRevisionSignature(
  source: CandidateKnowledgeSelectionSnapshot["entries"][number]["sources"][number],
): string {
  return JSON.stringify([
    source.lifecycleRevision.version,
    source.lifecycleRevision.createdAt,
    source.lifecycleRevision.managed,
  ]);
}

function snapshotRevisions(snapshot: CandidateKnowledgeSelectionSnapshot): Map<string, string> {
  const revisions = new Map<string, string>();
  for (const entry of snapshot.entries) {
    for (const source of entry.sources) {
      revisions.set(
        candidateSourceKey(entry.storeId, entry.knowledgeBaseId, source.sourceId, source.versionId),
        sourceRevisionSignature(source),
      );
    }
  }
  return revisions;
}

function fullPlan(
  materials: readonly CanonicalCandidateProfileExtractionMaterial[],
): IncrementalCanonicalProfilePlan {
  return {
    materials,
    reusedFacts: [],
    carriedIssues: [],
    reusedSourceCount: 0,
    extractedSourceCount: materials.length,
  };
}

function referenceKeys(references: readonly CanonicalCandidateProfileProvenanceReference[]) {
  return references.map(referenceKey);
}

/**
 * Decide which sources keep their facts from the latest profile version.
 *
 * Reuse needs a recorded extraction identity equal to the current route. A source is unchanged when
 * its exact version (store, knowledge base, source, version, kind) and recorded revision match the
 * earlier selection, it can be extracted now, and its knowledge base was filtered the same way: the
 * latest version recorded the same sensitivity rules (version and checksum) for it, or none on
 * either side, and, when rules apply, the same excluded tiers. A version recorded without
 * sensitivity only vouches for knowledge bases that have no rules now. A source whose evidence kind
 * differs from the kind recorded for its version is extracted again under the new guidance. A fact is kept only when
 * every cited source is unchanged; sources cited by a dropped fact, or by an earlier extraction
 * error, are extracted again so the merged facts match a full extraction.
 */
export function planIncrementalCanonicalProfileExtraction(
  input: PlanIncrementalCanonicalProfileInput,
): IncrementalCanonicalProfilePlan {
  const { latest, identity } = input;
  if (
    input.fullExtraction ||
    latest === undefined ||
    identity === undefined ||
    latest.profile.extraction === undefined ||
    !sameIdentity(latest.profile.extraction, identity)
  ) {
    return fullPlan(input.materials);
  }

  if (latest.profile.candidateKnowledgeSelection === undefined) return fullPlan(input.materials);
  const previousRevisions = snapshotRevisions(latest.profile.candidateKnowledgeSelection);
  const currentRevisions = snapshotRevisions(input.snapshot);
  const filteredDifferently = knowledgeBasesFilteredDifferently(
    latest.profile.extraction.sensitivity,
    input.sensitivity,
  );
  const kindChanged = evidenceKindChangedSince(latest.profile.extraction.evidenceKinds);
  const materialByKey = new Map(
    input.materials.map((material) => [referenceKey(material.reference), material]),
  );
  const unchanged = new Set<string>();
  for (const [key, material] of materialByKey) {
    const { storeId, knowledgeBaseId } = material.reference;
    const revision = currentRevisions.get(key);
    if (
      revision !== undefined &&
      revision === previousRevisions.get(key) &&
      !kindChanged(material) &&
      !filteredDifferently(knowledgeBaseKey(storeId, knowledgeBaseId))
    ) {
      unchanged.add(key);
    }
  }

  // A source whose earlier extraction failed is retried rather than reported as empty.
  for (const issue of latest.profile.issues) {
    if (issue.code === "omission" && issue.severity === "error") {
      for (const key of referenceKeys(issue.sourceRefs)) unchanged.delete(key);
    }
  }
  // Dropping a fact that cites a changed source also loses what its other sources contributed.
  let dropped = true;
  while (dropped) {
    dropped = false;
    for (const fact of latest.profile.facts) {
      const keys = referenceKeys(fact.provenance);
      if (keys.every((key) => unchanged.has(key))) continue;
      for (const key of keys) dropped = unchanged.delete(key) || dropped;
    }
  }

  const reusedFacts = latest.profile.facts
    .filter((fact) => referenceKeys(fact.provenance).every((key) => unchanged.has(key)))
    .map((fact) => ({
      ...fact,
      provenance: fact.provenance.map((reference) => ({ ...reference })),
    }));
  const reusedFactIds = new Set(reusedFacts.map((fact) => fact.id));
  const carriedIssues = latest.profile.issues
    .filter(
      (issue) =>
        issue.code === "omission" &&
        issue.severity === "warning" &&
        issue.factIds.length + issue.sourceRefs.length > 0 &&
        issue.factIds.every((id) => reusedFactIds.has(id)) &&
        referenceKeys(issue.sourceRefs).every((key) => unchanged.has(key)),
    )
    .map((issue) => ({
      ...issue,
      factIds: [...issue.factIds],
      sourceRefs: issue.sourceRefs.map((reference) => ({ ...reference })),
    }));
  return {
    materials: input.materials.filter(
      (material) => !unchanged.has(referenceKey(material.reference)),
    ),
    reusedFacts,
    carriedIssues,
    reusedSourceCount: unchanged.size,
    extractedSourceCount: input.materials.length - unchanged.size,
  };
}
