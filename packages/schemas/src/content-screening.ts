import { z } from "zod";
import { nonEmptyString, strictTimestampSchema } from "./schema-primitives.js";

/**
 * Content screening result v1: the outcome of screening one piece of untrusted text (a pasted job
 * source or an uploaded candidate source file) for prompt injection before any model reads it
 * (ADR 0011, phase 2d).
 *
 * A result is content-free by construction. It carries closed signal codes and screener identity,
 * never a quote, offset or excerpt of the screened text, so it can be stored and shown without
 * becoming a second copy of the material. Objects are strict, so a stray field is rejected rather
 * than stored.
 *
 * The subject (which source version or job source a result covers) is deliberately not part of
 * this schema. Storage keys each result by its subject.
 */

export const contentScreeningVerdicts = ["clear", "flagged", "unscreened"] as const;
export type ContentScreeningVerdict = (typeof contentScreeningVerdicts)[number];

/**
 * What a screener may report. The set is closed: a screener that finds something else maps it to
 * the nearest code rather than inventing one.
 *
 * - `hidden-text`: text a reader would not see, such as zero-width or white-on-white text.
 * - `instruction-override`: text that tells a model to ignore or replace its instructions.
 * - `role-change`: text that tells a model to take another role or persona.
 * - `exfiltration-link`: a link or instruction that would send material to a third party.
 * - `screener-unavailable`: a screener did not produce a usable verdict, so the text is unscreened.
 */
export const contentScreeningSignals = [
  "exfiltration-link",
  "hidden-text",
  "instruction-override",
  "role-change",
  "screener-unavailable",
] as const;
export type ContentScreeningSignal = (typeof contentScreeningSignals)[number];

/** Which screener ran: its id (such as `rules` or `model`), its version, and a model's identity. */
export const contentScreenerIdentitySchema = z.strictObject({
  id: nonEmptyString.max(64),
  version: nonEmptyString.max(64),
  provider: nonEmptyString.max(64).optional(),
  model: nonEmptyString.max(128).optional(),
});
export type ContentScreenerIdentity = z.infer<typeof contentScreenerIdentitySchema>;

const contentScreeningSignalSchema = z.enum(contentScreeningSignals);

/** Signals sorted ascending with no duplicates, so equal findings serialize identically. */
function isSortedUnique(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || (values[index - 1] ?? "") < value);
}

export const contentScreeningResultSchema = z
  .strictObject({
    verdict: z.enum(contentScreeningVerdicts),
    signals: z.array(contentScreeningSignalSchema).max(contentScreeningSignals.length),
    screeners: z.array(contentScreenerIdentitySchema).max(16),
    screenedAt: strictTimestampSchema,
  })
  .superRefine((result, context) => {
    if (!isSortedUnique(result.signals)) {
      context.addIssue({
        code: "custom",
        path: ["signals"],
        message: "signals must be sorted and unique",
      });
    }
    const ids = result.screeners.map((screener) => screener.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["screeners"],
        message: "screener ids must be unique",
      });
    }
    const contentSignals = result.signals.filter((signal) => signal !== "screener-unavailable");
    if (result.verdict === "clear") {
      if (result.signals.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["signals"],
          message: "a clear result has no signals",
        });
      }
      if (result.screeners.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["screeners"],
          message: "a clear result needs at least one screener",
        });
      }
    } else if (result.verdict === "flagged") {
      if (contentSignals.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["signals"],
          message: "a flagged result needs at least one signal other than screener-unavailable",
        });
      }
    } else if (!result.signals.includes("screener-unavailable") || contentSignals.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["signals"],
        message: "an unscreened result has exactly the signal screener-unavailable",
      });
    }
  });
export type ContentScreeningResult = z.infer<typeof contentScreeningResultSchema>;
