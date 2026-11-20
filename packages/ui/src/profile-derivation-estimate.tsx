import { plural, t } from "@lingui/core/macro";
/**
 * The estimate shown before a large career profile update (#3183): how many sources it reads again
 * and reuses, the expected model calls and a cost range. Hidden for a small update, where the cost
 * is a few cents, and on a host that cannot estimate.
 */
import { useEffect, useState } from "react";

import type { HostProfileCapabilities } from "./native.js";
import type { ProfileDerivationEstimateResult } from "./profile-derivation-estimate-contract.js";

/** Above this, an update reads a large source: the planner splits it into several calls. */
const largeExtractionCharacters = 65_536;

/** Whether an estimate is worth a line before the person starts the update. */
export function isLargeProfileDerivation(estimate: ProfileDerivationEstimateResult): boolean {
  return estimate.calls > 1 || estimate.extractedCharacters > largeExtractionCharacters;
}

function formatUsd(usd: number): string {
  return usd < 0.01 ? "$0.01" : `$${usd.toFixed(2)}`;
}

/** One line, such as "Reads 1 source again (245,000 characters) and reuses 2: about 9 model calls, $0.75 to $1.10." */
export function profileDerivationEstimateText(estimate: ProfileDerivationEstimateResult): string {
  const characters = estimate.extractedCharacters.toLocaleString();
  const sources = plural(estimate.extractedSourceCount, {
    one: "Reads # source again",
    other: "Reads # sources again",
  });
  const extracted = t`${sources} (${characters} characters)`;
  const reused =
    estimate.reusedSourceCount === 0
      ? ""
      : ` ${plural(estimate.reusedSourceCount, { one: "and reuses #", other: "and reuses #" })}`;
  const calls = plural(estimate.calls, { one: "# model call", other: "about # model calls" });
  const range = estimate.estimatedUsd;
  if (range === null) {
    return t`${extracted}${reused}: ${calls}; the cost is unknown for this model.`;
  }
  const low = formatUsd(range.low);
  const high = formatUsd(range.high);
  return low === high
    ? t`${extracted}${reused}: ${calls}, about ${low}.`
    : t`${extracted}${reused}: ${calls}, ${low} to ${high}.`;
}

/**
 * Reads the estimate for the profile as the update would run now; undefined while loading, on a
 * host without estimates, or when the host could not estimate. A failed estimate never blocks
 * the update.
 */
export function useProfileDerivationEstimate(
  capabilities: Pick<HostProfileCapabilities, "estimateCanonicalCandidateProfileDerivation">,
  profileId: string | null,
  fullExtraction: boolean,
  refreshKey: unknown,
): ProfileDerivationEstimateResult | undefined {
  const estimate = capabilities.estimateCanonicalCandidateProfileDerivation;
  const [result, setResult] = useState<{
    readonly key: string;
    readonly estimate: ProfileDerivationEstimateResult;
  }>();
  const key = JSON.stringify([profileId, fullExtraction, refreshKey]);
  useEffect(() => {
    if (estimate === undefined || profileId === null) return;
    let current = true;
    void estimate({ profileId, ...(fullExtraction ? { fullExtraction: true } : {}) })
      .then((answer) => {
        if (current) setResult({ key, estimate: answer });
      })
      .catch(() => {
        // The estimate is advisory; the update still works without it.
      });
    return () => {
      current = false;
    };
  }, [estimate, profileId, fullExtraction, key]);
  return result?.key === key ? result.estimate : undefined;
}

/** The estimate's line, shown above the update action for a large update only. */
export function ProfileDerivationEstimateNote({
  estimate,
}: {
  readonly estimate: ProfileDerivationEstimateResult | undefined;
}) {
  if (estimate === undefined || !isLargeProfileDerivation(estimate)) return null;
  return <p className="profile-derivation-estimate">{profileDerivationEstimateText(estimate)}</p>;
}
