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

/**
 * Waiting indicator for profile generation. It belongs inside an existing
 * `role="status"` region: the screen-reader text is static so it is announced
 * once, while the visible title and the ticking elapsed time are hidden from
 * assistive technology so they never re-announce every second.
 */
export function ProfileGenerationProgress({
  startedAt,
  now,
}: {
  readonly startedAt: number;
  readonly now?: number;
}) {
  const [current, setCurrent] = useState(() => now ?? Date.now());

  useEffect(() => {
    const timer = setInterval(() => setCurrent(Date.now()), msPerSecond);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="profile-generation-progress">
      <span className="sr-only">Generating profile.</span>
      <div className="profile-generation-progress-row">
        <span className="profile-generation-spinner" aria-hidden="true" />
        <strong aria-hidden="true">Generating profile…</strong>
        <span className="profile-generation-elapsed" aria-hidden="true">
          Elapsed {formatProfileGenerationElapsed(current - startedAt)}
        </span>
      </div>
      <p className="profile-generation-note">
        Large knowledge bases are processed in parts, so this can take several minutes. Keep
        DraftLoop open.
      </p>
    </div>
  );
}
