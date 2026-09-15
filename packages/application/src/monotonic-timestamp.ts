/** Keep application-generated timestamps nondecreasing across wall-clock regressions. */
export function monotonicTimestamp(clock: () => string): () => string {
  let latestTime = Number.NEGATIVE_INFINITY;
  let latestValue: string | undefined;

  return () => {
    const value = clock();
    const time = Date.parse(value);
    if (!Number.isFinite(time)) return value;
    if (time < latestTime && latestValue !== undefined) return latestValue;
    latestTime = time;
    latestValue = value;
    return value;
  };
}
