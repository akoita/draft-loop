/**
 * Keep a stamp from preceding the persisted records it describes when the wall
 * clock steps backward between commands or engine instances.
 */
export function notBefore(requested: string, ...floors: readonly (string | undefined)[]): string {
  const requestedTime = Date.parse(requested);
  if (!Number.isFinite(requestedTime)) return requested;
  let latest = requested;
  let latestTime = requestedTime;
  for (const floor of floors) {
    if (floor === undefined) continue;
    const floorTime = Date.parse(floor);
    if (Number.isFinite(floorTime) && floorTime > latestTime) {
      latest = floor;
      latestTime = floorTime;
    }
  }
  return latest;
}

/**
 * Backward wall-clock steps observed under load are about 1.2 s. A
 * caller-supplied record dated further ahead is future-dated input, not skew.
 */
export const clockStepToleranceMs = 5 * 60_000;

/**
 * Like `notBefore` for one caller-supplied floor, but ignores a floor beyond
 * the clock-step tolerance so validators still reject future-dated input.
 */
export function notBeforeWithinClockStep(requested: string, floor: string): string {
  const ahead = Date.parse(floor) - Date.parse(requested);
  return ahead <= clockStepToleranceMs ? notBefore(requested, floor) : requested;
}
