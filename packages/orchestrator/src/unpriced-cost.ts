/**
 * Routes with no metered cost: a person's subscription session, a local model and the fixtures.
 * Their calls are unpriced by design, so a cost limit does not apply to them.
 */
const unmeteredRoutes: ReadonlySet<string> = new Set(["user-session", "local", "fixture"]);

interface MeteredSnapshot {
  readonly executionHistory: readonly PricedCall[];
  readonly applicationPlan?: {
    readonly steps: readonly {
      readonly route?: string | undefined;
      readonly estimatedUsd: number | null;
    }[];
  } | null;
}

/** A run's provider calls: its executions and the plan step's calls, which are completed ones. */
export function meteredCalls(snapshot: MeteredSnapshot): readonly PricedCall[] {
  return [
    ...snapshot.executionHistory,
    ...(snapshot.applicationPlan?.steps ?? []).map((step) => ({ ...step, status: "completed" })),
  ];
}

interface PricedCall {
  readonly status: string;
  readonly route?: string | undefined;
  readonly estimatedUsd: number | null;
}

/**
 * Whether a completed call on a metered route has no cost estimate. A run with a cost limit stops
 * then, since its total no longer bounds what it spent (ADR 0011, D5). Records written before
 * routes were recorded name none and are not judged.
 */
export function hasUnpricedMeteredCall(history: readonly PricedCall[]): boolean {
  return history.some(
    (record) =>
      record.status === "completed" &&
      record.estimatedUsd === null &&
      record.route !== undefined &&
      !unmeteredRoutes.has(record.route),
  );
}
