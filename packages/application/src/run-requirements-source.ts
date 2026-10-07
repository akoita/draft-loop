import type { ContextSnapshot } from "@draft-loop/domain";

/**
 * The preflight line saying where a run's requirements came from. It is content-free: only the
 * brief identity, version and requirement count are shown, never requirement text.
 */
export function requirementsSourcePreflightLine(
  context: Pick<ContextSnapshot, "requirements" | "opportunityBriefReference">,
): string {
  const reference = context.opportunityBriefReference;
  if (reference === undefined) return "Requirements: job description (unreviewed source units)";
  const count = context.requirements.length;
  return `Requirements: reviewed opportunity brief ${reference.briefId} v${reference.version} (${count} ${count === 1 ? "requirement" : "requirements"})`;
}
