import { defaultSupportLimits, type SupportServiceStatus } from "@draft-loop/support";

import { ApiConfigError } from "./config.js";

/**
 * The support assistant's settings (#2882), from the environment. It is off unless
 * `DRAFT_LOOP_SUPPORT_ASSISTANT=on`, because each question is a paid model call: with it off, or
 * without a Claude route, every question gets the guide sections that match it instead.
 */
export interface SupportSettings {
  readonly enabled: boolean;
  /** Questions one member may ask in any 60 seconds. */
  readonly memberQuestionsPerMinute: number;
  readonly memberDailyQuestions: number;
  /** Across all members of this API instance, in US dollars of estimated model cost. */
  readonly dailyCostCapUsd: number;
  /** What `get_service_status` reports; the operator sets it during an incident. */
  readonly serviceStatus: SupportServiceStatus;
}

const serviceStates = ["operational", "degraded", "down"] as const;

export function readSupportSettings(env: NodeJS.ProcessEnv): SupportSettings {
  const switchValue = env.DRAFT_LOOP_SUPPORT_ASSISTANT ?? "off";
  if (switchValue !== "on" && switchValue !== "off") {
    throw new ApiConfigError("DRAFT_LOOP_SUPPORT_ASSISTANT must be on or off.");
  }
  const state = env.DRAFT_LOOP_SUPPORT_SERVICE_STATE ?? "operational";
  if (!(serviceStates as readonly string[]).includes(state)) {
    throw new ApiConfigError(
      "DRAFT_LOOP_SUPPORT_SERVICE_STATE must be operational, degraded or down.",
    );
  }
  const codes = (env.DRAFT_LOOP_SUPPORT_SERVICE_CODES ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter((code) => code !== "");
  if (codes.some((code) => !/^[a-z0-9-]{1,40}$/u.test(code))) {
    throw new ApiConfigError(
      "DRAFT_LOOP_SUPPORT_SERVICE_CODES must be comma-separated codes of lower-case letters, digits and hyphens.",
    );
  }
  return {
    enabled: switchValue === "on",
    memberQuestionsPerMinute: readPositive(
      env.DRAFT_LOOP_SUPPORT_MEMBER_QUESTIONS_PER_MINUTE,
      "DRAFT_LOOP_SUPPORT_MEMBER_QUESTIONS_PER_MINUTE",
      defaultSupportLimits.memberQuestionsPerMinute,
      true,
    ),
    memberDailyQuestions: readPositive(
      env.DRAFT_LOOP_SUPPORT_MEMBER_DAILY_QUESTIONS,
      "DRAFT_LOOP_SUPPORT_MEMBER_DAILY_QUESTIONS",
      defaultSupportLimits.memberDailyQuestions,
      true,
    ),
    dailyCostCapUsd: readPositive(
      env.DRAFT_LOOP_SUPPORT_DAILY_COST_USD,
      "DRAFT_LOOP_SUPPORT_DAILY_COST_USD",
      defaultSupportLimits.dailyCostCapUsd,
      false,
    ),
    serviceStatus: { state: state as SupportServiceStatus["state"], codes },
  };
}

function readPositive(
  value: string | undefined,
  name: string,
  fallback: number,
  whole: boolean,
): number {
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  const valid = whole ? /^\d+$/u.test(value) && number >= 1 : Number.isFinite(number) && number > 0;
  if (!valid) {
    throw new ApiConfigError(
      `${name} must be ${whole ? "a whole number of at least 1" : "a positive number"}.`,
    );
  }
  return number;
}
