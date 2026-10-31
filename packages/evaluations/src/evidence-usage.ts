/**
 * Which of the evidence a call was sent its draft actually cites. A recall miss then splits into
 * "retrieval never surfaced the fact" (no sent chunk covers it) and "the author saw it and left it
 * out" (a sent chunk went uncited). Content-free: ranks, ids and line ranges only.
 */

export interface EvidenceUsageRef {
  readonly sourceId: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly rank: number;
}

export interface EvidenceUsageClaim {
  readonly evidence: readonly {
    readonly sourcePath: string;
    readonly locator?: string | undefined;
  }[];
}

export interface EvidenceUsageReport {
  /** Chunks the call was sent. */
  readonly sent: number;
  /** Sent chunks at least one claim cites (a locator overlapping the chunk in the same source). */
  readonly cited: number;
  /** Ranks of the sent chunks no claim cites, lowest rank first. */
  readonly uncitedRanks: readonly number[];
  /** Claims whose every evidence reference points outside the sent chunks. */
  readonly claimsOutsideRetrieval: number;
  /** Claims that cite nothing at all. */
  readonly claimsWithoutEvidence: number;
}

const locatorPattern = /^line:(\d+)-(\d+)$/u;

function locatorRange(locator: string | undefined): readonly [number, number] | null {
  const match = locator === undefined ? null : locatorPattern.exec(locator);
  if (match === null) return null;
  return [Number(match[1]), Number(match[2])];
}

/**
 * Compare a draft's claims with the chunks the call that wrote it was sent. `sources` maps each
 * source id to the path the claims cite; a claim on a path no source names counts as outside.
 */
export function evidenceUsage(
  claims: readonly EvidenceUsageClaim[],
  retrieved: readonly EvidenceUsageRef[],
  sources: readonly { readonly id: string; readonly path: string }[],
): EvidenceUsageReport {
  const pathById = new Map(sources.map((source) => [source.id, source.path]));
  const citedRanks = new Set<number>();
  let claimsOutsideRetrieval = 0;
  let claimsWithoutEvidence = 0;
  for (const claim of claims) {
    if (claim.evidence.length === 0) {
      claimsWithoutEvidence += 1;
      continue;
    }
    let inside = false;
    for (const reference of claim.evidence) {
      const range = locatorRange(reference.locator);
      if (range === null) continue;
      for (const chunk of retrieved) {
        if (pathById.get(chunk.sourceId) !== reference.sourcePath) continue;
        if (range[0] <= chunk.lineEnd && range[1] >= chunk.lineStart) {
          citedRanks.add(chunk.rank);
          inside = true;
        }
      }
    }
    if (!inside) claimsOutsideRetrieval += 1;
  }
  return {
    sent: retrieved.length,
    cited: citedRanks.size,
    uncitedRanks: retrieved
      .map((chunk) => chunk.rank)
      .filter((rank) => !citedRanks.has(rank))
      .sort((a, b) => a - b),
    claimsOutsideRetrieval,
    claimsWithoutEvidence,
  };
}
