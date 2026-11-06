import { t } from "@lingui/core/macro";
import { countedNouns } from "./counted-nouns.js";
import type { RunEvidenceModeView } from "./run-evidence-mode.js";

export type RunEvidenceModeDisplay =
  | {
      readonly kind: "full-source";
      /** Retrieval-strip status, e.g. "181 chunks from 1 source". */
      readonly stripStatus: string;
      /** Side-panel value, e.g. "181 chunks". */
      readonly panelValue: string;
      /** Side-panel detail, e.g. "full source from 1 source". */
      readonly panelDetail: string;
    }
  | {
      readonly kind: "fallback";
      readonly stripStatus: string;
      /** Replaces the side panel's "from N sources" detail; the excerpt count stays. */
      readonly panelDetail: string;
    };

/** What the review shows for the run's recorded mode; `undefined` keeps the readiness display. */
export function runEvidenceModeDisplay(
  mode: RunEvidenceModeView | null | undefined,
): RunEvidenceModeDisplay | undefined {
  if (mode === undefined || mode === null || mode.requestedMode !== "full-source") return undefined;
  if (mode.effectiveMode === "full-source") {
    const chunks = countedNouns.chunk(mode.chunkCount);
    if (mode.sourceCount === undefined) {
      return {
        kind: "full-source",
        stripStatus: chunks,
        panelValue: chunks,
        panelDetail: t`full source`,
      };
    }
    const sources = countedNouns.source(mode.sourceCount);
    return {
      kind: "full-source",
      stripStatus: t`${chunks} from ${sources}`,
      panelValue: chunks,
      panelDetail: t`full source from ${sources}`,
    };
  }
  if (mode.fallbackReason === "budget-exceeded") {
    return {
      kind: "fallback",
      stripStatus: t`Full source did not fit the evidence budget (${countedNouns.chunk(mode.chunkCount)}), so retrieval was used`,
      panelDetail: t`retrieval; full source did not fit`,
    };
  }
  if (mode.fallbackReason === "no-eligible-chunks") {
    return {
      kind: "fallback",
      stripStatus: t`No eligible chunks for full source, so retrieval was used`,
      panelDetail: t`retrieval; no full-source chunks`,
    };
  }
  return undefined;
}
