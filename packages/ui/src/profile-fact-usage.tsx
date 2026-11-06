/**
 * Usage level controls on the career profile (#2259): where each fact may be used, on a CV, only
 * in interview, or never. A fact with no level of its own follows its section, and a section with
 * none allows the CV. The level is apart from sensitivity, which decides what may reach a model
 * provider, and the copy says so.
 */

import type { CanonicalCandidateProfileFactCategory } from "@draft-loop/domain";
import { type FactUsageLevel, factUsageKey, resolveFactUsage } from "@draft-loop/domain/fact-usage";
import { useCallback, useEffect, useState } from "react";
import type { CanonicalCandidateProfileFactResult } from "./bridge.js";
import type { FactUsageCapabilities } from "./fact-usage-capabilities.js";
import type { FactUsageChangeView, FactUsageView } from "./fact-usage-contract.js";

export const factUsageLevelLabels: Readonly<Record<FactUsageLevel, string>> = {
  cv: "CV and interview",
  "interview-only": "Interview only",
  "never-say": "Never say",
};

export const factUsageExplanation =
  "Usage says where a fact may appear: on your CV, only in interview answers, or never. It is separate from sensitivity, which decides what may be sent to a model provider.";

export interface ProfileFactUsageControls {
  readonly view: FactUsageView;
  readonly pending: boolean;
  readonly change: (change: FactUsageChangeView) => void;
}

/** Loads the workspace's levels and saves one change at a time; `null` without the capability. */
export function useProfileFactUsage(
  workspaceId: string,
  capabilities: FactUsageCapabilities | undefined,
): { readonly controls: ProfileFactUsageControls | null; readonly error: string | null } {
  const [view, setView] = useState<FactUsageView | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (capabilities === undefined) return;
    let current = true;
    capabilities.getFactUsage(workspaceId).then(
      (loaded) => {
        if (current) setView(loaded);
      },
      () => {
        if (current) setError("Usage levels could not be loaded.");
      },
    );
    return () => {
      current = false;
    };
  }, [capabilities, workspaceId]);

  const change = useCallback(
    (next: FactUsageChangeView) => {
      if (capabilities === undefined) return;
      setPending(true);
      setError(null);
      capabilities
        .setFactUsage(workspaceId, next)
        .then(setView, () => setError("That usage level was not saved. Try again."))
        .finally(() => setPending(false));
    },
    [capabilities, workspaceId],
  );

  return {
    controls: view === null ? null : { view, pending, change },
    error,
  };
}

const levels = Object.keys(factUsageLevelLabels) as FactUsageLevel[];

export function SectionUsageSelect({
  category,
  label,
  controls,
}: {
  readonly category: CanonicalCandidateProfileFactCategory;
  readonly label: string;
  readonly controls: ProfileFactUsageControls;
}) {
  const level = controls.view.sections[category] ?? "cv";
  return (
    <label className="profile-usage profile-usage-section">
      <span>Section usage</span>
      <select
        aria-label={`Usage for ${label} section`}
        value={level}
        disabled={controls.pending}
        onChange={(event) => {
          const chosen = event.target.value as FactUsageLevel;
          controls.change({ kind: "section", category, level: chosen === "cv" ? null : chosen });
        }}
      >
        {levels.map((option) => (
          <option key={option} value={option}>
            {factUsageLevelLabels[option]}
          </option>
        ))}
      </select>
    </label>
  );
}

export function FactUsageSelect({
  fact,
  label,
  controls,
}: {
  readonly fact: CanonicalCandidateProfileFactResult;
  readonly label: string;
  readonly controls: ProfileFactUsageControls;
}) {
  const key = factUsageKey(fact);
  const own = controls.view.facts[key];
  const inherited = controls.view.sections[fact.category] ?? "cv";
  const effective = resolveFactUsage(
    { schemaVersion: 1, sections: controls.view.sections, facts: controls.view.facts },
    fact,
  );
  return (
    <label className={`profile-usage profile-usage-${effective}`}>
      <span className="sr-only">Usage</span>
      <select
        aria-label={`Usage for ${label}`}
        value={own ?? ""}
        disabled={controls.pending}
        onChange={(event) => {
          const chosen = event.target.value;
          controls.change({
            kind: "fact",
            key,
            level: chosen === "" ? null : (chosen as FactUsageLevel),
          });
        }}
      >
        <option value="">Like section ({factUsageLevelLabels[inherited]})</option>
        {levels.map((option) => (
          <option key={option} value={option}>
            {factUsageLevelLabels[option]}
          </option>
        ))}
      </select>
    </label>
  );
}
