import { createJevScreeningShadow, type DecisionScreeningShadow } from "@draft-loop/model-gateway";

import { ApiConfigError } from "./config.js";

/**
 * The screening shadow (#2247): `off` (the default) or `jev`, which sends each public job page the
 * rules screened to Jev and logs how its signals compare, without changing any verdict. Jev
 * processes in the US, so it never receives candidate material, whatever the consent.
 */
export const screeningShadowModes = ["off", "jev"] as const;
export type ScreeningShadowMode = (typeof screeningShadowModes)[number];

export type ScreeningShadowConfig =
  | { readonly mode: "off" }
  | { readonly mode: "jev"; readonly apiKey: string; readonly maxDailyUsd: number };

export const defaultScreeningShadowMaxDailyUsd = 0.1;

/**
 * Reads `DRAFT_LOOP_SCREENING_SHADOW`, `DRAFT_LOOP_JEV_API_KEY` and
 * `DRAFT_LOOP_SCREENING_SHADOW_MAX_DAILY_USD`. An unknown mode, a missing key or a bad cap stops
 * the start.
 */
export function readScreeningShadowConfig(env: NodeJS.ProcessEnv): ScreeningShadowConfig {
  const raw = env.DRAFT_LOOP_SCREENING_SHADOW ?? "";
  const mode = raw === "" ? "off" : raw;
  if (mode === "off") return { mode };
  if (mode !== "jev") {
    throw new ApiConfigError(
      `DRAFT_LOOP_SCREENING_SHADOW must be one of ${screeningShadowModes.join(", ")}.`,
    );
  }
  const apiKey = (env.DRAFT_LOOP_JEV_API_KEY ?? "").trim();
  if (apiKey === "") {
    throw new ApiConfigError(
      "DRAFT_LOOP_JEV_API_KEY is required when DRAFT_LOOP_SCREENING_SHADOW is jev.",
    );
  }
  const capRaw = env.DRAFT_LOOP_SCREENING_SHADOW_MAX_DAILY_USD ?? "";
  const maxDailyUsd = capRaw.trim() === "" ? defaultScreeningShadowMaxDailyUsd : Number(capRaw);
  if (!Number.isFinite(maxDailyUsd) || maxDailyUsd <= 0) {
    throw new ApiConfigError(
      "DRAFT_LOOP_SCREENING_SHADOW_MAX_DAILY_USD must be a positive number.",
    );
  }
  return { mode, apiKey, maxDailyUsd };
}

/** The setup's `shadow` part: nothing when off, so a spread leaves the setup as it was. */
export function screeningShadowFrom(config: ScreeningShadowConfig): {
  readonly shadow?: DecisionScreeningShadow;
} {
  if (config.mode === "off") return {};
  return {
    shadow: createJevScreeningShadow({ apiKey: config.apiKey, maxDailyUsd: config.maxDailyUsd }),
  };
}
