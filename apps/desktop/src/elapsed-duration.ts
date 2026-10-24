const msPerSecond = 1000;
const secondsPerMinute = 60;
const secondsPerHour = 3600;

/**
 * Formats an elapsed duration for a running label: `45 s` below a minute, `4 min 36 s` from one
 * minute and `1 h 05 min` from one hour. Partial seconds are dropped; a negative or non-finite
 * duration reads `0 s`.
 */
export function formatElapsedDuration(ms: number): string {
  const totalSeconds = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / msPerSecond) : 0;
  const hours = Math.floor(totalSeconds / secondsPerHour);
  const minutes = Math.floor((totalSeconds % secondsPerHour) / secondsPerMinute);
  const seconds = totalSeconds % secondsPerMinute;
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, "0")} min`;
  if (minutes > 0) return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
  return `${seconds} s`;
}
