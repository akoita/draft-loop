import type {
  CandidateKnowledgeSelectionSnapshot,
  CanonicalCandidateProfileExtractionIdentity,
} from "@draft-loop/domain";
import type {
  CanonicalCandidateProfileFact,
  CanonicalCandidateProfileIssue,
  CanonicalCandidateProfileProvenanceReference,
} from "@draft-loop/schemas";
import type { CanonicalCandidateProfileVersionRecord } from "@draft-loop/storage";

import type { CanonicalCandidateProfileExtractionMaterial } from "./candidate-profile-extraction.js";
import { referenceKey } from "./canonical-profile-fact-keys.js";

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
  /** Knowledge bases with sensitivity rules; their sources are always extracted again. */
  readonly filteredKnowledgeBases: readonly {
    readonly storeId: string;
    readonly knowledgeBaseId: string;
  }[];
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
 * earlier selection, it can be extracted now, and its knowledge base has no sensitivity rules. A
 * fact is kept only when every cited source is unchanged; sources cited by a dropped fact, or by an
 * earlier extraction error, are extracted again so the merged facts match a full extraction.
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
  const filtered = new Set(
    input.filteredKnowledgeBases.map((base) =>
      JSON.stringify([base.storeId, base.knowledgeBaseId]),
    ),
  );
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
      !filtered.has(JSON.stringify([storeId, knowledgeBaseId]))
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
