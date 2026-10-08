import { type ReactNode, useEffect, useRef, useState } from "react";

import type { OpportunityLatestResult } from "./bridge.js";
import type { JobRequirementsExtractionBinding } from "./job-requirements-extraction.js";
import {
  isEmptyDraftBrief,
  latestBriefNote,
  latestBriefTitle,
  type ReviewedRequirementsSelection,
  rawJobDescriptionLabel,
  reviewedRequirementsLabel,
} from "./start-requirements-model.js";

/**
 * Reads the workspace's latest opportunity brief (draft or reviewed) from the host. `undefined`
 * means unknown: still loading, unsupported by the host, or unreadable. Call `refresh` after the
 * brief changed. `workspaceId` keeps one workspace's brief from showing in another.
 */
export function useLatestOpportunity(
  getLatest: (() => Promise<OpportunityLatestResult>) | undefined,
  workspaceId: string,
  reloadKey: string,
): { readonly latest: OpportunityLatestResult | undefined; readonly refresh: () => void } {
  const [loaded, setLoaded] = useState<{
    readonly workspaceId: string;
    readonly latest: OpportunityLatestResult;
  } | null>(null);
  const [tick, setTick] = useState(0);
  const getLatestRef = useRef(getLatest);
  getLatestRef.current = getLatest;
  const supported = getLatest !== undefined;
  // `reloadKey` and `tick` are the intentional triggers: the read is by workspace, not by input.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    const read = getLatestRef.current;
    if (!supported || read === undefined) return;
    let cancelled = false;
    read().then(
      (latest) => {
        if (!cancelled) setLoaded({ workspaceId, latest });
      },
      () => {
        if (!cancelled) setLoaded(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [supported, workspaceId, reloadKey, tick]);
  return {
    latest: loaded !== null && loaded.workspaceId === workspaceId ? loaded.latest : undefined,
    refresh: () => setTick((value) => value + 1),
  };
}

/**
 * The extraction binding with a refresh after every change to the brief, so the setup card and
 * the start panel follow a brief that was just created, saved or reviewed.
 */
export function withLatestBriefRefresh(
  binding: JobRequirementsExtractionBinding,
  refresh: () => void,
): JobRequirementsExtractionBinding {
  const { createOpportunity } = binding;
  return {
    ...binding,
    ...(createOpportunity === undefined
      ? {}
      : {
          createOpportunity: async (input) => {
            const record = await createOpportunity(input);
            refresh();
            return record;
          },
        }),
    onBriefChanged: () => {
      refresh();
      binding.onBriefChanged?.();
    },
  };
}

export interface LatestRequirementsBriefViewProps {
  readonly latest: NonNullable<OpportunityLatestResult>;
  /** The "Review requirements" or "View requirements" action. */
  readonly action: ReactNode;
}

/** Setup card 01: the workspace's latest brief, so a draft can be resumed after a restart. */
export function LatestRequirementsBriefView({ latest, action }: LatestRequirementsBriefViewProps) {
  return (
    <div className="job-extraction" data-testid="latest-requirements-brief">
      <p className="job-extraction-title">{latestBriefTitle(latest)}</p>
      <p className="setup-note">{latestBriefNote(latest)}</p>
      {isEmptyDraftBrief(latest) ? null : action}
    </div>
  );
}

export interface StartRequirementsSourceViewProps {
  readonly selection: ReviewedRequirementsSelection;
  /** The person chose to start from the raw job description instead of the reviewed brief. */
  readonly useJobDescription: boolean;
  readonly disabled?: boolean;
  readonly onUseJobDescription: () => void;
  readonly onUseReviewed: () => void;
}

/** The start panel's statement of where the run's requirements come from, and how to change it. */
export function StartRequirementsSourceView({
  selection,
  useJobDescription,
  disabled = false,
  onUseJobDescription,
  onUseReviewed,
}: StartRequirementsSourceViewProps) {
  return (
    <section className="start-requirements" aria-label="Requirements for this run">
      <p className="start-requirements-line" role="status">
        {useJobDescription ? rawJobDescriptionLabel : reviewedRequirementsLabel(selection)}
      </p>
      <button
        className="button button-quiet"
        type="button"
        disabled={disabled}
        onClick={useJobDescription ? onUseReviewed : onUseJobDescription}
      >
        {useJobDescription
          ? `Use the reviewed requirements (brief v${selection.version})`
          : "Use the raw job description instead"}
      </button>
    </section>
  );
}
