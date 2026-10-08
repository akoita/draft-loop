import { z } from "zod";

export const nonEmptyString = z.string().trim().min(1, "must not be empty");

export const strictTimestampSchema = z
  .string()
  .refine(
    (value) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
      !Number.isNaN(Date.parse(value)),
    "must be a valid ISO timestamp",
  );
