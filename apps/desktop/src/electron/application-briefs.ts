import type { ApplicationView } from "@draft-loop/application";

import type { OpportunityBriefSelectionInput } from "../bridge.js";

/**
 * Per-application opportunity brief preferences (ADR 0010).
 *
 * The workspace keeps one "latest brief" and one "reviewed brief" for its default application.
 * A created application keeps its own pair here, stored as an array of entries rather than a map
 * keyed by application id, so data-derived ids never become JSON keys.
 */
export interface ApplicationBriefPreference {
  readonly applicationId: string;
  /** The application's most recent brief version, so its setup can resume after a restart. */
  readonly latestOpportunityBriefId?: string;
  /** The exact reviewed brief version a run for this application starts from. */
  readonly reviewedOpportunity?: OpportunityBriefSelectionInput;
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$/u;
const maximumPreferences = 500;

function identifier(value: unknown): string | undefined {
  return typeof value === "string" && identifierPattern.test(value) ? value : undefined;
}

function selection(value: unknown): OpportunityBriefSelectionInput | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const briefId = identifier(record.briefId);
  if (
    Object.keys(record).some((key) => key !== "briefId" && key !== "version") ||
    briefId === undefined ||
    typeof record.version !== "number" ||
    !Number.isSafeInteger(record.version) ||
    record.version < 1 ||
    record.version > 1_000_000
  ) {
    return undefined;
  }
  return { briefId, version: record.version };
}

/** Reads the persisted entries, dropping anything malformed or repeated. */
export function persistedApplicationBriefPreferences(
  value: unknown,
): readonly ApplicationBriefPreference[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const preferences: ApplicationBriefPreference[] = [];
  for (const item of value.slice(0, maximumPreferences) as readonly unknown[]) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const applicationId = identifier(record.applicationId);
    if (applicationId === undefined || seen.has(applicationId)) continue;
    const latestOpportunityBriefId = identifier(record.latestOpportunityBriefId);
    const reviewedOpportunity = selection(record.reviewedOpportunity);
    seen.add(applicationId);
    preferences.push({
      applicationId,
      ...(latestOpportunityBriefId === undefined ? {} : { latestOpportunityBriefId }),
      ...(reviewedOpportunity === undefined ? {} : { reviewedOpportunity }),
    });
  }
  return preferences;
}

export function applicationBriefPreference(
  preferences: readonly ApplicationBriefPreference[] | undefined,
  applicationId: string,
): ApplicationBriefPreference | undefined {
  return preferences?.find((preference) => preference.applicationId === applicationId);
}

/**
 * Replaces one application's entry. An entry that holds nothing is removed, and the oldest entries
 * fall away beyond the cap.
 */
export function withApplicationBriefPreference(
  preferences: readonly ApplicationBriefPreference[] | undefined,
  next: ApplicationBriefPreference,
): readonly ApplicationBriefPreference[] {
  const others = (preferences ?? []).filter(
    (preference) => preference.applicationId !== next.applicationId,
  );
  const empty =
    next.latestOpportunityBriefId === undefined && next.reviewedOpportunity === undefined;
  return (empty ? others : [...others, next]).slice(-maximumPreferences);
}

/** The newest brief an application holds, used when no preference was recorded. */
export function newestApplicationBriefId(application: ApplicationView): string | undefined {
  let newest: ApplicationView["briefs"][number] | undefined;
  for (const brief of application.briefs) {
    if (newest === undefined || Date.parse(brief.createdAt) >= Date.parse(newest.createdAt)) {
      newest = brief;
    }
  }
  return newest?.briefId;
}

/** True when the application holds the brief, so an edit or review cannot cross applications. */
export function applicationHoldsBrief(application: ApplicationView, briefId: string): boolean {
  return application.briefs.some((brief) => brief.briefId === briefId);
}

/** The setup preferences an application's readiness is computed from. */
export interface BriefScopedPreferences {
  readonly reviewedOpportunity?: OpportunityBriefSelectionInput;
  readonly latestOpportunityBriefId?: string;
  readonly pendingWritingPolicyOverride?: unknown;
}

/**
 * Replaces the workspace-level brief preferences with the application's own. The pending writing
 * policy override is bound to the workspace's reviewed brief, so it never applies here.
 */
export function overridesForApplication<Overrides extends BriefScopedPreferences>(
  overrides: Overrides,
  preference: ApplicationBriefPreference | undefined,
): Overrides {
  const {
    reviewedOpportunity: _reviewed,
    latestOpportunityBriefId: _latest,
    pendingWritingPolicyOverride: _pending,
    ...rest
  } = overrides;
  return {
    ...rest,
    ...(preference?.reviewedOpportunity === undefined
      ? {}
      : { reviewedOpportunity: preference.reviewedOpportunity }),
    ...(preference?.latestOpportunityBriefId === undefined
      ? {}
      : { latestOpportunityBriefId: preference.latestOpportunityBriefId }),
  } as Overrides;
}
