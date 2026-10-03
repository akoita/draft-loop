import type { CanonicalCandidateProfileExtractionProposal } from "@draft-loop/schemas";

/** Repair only duplicate identities that no issue refers to. */
export function recoverUnreferencedDuplicateFactKeys(
  proposal: CanonicalCandidateProfileExtractionProposal,
): CanonicalCandidateProfileExtractionProposal | undefined {
  const counts = new Map<string, number>();
  for (const fact of proposal.facts) {
    const identity = fact.key.trim();
    counts.set(identity, (counts.get(identity) ?? 0) + 1);
  }

  const duplicateIdentities = new Set(
    [...counts].flatMap(([identity, count]) => (count > 1 ? [identity] : [])),
  );
  if (duplicateIdentities.size === 0) return proposal;

  if (
    proposal.issues.some((issue) =>
      issue.factKeys.some((factKey) => duplicateIdentities.has(factKey.trim())),
    )
  ) {
    return undefined;
  }

  const reserved = new Set([
    ...proposal.facts.map((fact) => fact.key.trim()),
    ...proposal.issues.flatMap((issue) => issue.factKeys.map((factKey) => factKey.trim())),
  ]);
  const seen = new Set<string>();
  let nextGeneratedNumber = 1;
  const facts = proposal.facts.map((fact) => {
    const identity = fact.key.trim();
    if (!duplicateIdentities.has(identity) || !seen.has(identity)) {
      seen.add(identity);
      return fact;
    }

    let recoveredKey: string;
    do {
      recoveredKey = `recovered-fact-${nextGeneratedNumber}`;
      nextGeneratedNumber += 1;
    } while (reserved.has(recoveredKey));
    reserved.add(recoveredKey);
    return { ...fact, key: recoveredKey };
  });

  return { ...proposal, facts };
}
