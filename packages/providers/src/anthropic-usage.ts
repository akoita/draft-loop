function cacheCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/**
 * Map Anthropic usage to the OpenAI-shaped usage that `accountOpenAIUsage` reads.
 *
 * Anthropic's `input_tokens` counts only the uncached input; prompt-cache reads
 * and writes are reported beside it. They are folded back in so the recorded
 * input total is every input token the request carried, with the cached share
 * kept as detail. Claude Code's JSON result reports usage the same way.
 */
export function anthropicUsage(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const usage = value as Record<string, unknown>;
  const read = cacheCount(usage.cache_read_input_tokens);
  const write = cacheCount(usage.cache_creation_input_tokens);
  const uncached = usage.input_tokens;
  const mapped: Record<string, unknown> = { output_tokens: usage.output_tokens };
  mapped.input_tokens =
    typeof uncached === "number" && (read !== undefined || write !== undefined)
      ? uncached + (read ?? 0) + (write ?? 0)
      : uncached;
  if (read !== undefined || write !== undefined) {
    mapped.input_tokens_details = {
      ...(read === undefined ? {} : { cached_tokens: read }),
      ...(write === undefined ? {} : { cache_write_tokens: write }),
    };
  }
  return mapped;
}
