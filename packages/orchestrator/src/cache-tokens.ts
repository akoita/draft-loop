/** The prompt-cache reads and writes a call reported, as the optional members a record carries. */
export function cacheTokens(
  usage: Readonly<{ cachedInputTokens?: number; cacheWriteInputTokens?: number }>,
): Readonly<{ cachedInputTokens?: number; cacheWriteInputTokens?: number }> {
  return {
    ...(usage.cachedInputTokens === undefined
      ? {}
      : { cachedInputTokens: usage.cachedInputTokens }),
    ...(usage.cacheWriteInputTokens === undefined
      ? {}
      : { cacheWriteInputTokens: usage.cacheWriteInputTokens }),
  };
}
