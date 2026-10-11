import { useEffect, useState } from "react";

const msPerSecond = 1000;
const secondsPerMinute = 60;
const secondsPerHour = 3600;

/** Formats an elapsed duration as `m:ss`, or `h:mm:ss` from one hour. */
export function formatProfileGenerationElapsed(ms: number): string {
  const totalSeconds = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / msPerSecond) : 0;
  const hours = Math.floor(totalSeconds / secondsPerHour);
  const minutes = Math.floor((totalSeconds % secondsPerHour) / secondsPerMinute);
  const seconds = totalSeconds % secondsPerMinute;
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
  return `${minutes}:${ss}`;
}

export interface ProfileGenerationCallProgress {
  readonly completedCalls: number;
  readonly plannedCalls: number;
}

/**
 * A profile generation still running, as the profile page reports it to the rest of the window so
 * Home can show it in progress while the person works elsewhere.
 */
export interface ProfileGenerationActivity {
  readonly startedAt: number;
  readonly progress?: ProfileGenerationCallProgress;
}

/** The part label is shown only once the host has reported a bounded plan. */
export function formatProfileGenerationPart(
  progress: ProfileGenerationCallProgress | undefined,
): string | null {
  if (progress === undefined || progress.plannedCalls < 1) return null;
  if (progress.completedCalls >= progress.plannedCalls) return "Finishing…";
  // Parts run in parallel, so report finished parts rather than a "current" part.
  return `${Math.max(progress.completedCalls, 0)} of ${progress.plannedCalls} parts done`;
}

/**
 * Waiting indicator for profile generation. It belongs inside an existing
 * `role="status"` region: the screen-reader text is static so it is announced
 * once, while the visible title and the ticking elapsed time are hidden from
 * assistive technology so they never re-announce every second.
 */
/** The elapsed time since `startedAt`, ticking once a second while the caller is shown. */
function useElapsed(startedAt: number, now?: number): string {
  const [current, setCurrent] = useState(() => now ?? Date.now());
  useEffect(() => {
    setCurrent(Date.now());
    const timer = setInterval(() => setCurrent(Date.now()), msPerSecond);
    return () => clearInterval(timer);
  }, []);
  return formatProfileGenerationElapsed(current - startedAt);
}

export function ProfileGenerationProgress({
  startedAt,
  now,
  progress,
}: {
  readonly startedAt: number;
  readonly now?: number;
  readonly progress?: ProfileGenerationCallProgress;
}) {
  const part = formatProfileGenerationPart(progress);
  const elapsed = useElapsed(startedAt, now);

  return (
    <div className="profile-generation-progress">
      <span className="sr-only">Generating profile.</span>
      <div className="profile-generation-progress-row">
        <span className="profile-generation-spinner" aria-hidden="true" />
        <strong aria-hidden="true">Generating profile…</strong>
        <span className="profile-generation-elapsed" aria-hidden="true">
          Elapsed {elapsed}
        </span>
        {part === null ? null : (
          <span className="profile-generation-part" aria-hidden="true">
            {part}
          </span>
        )}
      </div>
      <p className="profile-generation-note">
        Large knowledge bases are processed in parts, so this can take several minutes. Keep
        DraftLoop open.
      </p>
    </div>
  );
}

/**
 * The one-line progress Home shows on the Career profile card while a generation runs elsewhere:
 * elapsed time and finished parts, without the Cancel action, which stays on the profile page.
 */
export function ProfileGenerationSummary({
  activity,
  now,
}: {
  readonly activity: ProfileGenerationActivity;
  readonly now?: number;
}) {
  const part = formatProfileGenerationPart(activity.progress);
  const elapsed = useElapsed(activity.startedAt, now);
  return (
    <p className="profile-generation-progress-row home-profile-progress">
      <span className="profile-generation-spinner" aria-hidden="true" />
      <span className="sr-only">Generating profile.</span>
      <strong aria-hidden="true">Generating…</strong>
      <span className="profile-generation-elapsed" aria-hidden="true">
        Elapsed {elapsed}
      </span>
      {part === null ? null : (
        <span className="profile-generation-part" aria-hidden="true">
          {part}
        </span>
      )}
    </p>
  );
}

/** Stops the pending generation; it is disabled after one click so a cancel is requested once. */
export function ProfileGenerationCancel({
  cancelling,
  onCancel,
}: {
  readonly cancelling: boolean;
  readonly onCancel: () => void;
}) {
  return (
    <button
      className="button button-outline profile-generation-cancel"
      type="button"
      disabled={cancelling}
      onClick={onCancel}
    >
      {cancelling ? "Cancelling…" : "Cancel generation"}
    </button>
  );
}
