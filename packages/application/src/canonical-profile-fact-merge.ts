import type { CanonicalCandidateProfileFact } from "@draft-loop/schemas";
import { normalizedSemantic, referenceKey, uniqueSorted } from "./canonical-profile-fact-keys.js";

export interface MergedCanonicalProfileFacts {
  readonly facts: readonly CanonicalCandidateProfileFact[];
  /** Maps each merged-away fact id to the id of the surviving fact. */
  readonly aliasOf: ReadonlyMap<string, string>;
}

/**
 * Merge facts that share category, subject, normalized field, and normalized value into the first
 * such fact in input order. The survivor keeps its id, field, and value text; its provenance becomes
 * the sorted union. A fact whose union would exceed `maxProvenance` is left separate so the
 * duplicate warning still applies. Survivors keep their original relative order.
 */
export function mergeIdenticalProfileFacts(
  facts: readonly CanonicalCandidateProfileFact[],
  maxProvenance: number,
): MergedCanonicalProfileFacts {
  const groups = new Map<string, CanonicalCandidateProfileFact[][]>();
  const bucketOrder: CanonicalCandidateProfileFact[][] = [];
  for (const fact of facts) {
    const key = JSON.stringify([
      fact.category,
      fact.subjectId ?? "",
      normalizedSemantic(fact.field),
      normalizedSemantic(fact.value),
    ]);
    let buckets = groups.get(key);
    if (buckets === undefined) {
      buckets = [];
      groups.set(key, buckets);
    }
    const bucket = buckets.find(
      (members) => unionProvenance(members, fact).length <= maxProvenance,
    );
    if (bucket === undefined) {
      const created = [fact];
      buckets.push(created);
      bucketOrder.push(created);
    } else bucket.push(fact);
  }

  const aliasOf = new Map<string, string>();
  const merged = bucketOrder.map((members) => {
    const [survivor, ...rest] = members as [
      CanonicalCandidateProfileFact,
      ...CanonicalCandidateProfileFact[],
    ];
    if (rest.length === 0) return survivor;
    for (const fact of rest) if (fact.id !== survivor.id) aliasOf.set(fact.id, survivor.id);
    return { ...survivor, provenance: [...unionProvenance(members)] };
  });
  return { facts: merged, aliasOf };
}

function unionProvenance(
  members: readonly CanonicalCandidateProfileFact[],
  extra?: CanonicalCandidateProfileFact,
): readonly CanonicalCandidateProfileFact["provenance"][number][] {
  // The first quote seen for a reference wins; identity ignores the quote.
  const byKey = new Map<string, CanonicalCandidateProfileFact["provenance"][number]>();
  for (const reference of [...members, ...(extra === undefined ? [] : [extra])].flatMap(
    (fact) => fact.provenance,
  )) {
    const key = referenceKey(reference);
    const existing = byKey.get(key);
    if (existing === undefined || (existing.quote === undefined && reference.quote !== undefined)) {
      byKey.set(key, reference);
    }
  }
  return uniqueSorted([...byKey.values()], referenceKey);
}
