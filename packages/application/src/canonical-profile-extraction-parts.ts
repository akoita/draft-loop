import { mapWithConcurrency, normalizeConcurrency } from "./map-with-concurrency.js";

export const defaultCanonicalProfileExtractionConcurrency = 4;
/** Mistral Large 4 tolerates more concurrent requests, so its planned parts run wider. */
export const mistralCanonicalProfileExtractionConcurrency = 8;

/** Default number of planned parts run at once for the extraction model's company. */
export function defaultCanonicalProfileExtractionConcurrencyFor(company: string): number {
  return company === "mistral"
    ? mistralCanonicalProfileExtractionConcurrency
    : defaultCanonicalProfileExtractionConcurrency;
}
const defaultMaximumCachedParts = 256;

/** In-memory results of completed extraction parts, kept so a retry re-runs only failed parts. */
export interface CanonicalProfileExtractionPartCache<E> {
  readonly get: (key: string) => E | undefined;
  readonly set: (key: string, entry: E) => void;
  readonly delete: (key: string) => void;
  readonly size: () => number;
  readonly clear: () => void;
}

/** Bounded cache that evicts the oldest entry first. */
export function createCanonicalProfileExtractionPartCache<E>(
  maximumEntries = defaultMaximumCachedParts,
): CanonicalProfileExtractionPartCache<E> {
  const entries = new Map<string, E>();
  return Object.freeze({
    get: (key: string) => entries.get(key),
    set: (key: string, entry: E) => {
      entries.delete(key);
      entries.set(key, entry);
      while (entries.size > maximumEntries) {
        const oldest = entries.keys().next();
        if (oldest.done === true) break;
        entries.delete(oldest.value);
      }
    },
    delete: (key: string) => {
      entries.delete(key);
    },
    size: () => entries.size,
    clear: () => entries.clear(),
  });
}

export interface CanonicalProfileExtractionPartRun<R, E> {
  readonly result: R;
  readonly entry: E;
}

export interface CanonicalProfileExtractionPartsOptions<P, R, E> {
  readonly parts: readonly P[];
  readonly keyOf: (part: P) => string;
  /** Execute one part, or replay it from a cached entry when one is supplied. */
  readonly run: (
    part: P,
    cached: E | undefined,
  ) => Promise<CanonicalProfileExtractionPartRun<R, E>>;
  readonly cache: CanonicalProfileExtractionPartCache<E>;
  readonly concurrency?: number;
  /** Used when `concurrency` is absent or not a number; defaults to 4. */
  readonly defaultConcurrency?: number;
  /** Whether a failed part gets the single alone-retry; defaults to every failure. */
  readonly shouldRetry?: (error: unknown) => boolean;
  readonly signal?: AbortSignal;
  /** Called with the running count of completed parts, which only increases. */
  readonly onCompleted?: (completed: number, total: number) => void;
}

/**
 * Run every part with bounded concurrency and return results in part order. A part that fails is
 * retried once alone after the others finish, unless `shouldRetry` declines its error; a second
 * failure fails the whole extraction, so a partial result is never returned. Completed parts stay cached after a failure and are dropped on
 * success.
 */
export async function runCanonicalProfileExtractionParts<P, R, E>(
  options: CanonicalProfileExtractionPartsOptions<P, R, E>,
): Promise<R[]> {
  const { parts, cache, signal } = options;
  const concurrency = normalizeConcurrency(
    options.concurrency,
    options.defaultConcurrency ?? defaultCanonicalProfileExtractionConcurrency,
  );
  const keys = parts.map(options.keyOf);
  const results: (R | undefined)[] = parts.map(() => undefined);
  let completed = 0;

  /** Run the given parts and return the failure of each one that did not complete. */
  const attempt = async (indices: readonly number[]): Promise<Map<number, unknown>> => {
    const settled = await mapWithConcurrency(
      indices,
      concurrency,
      async (partIndex) => {
        const key = keys[partIndex] as string;
        const run = await options.run(parts[partIndex] as P, cache.get(key));
        cache.set(key, run.entry);
        results[partIndex] = run.result;
        completed += 1;
        options.onCompleted?.(completed, parts.length);
      },
      signal,
    );
    if (signal?.aborted === true) signal.throwIfAborted();
    const failures = new Map<number, unknown>();
    for (const [position, outcome] of settled.entries()) {
      if (outcome.status === "rejected") failures.set(indices[position] as number, outcome.reason);
    }
    return failures;
  };

  let failures = await attempt(parts.map((_, index) => index));
  if (failures.size > 0) {
    const shouldRetry = options.shouldRetry ?? (() => true);
    const retryable = [...failures].filter(([, error]) => shouldRetry(error));
    const final = new Map([...failures].filter(([, error]) => !shouldRetry(error)));
    if (retryable.length > 0) {
      const retried = await attempt(retryable.map(([index]) => index));
      for (const [index, error] of retried) final.set(index, error);
    }
    failures = final;
  }
  if (failures.size > 0) throw failures.get(Math.min(...failures.keys()));
  for (const key of keys) cache.delete(key);
  return results as R[];
}
