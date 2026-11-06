import {
  applicationFolderIdPattern,
  applicationFolderNameMaxLength,
  normalizeApplicationFolderName,
} from "@draft-loop/domain/application-folder";
import { z } from "zod";
import { strictTimestampSchema } from "./schema-primitives.js";

export const applicationFolderIdSchema = z
  .string()
  .regex(applicationFolderIdPattern, "must be a folder id such as fld_ and 8 to 64 characters");

/** A folder name as the person typed it, normalized: trimmed, inner spaces collapsed. */
export const applicationFolderNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(applicationFolderNameMaxLength)
  .transform((name) => normalizeApplicationFolderName(name));

/** One named section of a workspace's applications (#2280). It holds no candidate material. */
export const applicationFolderSchema = z
  .object({
    id: applicationFolderIdSchema,
    name: z.string().min(1).max(applicationFolderNameMaxLength),
    createdAt: strictTimestampSchema,
    updatedAt: strictTimestampSchema,
  })
  .strict();
export type ApplicationFolder = z.infer<typeof applicationFolderSchema>;

/** Where an application sits: a folder's id, or `null` for "No folder". */
export const applicationFolderPlacementSchema = applicationFolderIdSchema.nullable();
