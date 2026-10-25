/**
 * The run's stop reason in plain words (#1113).
 *
 * Only the reasons that explain why the loop stopped or paused on finding resolution are worded
 * here; every other reason keeps the existing run status. The reason arrives as the evaluation's
 * `stopReason`, so it needs no field of its own on the review state.
 */
export const CONSENSUS_READY_REASON = "Stopped: author and critic agree it's ready";
export const PERSISTING_FINDINGS_REASON =
  "Paused: the same blocking finding persisted for two rounds — decide it to continue";

/** The plain sentence for a stop reason, or null when the reason has no wording of its own. */
export function plainStopReason(stopReason: string): string | null {
  switch (stopReason) {
    case "consensus-ready":
      return CONSENSUS_READY_REASON;
    case "persisting-findings":
      return PERSISTING_FINDINGS_REASON;
    default:
      return null;
  }
}
