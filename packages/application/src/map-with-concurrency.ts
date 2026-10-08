/** Normalize a caller-supplied concurrency to a whole number of at least one. */
export function normalizeConcurrency(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return Math.max(1, Math.floor(fallback));
  return Math.max(1, Math.floor(value));
}

function raceAbort<R>(promise: Promise<R>, signal: AbortSignal | undefined): Promise<R> {
  if (signal === undefined) return promise;
  return new Promise<R>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    if (signal.aborted) {
      promise.catch(() => undefined);
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Run `worker` over `items` with at most `limit` calls in flight and settle every item.
 * Results are returned in item order regardless of completion order. Once `signal` aborts, no
 * further item starts, in-flight items settle as rejected with the abort reason without waiting
 * for the worker, and every unstarted item is rejected with that reason.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<PromiseSettledResult<R>[]> {
  const results: (PromiseSettledResult<R> | undefined)[] = items.map(() => undefined);
  let next = 0;
  const runLane = async (): Promise<void> => {
    while (signal?.aborted !== true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        const value = await raceAbort((async () => worker(items[index] as T, index))(), signal);
        results[index] = { status: "fulfilled", value };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  const laneCount = Math.min(normalizeConcurrency(limit, 1), items.length);
  await Promise.all(Array.from({ length: laneCount }, runLane));
  return results.map(
    (result): PromiseSettledResult<R> =>
      result ?? { status: "rejected", reason: signal?.reason ?? new Error("Item was not run.") },
  );
}
