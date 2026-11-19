import { WorkerConfigError } from "./config-error.js";

/** The deployment's fallback critic (#3131), from `DRAFT_LOOP_CRITIC_FALLBACK`. */
export interface CriticFallbackConfig {
  readonly company: string;
  readonly modelId: string;
}

const pattern = /^([a-z][a-z0-9-]{0,31}):([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/u;

/**
 * Reads `DRAFT_LOOP_CRITIC_FALLBACK` as `<company>:<model>`, such as
 * `anthropic:claude-haiku-5-5`. Unset or empty keeps each run on its configured critic.
 */
export function readCriticFallback(env: NodeJS.ProcessEnv): CriticFallbackConfig | undefined {
  const value = (env.DRAFT_LOOP_CRITIC_FALLBACK ?? "").trim();
  if (value === "") return undefined;
  const match = pattern.exec(value);
  if (match === null) {
    throw new WorkerConfigError(
      "DRAFT_LOOP_CRITIC_FALLBACK must be <company>:<model>, such as anthropic:claude-haiku-5-5.",
    );
  }
  return { company: match[1] as string, modelId: match[2] as string };
}
