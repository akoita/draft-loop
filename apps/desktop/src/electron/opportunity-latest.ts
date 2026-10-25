const briefIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$/u;

/** A persisted latest-brief pointer, or `undefined` when the stored value is not a brief id. */
export function persistedLatestOpportunityBriefId(value: unknown): string | undefined {
  return typeof value === "string" && briefIdPattern.test(value) ? value : undefined;
}
