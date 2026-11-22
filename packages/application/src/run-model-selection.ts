import process from "node:process";

import type { ModelConfigurationInput, ModelSelection } from "@draft-loop/domain";

import { promptTemplateVersion } from "./author-adjudication.js";
import type { WorkspaceConfig } from "./local.js";

/**
 * Evaluation pins (#3289): a local before-and-after run may start a new run on the previous
 * prompt version. Only the current and the previous version of each role can be pinned, and an
 * unknown value fails closed. Hosted runs never set these variables.
 */
export const promptVersionPins = Object.freeze({
  author: {
    variable: "DRAFT_LOOP_EVAL_AUTHOR_PROMPT_VERSION",
    allowed: ["cli-author-v20", "cli-author-v21"],
  },
  critic: {
    variable: "DRAFT_LOOP_EVAL_CRITIC_PROMPT_VERSION",
    allowed: ["cli-critic-v11", "cli-critic-v12"],
  },
} as const);

/** The prompt version a new run records for a role: the current one unless an eval pin names one. */
export function newRunPromptVersion(
  role: "author" | "critic",
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const pin = promptVersionPins[role];
  const pinned = env[pin.variable]?.trim() ?? "";
  if (pinned === "") return promptTemplateVersion(role);
  if (!(pin.allowed as readonly string[]).includes(pinned)) {
    throw new Error(`${pin.variable} must be one of ${pin.allowed.join(", ")}.`);
  }
  return pinned;
}

/**
 * One side of the workspace's pairing, as the domain expects to receive it.
 *
 * Built here rather than inline so the selection a run records and the
 * selection the independence gate judges are the same object: a second copy
 * would let a workspace pass a check on a pairing it does not actually use.
 * New runs record the current prompt template version for each role.
 */
export function modelSelection(config: WorkspaceConfig, role: "author" | "critic"): ModelSelection {
  const company = role === "author" ? config.authorCompany : config.criticCompany;
  const modelId = role === "author" ? config.authorModel : config.criticModel;
  const lineage = role === "author" ? config.authorLineage : config.criticLineage;
  return {
    company,
    modelId,
    role,
    promptTemplateVersion: newRunPromptVersion(role),
    ...(lineage === undefined ? {} : { lineage }),
  };
}

export function modelConfiguration(config: WorkspaceConfig): ModelConfigurationInput {
  return {
    author: modelSelection(config, "author"),
    critic: modelSelection(config, "critic"),
    requireProviderDiversity: true,
    ...(config.independenceOverrideRationale === undefined
      ? {}
      : { independenceOverrideRationale: config.independenceOverrideRationale }),
  };
}
