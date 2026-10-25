import type { ReviewAction } from "./model.js";

export interface PendingReviewAction {
  readonly action: ReviewAction["type"];
  readonly elapsedSeconds: number;
}

interface PendingReviewState extends PendingReviewAction {
  readonly startedAt: number;
}

type ReviewActionOperation = () => Promise<unknown>;

/**
 * Starts one review action at a time and publishes a bounded pending projection.
 * The synchronous local state closes the duplicate-dispatch window before the
 * asynchronous port operation begins.
 */
export function createReviewActionDispatcher(
  onPendingChange: (pending: PendingReviewAction | null) => void,
  clock: () => number = Date.now,
): {
  readonly dispatch: (action: ReviewAction, operation: ReviewActionOperation) => boolean;
  readonly updateElapsed: () => void;
} {
  let pending: PendingReviewState | null = null;

  const publish = (value: PendingReviewState | null): void => {
    pending = value;
    onPendingChange(
      value === null ? null : { action: value.action, elapsedSeconds: value.elapsedSeconds },
    );
  };

  return {
    dispatch: (action, operation) => {
      if (pending !== null) return false;
      publish({ action: action.type, startedAt: clock(), elapsedSeconds: 0 });
      void Promise.resolve()
        .then(operation)
        .catch(() => undefined)
        .finally(() => publish(null));
      return true;
    },
    updateElapsed: () => {
      if (pending === null) return;
      publish({
        ...pending,
        elapsedSeconds: Math.max(0, Math.floor((clock() - pending.startedAt) / 1_000)),
      });
    },
  };
}
