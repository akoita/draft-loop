import type { ModelProfile } from "@draft-loop/domain/model-profile";
import {
  modelProfileEfforts,
  modelProfileThinkingModes,
  modelProfileTiers,
} from "@draft-loop/domain/model-profile";
import { z } from "zod";

const positiveSafeInteger = z
  .number()
  .finite()
  .int()
  .positive()
  .refine(Number.isSafeInteger, "must be a positive safe integer");

const thinkingSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal(modelProfileThinkingModes[0]) }).strict(),
  z.object({ mode: z.literal(modelProfileThinkingModes[1]) }).strict(),
  z
    .object({
      mode: z.literal(modelProfileThinkingModes[2]),
      maxTokens: positiveSafeInteger,
    })
    .strict(),
]);

const rolesSchema = z
  .array(z.enum(["author", "critic"]))
  .min(1)
  .refine((roles) => new Set(roles).size === roles.length, "roles must be unique");

export const modelProfileSchema: z.ZodType<ModelProfile> = z
  .object({
    id: z.string().trim().min(1),
    version: positiveSafeInteger,
    provider: z.string().trim().min(1),
    modelId: z.string().trim().min(1),
    tier: z.enum(modelProfileTiers),
    roles: rolesSchema,
    runtime: z
      .object({
        effort: z.enum(modelProfileEfforts),
        maxOutputTokens: positiveSafeInteger,
        thinking: thinkingSchema,
      })
      .strict(),
    knownLimits: z
      .object({
        maxOutputTokens: positiveSafeInteger,
        contextWindowTokens: positiveSafeInteger.optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((profile, context) => {
    if (profile.runtime.maxOutputTokens > profile.knownLimits.maxOutputTokens) {
      context.addIssue({
        code: "custom",
        path: ["runtime", "maxOutputTokens"],
        message: "runtime output ceiling cannot exceed the known output limit",
      });
    }
    if (
      profile.runtime.thinking.mode === "budgeted" &&
      profile.runtime.thinking.maxTokens > profile.runtime.maxOutputTokens
    ) {
      context.addIssue({
        code: "custom",
        path: ["runtime", "thinking", "maxTokens"],
        message: "thinking budget cannot exceed the runtime output ceiling",
      });
    }
  });
