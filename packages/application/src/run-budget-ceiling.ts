import type { RunBudget } from "@draft-loop/orchestrator";
import type { WorkspaceSettingsPort } from "@draft-loop/storage";

/**
 * The most a hosted run may spend, set by the deployment (ADR 0011, D5). A workspace without a
 * cost or duration limit gets the ceiling's, and one whose limit is higher is refused.
 */
export interface RunBudgetCeiling {
  readonly maxRounds: number;
  readonly maxCostUsd: number;
  readonly maxDurationMs: number;
}

export class RunBudgetCeilingConfigError extends Error {
  override readonly name = "RunBudgetCeilingConfigError";
}

function positive(env: NodeJS.ProcessEnv, name: string, integer: boolean): number {
  const text = env[name] ?? "";
  const value = Number(text);
  if (
    text.trim() === "" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    (integer && !Number.isInteger(value))
  ) {
    throw new RunBudgetCeilingConfigError(
      `${name} must be a positive ${integer ? "whole number" : "number"}.`,
    );
  }
  return value;
}

/** Reads the deployment's ceiling; every value is required, so no hosted run is unbounded. */
export function readRunBudgetCeiling(env: NodeJS.ProcessEnv): RunBudgetCeiling {
  return {
    maxRounds: positive(env, "DRAFT_LOOP_RUN_MAX_ROUNDS", true),
    maxCostUsd: positive(env, "DRAFT_LOOP_RUN_MAX_COST_USD", false),
    maxDurationMs: positive(env, "DRAFT_LOOP_RUN_MAX_DURATION_MS", true),
  };
}

export interface RunBudgetCeilingViolation {
  readonly limit: "maxRounds" | "maxCostUsd" | "maxDurationMs";
  readonly ceiling: number;
}

/**
 * The first limit of `budget` that the ceiling does not allow. A missing cost or duration limit is
 * unbounded, so it is a violation too; {@link withRunBudgetDefaults} fills them before a run.
 */
export function runBudgetCeilingViolation(
  budget: RunBudget,
  ceiling: RunBudgetCeiling,
): RunBudgetCeilingViolation | undefined {
  if (budget.maxRounds > ceiling.maxRounds)
    return { limit: "maxRounds", ceiling: ceiling.maxRounds };
  if (budget.maxCostUsd === undefined || budget.maxCostUsd > ceiling.maxCostUsd) {
    return { limit: "maxCostUsd", ceiling: ceiling.maxCostUsd };
  }
  if (budget.maxDurationMs === undefined || budget.maxDurationMs > ceiling.maxDurationMs) {
    return { limit: "maxDurationMs", ceiling: ceiling.maxDurationMs };
  }
  return undefined;
}

/** A plain sentence for a refusal; it names the limit and the ceiling, never other settings. */
export function runBudgetCeilingMessage(violation: RunBudgetCeilingViolation): string {
  const ceiling =
    violation.limit === "maxCostUsd"
      ? `US$${violation.ceiling}`
      : violation.limit === "maxDurationMs"
        ? `${violation.ceiling} ms`
        : `${violation.ceiling} rounds`;
  return `The workspace's ${violation.limit} is above this deployment's limit of ${ceiling} per run.`;
}

/**
 * Workspace settings whose configuration gets the ceiling's cost and duration limits where it has
 * none, so a hosted run is never unbounded. Only reads change; a later save keeps the filled
 * limits, which the workspace then shows. Other documents and malformed text pass through.
 */
export function withRunBudgetDefaults(
  port: WorkspaceSettingsPort,
  ceiling: RunBudgetCeiling,
): WorkspaceSettingsPort {
  return {
    ...port,
    read: async (workspace, name) => {
      const text = await port.read(workspace, name);
      if (name !== "workspace.json" || text === undefined) return text;
      let config: unknown;
      try {
        config = JSON.parse(text);
      } catch {
        return text;
      }
      if (typeof config !== "object" || config === null || Array.isArray(config)) return text;
      const record = config as Record<string, unknown>;
      if (record.maxCostUsd !== undefined && record.maxDurationMs !== undefined) return text;
      return `${JSON.stringify(
        {
          ...record,
          maxCostUsd: record.maxCostUsd ?? ceiling.maxCostUsd,
          maxDurationMs: record.maxDurationMs ?? ceiling.maxDurationMs,
        },
        null,
        2,
      )}\n`;
    },
  };
}
