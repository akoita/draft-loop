import type { OpportunityLatestBrief } from "../bridge.js";

/** The brief fields the latest-brief projection reads; it never touches requirement text. */
interface LatestBriefRecord {
  readonly brief: {
    readonly id: string;
    readonly version: number;
    readonly status: string;
    readonly requirements: readonly { readonly priority: string }[];
  };
}

const briefIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$/u;

/** A persisted latest-brief pointer, or `undefined` when the stored value is not a brief id. */
export function persistedLatestOpportunityBriefId(value: unknown): string | undefined {
  return typeof value === "string" && briefIdPattern.test(value) ? value : undefined;
}

/**
 * The content-free summary of a workspace's latest brief version: identity, review status and
 * requirement counts. This is what lets setup offer to resume a draft after the app restarts.
 */
export function projectLatestOpportunity(
  workspaceId: string,
  record: LatestBriefRecord,
): OpportunityLatestBrief {
  const { brief } = record;
  return {
    workspaceId,
    briefId: brief.id,
    version: brief.version,
    status: brief.status === "reviewed" ? "reviewed" : "draft",
    requirementCount: brief.requirements.length,
    criticalCount: brief.requirements.filter((requirement) => requirement.priority === "critical")
      .length,
  };
}
