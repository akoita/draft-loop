import {
  applicationNameMaxLength,
  applicationStatuses,
  defaultApplicationId,
} from "@draft-loop/domain/application";
import { z } from "zod";
import { strictTimestampSchema } from "./schema-primitives.js";

export const applicationIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,78}[A-Za-z0-9])?$/u, "must be a safe identifier");

export const applicationNameSchema = z.string().trim().min(1).max(applicationNameMaxLength);

/**
 * Where an application's job description comes from. Pasted text lives in the workspace at
 * `storedPath`; a URL needs explicit approval; a local file is referenced, not copied.
 */
export const applicationJobSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pasted-text"), storedPath: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal("approved-url"),
      url: z.url({ protocol: /^https?$/u }),
      approved: z.literal(true),
    })
    .strict(),
  z.object({ kind: z.literal("local-file"), path: z.string().min(1) }).strict(),
]);
export type ApplicationJobSource = z.infer<typeof applicationJobSourceSchema>;

export const applicationSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: applicationIdSchema,
    name: applicationNameSchema,
    jobSource: applicationJobSourceSchema,
    createdAt: strictTimestampSchema,
    updatedAt: strictTimestampSchema,
    status: z.enum(applicationStatuses),
    /** True for the application a legacy workspace is read as. */
    isDefault: z.boolean(),
  })
  .strict()
  .refine((value) => value.isDefault === (value.id === defaultApplicationId), {
    message: "only the default application uses the reserved id",
  });
export type Application = z.infer<typeof applicationSchema>;
