/**
 * Repairs for a critique that breaks one of the contract's format rules (#2234). The provider
 * has already billed the critique's large evidence prefix, so a slip in one finding no longer
 * discards the others: a long message is cut, a malformed finding is dropped, and a list over the
 * cap keeps its errors first. Meaning is still checked downstream.
 */

/** Cut a message to `maximum` characters at a word boundary, ending with an ellipsis. */
export function truncateFindingMessage(message: string, maximum: number): string {
  if (message.length <= maximum) return message;
  const room = message.slice(0, maximum - 1);
  const lastSpace = room.lastIndexOf(" ");
  // Keep a hard cut when the only space is too early to leave a useful message.
  const cut = lastSpace >= maximum / 2 ? room.slice(0, lastSpace) : room;
  return `${cut.trimEnd()}…`;
}

/** Keep at most `maximum` findings, errors before warnings, each group in the critic's order. */
export function keepWithinFindingLimit<Finding extends { readonly severity: string }>(
  findings: readonly Finding[],
  maximum: number,
): Finding[] {
  if (findings.length <= maximum) return [...findings];
  const errors = findings.filter(({ severity }) => severity === "error");
  const others = findings.filter(({ severity }) => severity !== "error");
  return [...errors, ...others].slice(0, maximum);
}
