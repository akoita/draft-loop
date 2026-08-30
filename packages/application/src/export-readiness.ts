import { assertExactApprovedArtifact, type RunSnapshot } from "@draft-loop/orchestrator";

/** Return a content-free approval failure suitable for an application error. */
export function exactApprovedArtifactFailure(snapshot: RunSnapshot): string | null {
  try {
    assertExactApprovedArtifact(
      snapshot.artifact,
      snapshot.approvedArtifact,
      snapshot.readinessDecision,
    );
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "The approved artifact is invalid.";
  }
}
