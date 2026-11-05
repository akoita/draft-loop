/**
 * Run `task` over `items` with at most `limit` calls in flight, and return the results in item
 * order (#2233). After the first failure no new call starts; the calls already in flight finish,
 * so whatever they billed is counted, and then the first failure is thrown.
 */
export async function mapWithBoundedConcurrency<Item, Result>(
  items: readonly Item[],
  limit: number,
  task: (item: Item, index: number) => Promise<Result>,
): Promise<Result[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`Concurrency limit must be a positive integer, got ${limit}.`);
  }
  const results: Result[] = new Array(items.length);
  let next = 0;
  let failure: { readonly error: unknown } | undefined;
  const worker = async (): Promise<void> => {
    while (failure === undefined && next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await task(items[index] as Item, index);
      } catch (error) {
        failure ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  if (failure !== undefined) throw failure.error;
  return results;
}
