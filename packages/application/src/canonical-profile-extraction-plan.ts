import {
  type CanonicalProfileExtractionTextWindow,
  planCanonicalProfileExtractionTextWindows,
} from "./canonical-profile-extraction-sections.js";

const proactivePlanMinimumSourceCount = 1;
const proactivePlanMaximumSourceCount = 4;
const proactivePlanTotalTextThreshold = 65_536;
const proactivePlanSourceWindowThreshold = 16_384;
const proactivePlanMaximumCallCount = 16;

export interface CanonicalProfileExtractionPlannedCall {
  readonly sourceId: string;
  readonly window?: CanonicalProfileExtractionTextWindow;
}

/**
 * Plan bounded source-focused calls for a large prepared corpus. Lengths use
 * JavaScript string units, and windows retain offsets into each full source.
 */
export function planCanonicalProfileExtractionCalls(
  sources: readonly { readonly id: string; readonly text: string }[],
): readonly CanonicalProfileExtractionPlannedCall[] | null {
  if (
    sources.length < proactivePlanMinimumSourceCount ||
    sources.length > proactivePlanMaximumSourceCount ||
    new Set(sources.map((source) => source.id)).size !== sources.length
  ) {
    return null;
  }

  const totalTextLength = sources.reduce((total, source) => total + source.text.length, 0);
  if (totalTextLength <= proactivePlanTotalTextThreshold) return null;

  const calls: CanonicalProfileExtractionPlannedCall[] = [];
  for (const source of sources) {
    if (source.text.length <= proactivePlanSourceWindowThreshold) {
      calls.push({ sourceId: source.id });
      continue;
    }

    const windows = planCanonicalProfileExtractionTextWindows(source.text);
    if (windows === null) return null;
    for (const window of windows) calls.push({ sourceId: source.id, window });
  }

  return calls.length <= proactivePlanMaximumCallCount ? calls : null;
}
