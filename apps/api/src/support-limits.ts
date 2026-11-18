import type { SecretVersionReader } from "@draft-loop/model-gateway";
import { createSecretManagerCredentialResolver } from "@draft-loop/model-gateway";
import { z } from "zod";

import type { SupportSettings } from "./support-config.js";

/**
 * The support assistant's limits as the operator changes them at run time, without a deploy: a
 * JSON object in a Secret Manager version, read within a minute, like the maintenance notice.
 * Each field it sets replaces the environment's value; a field it leaves out keeps it.
 *
 * `{"assistant":"off"}` is the kill switch: every question gets guide search, at no model cost.
 */
const storedLimitsSchema = z.strictObject({
  assistant: z.enum(["on", "off"]).optional(),
  memberQuestionsPerMinute: z.number().int().min(1).max(60).optional(),
  memberDailyQuestions: z.number().int().min(1).max(1000).optional(),
  dailyCostUsd: z.number().positive().max(100).optional(),
});

export type SupportLimitOverrides = z.infer<typeof storedLimitsSchema>;

/** Gives the operator's overrides; `{}` when none are set or they cannot be read. */
export type SupportLimitSource = () => Promise<SupportLimitOverrides>;

/**
 * Parses the stored text. An empty value or `{}` sets nothing; text that is not a valid object
 * throws, so the reader logs it and keeps the environment's limits.
 */
export function parseSupportLimitOverrides(text: string | undefined): SupportLimitOverrides {
  const trimmed = text?.trim() ?? "";
  if (trimmed === "") return {};
  return storedLimitsSchema.parse(JSON.parse(trimmed));
}

/** The settings one request uses: the environment's, with the operator's overrides on top. */
export function effectiveSupportSettings(
  base: SupportSettings,
  overrides: SupportLimitOverrides,
): SupportSettings {
  return {
    ...base,
    enabled: overrides.assistant === undefined ? base.enabled : overrides.assistant === "on",
    memberQuestionsPerMinute: overrides.memberQuestionsPerMinute ?? base.memberQuestionsPerMinute,
    memberDailyQuestions: overrides.memberDailyQuestions ?? base.memberDailyQuestions,
    dailyCostCapUsd: overrides.dailyCostUsd ?? base.dailyCostCapUsd,
  };
}

export interface SecretSupportLimitOptions {
  /** `projects/<project>/secrets/<name>/versions/latest`, from the deployment. */
  readonly secret: string;
  readonly client?: SecretVersionReader;
  /** How long a read stays in memory; a change applies within it. One minute. */
  readonly ttlMs?: number;
  readonly onReadError?: (error: unknown) => void;
}

/** Reads the overrides from Secret Manager; a failed or invalid read keeps the environment's. */
export function secretSupportLimits(options: SecretSupportLimitOptions): SupportLimitSource {
  const resolve = createSecretManagerCredentialResolver({
    secrets: { limits: options.secret },
    ttlMs: options.ttlMs ?? 60_000,
    ...(options.client === undefined ? {} : { client: options.client }),
  });
  return async () => {
    try {
      return parseSupportLimitOverrides(await resolve("limits"));
    } catch (error) {
      options.onReadError?.(error);
      return {};
    }
  };
}

/** Reads `DRAFT_LOOP_SUPPORT_LIMITS_SECRET`; unset means only the environment sets the limits. */
export function readSupportLimitsSecret(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.DRAFT_LOOP_SUPPORT_LIMITS_SECRET?.trim() ?? "";
  return value === "" ? undefined : value;
}
