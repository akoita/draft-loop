/**
 * Durable accounting for the portion of a run spent in provider-active
 * orchestration states. A null activeSince means that the run is currently
 * waiting for a user, paused, or otherwise not doing active work.
 */
export interface DurationAccounting {
  readonly activeDurationMs: number;
  readonly activeSince: string | null;
}

export interface DurationAccountingInspection {
  readonly valid: boolean;
  readonly legacy: boolean;
  readonly activeDurationMs: number;
}

interface ValidDurationAccounting extends DurationAccounting {}

function timestampMs(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function validNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseAccounting(value: unknown): ValidDurationAccounting | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("activeDurationMs") || !keys.includes("activeSince")) {
    return undefined;
  }
  const candidate = value as {
    readonly activeDurationMs?: unknown;
    readonly activeSince?: unknown;
  };
  if (!validNonNegativeNumber(candidate.activeDurationMs)) return undefined;
  if (candidate.activeSince !== null && timestampMs(candidate.activeSince) === undefined) {
    return undefined;
  }
  return {
    activeDurationMs: candidate.activeDurationMs,
    activeSince: candidate.activeSince === null ? null : (candidate.activeSince as string),
  };
}

function elapsedSince(start: number, now: number): number {
  // A wall clock can move backwards. Active time is monotonic from the
  // accounting perspective, so a regression contributes no elapsed time.
  return Math.max(0, now - start);
}

/**
 * Inspect persisted accounting without throwing. Invalid persisted values are
 * deliberately represented as invalid so callers can fail closed at a budget
 * boundary instead of treating them as zero elapsed time.
 */
export function inspectDurationAccounting(
  accounting: unknown,
  startedAt: unknown,
  now: unknown,
): DurationAccountingInspection {
  const startedMs = timestampMs(startedAt);
  const nowMs = timestampMs(now);
  if (startedMs === undefined || nowMs === undefined) {
    return {
      valid: false,
      legacy: accounting === undefined,
      activeDurationMs: Number.POSITIVE_INFINITY,
    };
  }

  if (accounting === undefined) {
    return {
      valid: true,
      legacy: true,
      activeDurationMs: elapsedSince(startedMs, nowMs),
    };
  }

  const parsed = parseAccounting(accounting);
  if (parsed === undefined) {
    return { valid: false, legacy: false, activeDurationMs: Number.POSITIVE_INFINITY };
  }
  const activeSinceMs = parsed.activeSince === null ? undefined : timestampMs(parsed.activeSince);
  const activeDurationMs =
    activeSinceMs === undefined
      ? parsed.activeDurationMs
      : parsed.activeDurationMs + elapsedSince(activeSinceMs, nowMs);
  if (!Number.isFinite(activeDurationMs)) {
    return { valid: false, legacy: false, activeDurationMs: Number.POSITIVE_INFINITY };
  }
  return {
    valid: true,
    legacy: false,
    activeDurationMs,
  };
}

/** Create accounting for a newly-created run, which starts in active work. */
export function createDurationAccounting(startedAt: string): DurationAccounting {
  if (timestampMs(startedAt) === undefined) {
    throw new Error("The run startedAt timestamp is invalid.");
  }
  return { activeDurationMs: 0, activeSince: startedAt };
}

function requireInspection(
  accounting: unknown,
  startedAt: string,
  now: string,
): DurationAccountingInspection {
  const inspected = inspectDurationAccounting(accounting, startedAt, now);
  if (!inspected.valid) throw new Error("The persisted duration accounting is invalid.");
  return inspected;
}

/** Return current active milliseconds, preserving the legacy wall-time fallback. */
export function currentActiveDurationMs(
  accounting: unknown,
  startedAt: string,
  now: string,
): number {
  return requireInspection(accounting, startedAt, now).activeDurationMs;
}

/**
 * Settle accounting when leaving active work. Legacy snapshots are migrated by
 * preserving their conservative wall-clock elapsed amount at this transition.
 */
export function settleDurationAccounting(
  accounting: unknown,
  startedAt: string,
  now: string,
): DurationAccounting {
  const inspected = requireInspection(accounting, startedAt, now);
  return { activeDurationMs: inspected.activeDurationMs, activeSince: null };
}

/**
 * Resume active work. Existing active accounting remains continuous; paused,
 * errored, and legacy accounting starts a new active segment at `now` while
 * preserving all elapsed milliseconds already accounted for.
 */
export function activateDurationAccounting(
  accounting: unknown,
  startedAt: string,
  now: string,
): DurationAccounting {
  const inspected = requireInspection(accounting, startedAt, now);
  if (!inspected.legacy) {
    const parsed = parseAccounting(accounting);
    if (parsed !== undefined && parsed.activeSince !== null) return parsed;
  }
  return { activeDurationMs: inspected.activeDurationMs, activeSince: now };
}
