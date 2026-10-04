/** Bounded, content-free progress of one planned canonical profile extraction. */
export interface CanonicalProfileExtractionProgress {
  readonly completedCalls: number;
  readonly plannedCalls: number;
}

export type CanonicalProfileExtractionProgressListener = (
  progress: CanonicalProfileExtractionProgress,
) => void;

/** Report progress without letting a faulty observer affect extraction. */
export function reportCanonicalProfileExtractionProgress(
  listener: CanonicalProfileExtractionProgressListener | undefined,
  completedCalls: number,
  plannedCalls: number,
): void {
  if (listener === undefined) return;
  try {
    listener(Object.freeze({ completedCalls, plannedCalls }));
  } catch {
    // Progress is advisory; observer failures never change extraction behavior.
  }
}
