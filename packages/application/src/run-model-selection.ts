import type { ModelConfigurationInput, ModelSelection } from "@draft-loop/domain";

import { promptTemplateVersion } from "./author-adjudication.js";
import type { WorkspaceConfig } from "./local.js";

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
    promptTemplateVersion: promptTemplateVersion(role),
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
