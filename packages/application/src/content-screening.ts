import {
  type ContentScreenerIdentity,
  type ContentScreeningResult,
  type ContentScreeningSignal,
  contentScreeningResultSchema,
} from "@draft-loop/schemas/content-screening";

/**
 * Screening of untrusted text for prompt injection before any model reads it (ADR 0011, phase
 * 2d). `ContentScreener` is the port; the rule screener (packages/ingestion) and the model
 * screener (packages/model-gateway) implement it, and `screenWith` combines them. Storage and the
 * API consume the combined `ContentScreeningResult`, which is content-free and does not name its
 * subject (see `@draft-loop/schemas/content-screening`).
 */

export type {
  ContentScreenerIdentity,
  ContentScreeningResult,
  ContentScreeningSignal,
  ContentScreeningVerdict,
} from "@draft-loop/schemas/content-screening";

/** What the text is, so a screener can tune its rules. */
export type ContentScreeningKind = "job-source" | "candidate-source";

export interface ContentScreeningInput {
  readonly text: string;
  readonly kind: ContentScreeningKind;
}

export interface ContentScreener {
  /** Who this screener is. The combinator records it even when `screen` throws. */
  readonly identity: ContentScreenerIdentity;
  /**
   * Screens at most `maximumContentScreeningChars` characters; `screenWith` splits longer text
   * first. It resolves with a verdict, or rejects when it cannot decide. It never needs to catch
   * its own failures: the combinator fails closed on them.
   */
  screen(input: ContentScreeningInput): Promise<ContentScreeningResult>;
}

/** The longest text one `screen` call receives, in UTF-16 code units. */
export const maximumContentScreeningChars = 200_000;

/**
 * Consecutive chunks share this many characters, so a phrase that straddles a boundary is whole
 * in at least one chunk.
 */
export const contentScreeningChunkOverlapChars = 2_000;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Splits text into overlapping chunks of at most `maximumContentScreeningChars`. Text within the
 * cap is one chunk. Nothing is dropped, and no chunk starts or ends inside a surrogate pair.
 */
export function splitForContentScreening(text: string): string[] {
  if (text.length <= maximumContentScreeningChars) {
    return [text];
  }
  const chunks: string[] = [];
  let start = 0;
  while (true) {
    let end = Math.min(start + maximumContentScreeningChars, text.length);
    if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1))) {
      end -= 1;
    }
    chunks.push(text.slice(start, end));
    if (end >= text.length) {
      return chunks;
    }
    start = end - contentScreeningChunkOverlapChars;
    if (isLowSurrogate(text.charCodeAt(start))) {
      start += 1;
    }
  }
}

/**
 * Runs the screeners in order over every chunk of the text and merges what they report.
 *
 * - Any content signal makes the result `flagged`, whatever else was clear.
 * - A screener that throws, returns a result that fails the schema, or reports `unscreened`
 *   counts as unavailable. That adds `screener-unavailable`, and the result is `unscreened`
 *   unless another screener flagged the text, in which case it is `flagged` with both.
 * - Otherwise the result is `clear`.
 *
 * Every screener's identity is recorded, including those that failed. With no screeners the text
 * is unscreened. The result carries only closed codes and identities, never text or error messages.
 */
export async function screenWith(
  screeners: readonly ContentScreener[],
  input: ContentScreeningInput,
  now: () => string = () => new Date().toISOString(),
): Promise<ContentScreeningResult> {
  const chunks = splitForContentScreening(input.text);
  const signals = new Set<ContentScreeningSignal>();
  let unavailable = screeners.length === 0;
  for (const screener of screeners) {
    for (const text of chunks) {
      const outcome = await screenOnce(screener, { text, kind: input.kind });
      if (outcome === null) {
        unavailable = true;
        continue;
      }
      for (const signal of outcome.signals) {
        if (signal === "screener-unavailable") {
          unavailable = true;
        } else {
          signals.add(signal);
        }
      }
      unavailable ||= outcome.verdict === "unscreened";
    }
  }
  const verdict = signals.size > 0 ? "flagged" : unavailable ? "unscreened" : "clear";
  if (unavailable) {
    signals.add("screener-unavailable");
  }
  return contentScreeningResultSchema.parse({
    verdict,
    signals: [...signals].sort(),
    screeners: screeners.map((screener) => ({ ...screener.identity })),
    screenedAt: now(),
  });
}

/** One screener on one chunk; `null` when it threw or answered outside the contract. */
async function screenOnce(
  screener: ContentScreener,
  input: ContentScreeningInput,
): Promise<ContentScreeningResult | null> {
  try {
    const parsed = contentScreeningResultSchema.safeParse(await screener.screen(input));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
