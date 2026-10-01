import { maximumCanonicalCandidateProfileProvenanceCount } from "@draft-loop/domain";
import type { CanonicalCandidateProfileProvenanceReference } from "@draft-loop/schemas";

import type { CanonicalCandidateProfileExtractionSource } from "./candidate-profile-extraction.js";

interface SourceGroup {
  readonly representative: CanonicalCandidateProfileExtractionSource;
  readonly references: CanonicalCandidateProfileProvenanceReference[];
}

export interface PreparedCanonicalCandidateProfileExtractionSources {
  readonly sources: readonly CanonicalCandidateProfileExtractionSource[];
  readonly referencesByRepresentativeId: ReadonlyMap<
    string,
    readonly CanonicalCandidateProfileProvenanceReference[]
  >;
  readonly sourceTextsByRepresentativeId: ReadonlyMap<string, string>;
}

/** Deduplicate exact provider inputs while retaining every local source reference. */
export function prepareCanonicalCandidateProfileExtractionSources(
  sources: readonly CanonicalCandidateProfileExtractionSource[],
  referencesBySourceId: ReadonlyMap<string, CanonicalCandidateProfileProvenanceReference>,
): PreparedCanonicalCandidateProfileExtractionSources {
  const groupsByContent = new Map<string, SourceGroup[]>();
  const groups: SourceGroup[] = [];

  for (const source of sources) {
    const key = JSON.stringify([source.mediaType, source.checksum, source.text]);
    const contentGroups = groupsByContent.get(key) ?? [];
    let group = contentGroups.at(-1);
    if (
      group === undefined ||
      group.references.length === maximumCanonicalCandidateProfileProvenanceCount
    ) {
      const representative = Object.freeze({
        id: source.id,
        mediaType: source.mediaType,
        checksum: source.checksum,
        text: source.text,
      });
      group = { representative, references: [] };
      contentGroups.push(group);
      groups.push(group);
      groupsByContent.set(key, contentGroups);
    }

    const reference = referencesBySourceId.get(source.id);
    if (reference === undefined) {
      throw new Error("A validated candidate profile source reference is unavailable.");
    }
    group.references.push(reference);
  }

  const preparedSources = Object.freeze(groups.map(({ representative }) => representative));
  const preparedReferences = new Map(
    groups.map(({ representative, references }) => [
      representative.id,
      Object.freeze([...references]),
    ]),
  );
  const sourceTexts = new Map(preparedSources.map((source) => [source.id, source.text] as const));

  return Object.freeze({
    sources: preparedSources,
    referencesByRepresentativeId: preparedReferences,
    sourceTextsByRepresentativeId: sourceTexts,
  });
}
