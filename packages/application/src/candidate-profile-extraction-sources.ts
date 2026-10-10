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

/** Identity of one exact provider input; the size check and deduplication must agree on it. */
export function canonicalCandidateProfileSourceContentKey(
  source: Pick<CanonicalCandidateProfileExtractionSource, "mediaType" | "checksum" | "text">,
): string {
  return JSON.stringify([source.mediaType, source.checksum, source.text]);
}

/** Exact inputs extracted under different evidence kinds get different guidance, so stay apart. */
function providerInputKey(source: CanonicalCandidateProfileExtractionSource): string {
  return JSON.stringify([canonicalCandidateProfileSourceContentKey(source), source.evidenceKind]);
}

/** Deduplicate exact provider inputs while retaining every local source reference. */
export function prepareCanonicalCandidateProfileExtractionSources(
  sources: readonly CanonicalCandidateProfileExtractionSource[],
  referencesBySourceId: ReadonlyMap<string, CanonicalCandidateProfileProvenanceReference>,
): PreparedCanonicalCandidateProfileExtractionSources {
  const groupsByContent = new Map<string, SourceGroup[]>();
  const groups: SourceGroup[] = [];

  for (const source of sources) {
    const key = providerInputKey(source);
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
        ...(source.evidenceKind === undefined ? {} : { evidenceKind: source.evidenceKind }),
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
