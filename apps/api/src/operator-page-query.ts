import { z } from "zod";

/** The longest search an operator list takes. */
export const operatorSearchMaxLength = 200;

/** Paging and search for an operator list (#3016): the waitlist, the invites and the inbox. */
export const operatorPageQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  q: z
    .string()
    .max(operatorSearchMaxLength)
    .optional()
    .describe("Only rows that contain this text, without case."),
});
