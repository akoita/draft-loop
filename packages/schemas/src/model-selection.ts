import { maximumModelLineageLength } from "@draft-loop/domain";
import { z } from "zod";

import { modelProfileSchema } from "./model-profile.js";

const nonEmptyString = z.string().trim().min(1, "must not be empty");

export const modelSelectionSchema = z
  .object({
    company: nonEmptyString,
    modelId: nonEmptyString,
    role: z.enum(["author", "critic"]),
    promptTemplateVersion: nonEmptyString,
    /** Derived from company and model id when absent; see `deriveModelLineage`. */
    lineage: nonEmptyString.max(maximumModelLineageLength).optional(),
    profile: modelProfileSchema.optional(),
  })
  .superRefine((selection, context) => {
    const profile = selection.profile;
    if (profile === undefined) return;

    if (profile.provider !== selection.company) {
      context.addIssue({
        code: "custom",
        path: ["profile", "provider"],
        message: "must match the selected model company",
      });
    }
    if (profile.modelId !== selection.modelId) {
      context.addIssue({
        code: "custom",
        path: ["profile", "modelId"],
        message: "must match the selected exact model id",
      });
    }
    if (!profile.roles.includes(selection.role)) {
      context.addIssue({
        code: "custom",
        path: ["profile", "roles"],
        message: "must include the selected model role",
      });
    }
  });

export type ModelSelection = z.infer<typeof modelSelectionSchema>;
