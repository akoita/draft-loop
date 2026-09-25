import { assertIndependentReview, SemanticValidationError } from "@draft-loop/domain";

import { CliUserError, type WorkspaceConfig } from "./local.js";
import { modelSelection } from "./run-model-selection.js";

const companyDisplayNames: Readonly<Record<string, string>> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
};

const anthropicModelPrefixes = ["claude-"] as const;
const openAiModelPrefixes = ["gpt-", "o1", "o3", "o4", "codex"] as const;

function hasPrefix(modelId: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => modelId.startsWith(prefix));
}

/**
 * Name the other company whose model ID was configured for this company.
 *
 * Only well-known prefixes are recognised, so an unfamiliar model ID is never
 * refused here: this catches the obvious slip of pairing a company with the
 * other company's model, not every ID a provider might reject. Companies other
 * than Anthropic and OpenAI (such as `local`) are never judged.
 */
export function modelCompanyMismatch(company: string, modelId: string): string | null {
  const normalizedCompany = company.trim().toLowerCase();
  const normalizedModel = modelId.trim().toLowerCase();
  if (normalizedCompany === "anthropic" && hasPrefix(normalizedModel, openAiModelPrefixes)) {
    return "OpenAI";
  }
  if (normalizedCompany === "openai" && hasPrefix(normalizedModel, anthropicModelPrefixes)) {
    return "Anthropic";
  }
  return null;
}

/**
 * Refuse a role whose model ID clearly belongs to another company.
 *
 * Without this, a workspace saved with such a pairing looks valid until the
 * provider step for that role fails, long after the choice was made.
 */
export function assertModelCompaniesMatch(config: WorkspaceConfig): WorkspaceConfig {
  for (const role of ["author", "critic"] as const) {
    const company = role === "author" ? config.authorCompany : config.criticCompany;
    const modelId = role === "author" ? config.authorModel : config.criticModel;
    const other = modelCompanyMismatch(company, modelId);
    if (other !== null) {
      const companyName = companyDisplayNames[company.trim().toLowerCase()] ?? company;
      throw new CliUserError(
        `\`${modelId}\` looks like an ${other} model, but the ${role} company is ${companyName}. Choose a matching model ID.`,
      );
    }
  }
  return config;
}

/**
 * Refuse a pairing the domain would refuse, before it is written down.
 *
 * The rule is not restated here: `assertIndependentReview` is the same check
 * `createContextSnapshot` makes when a run is built, so a configuration this
 * accepts is one a run can actually be started from. Asking early only moves
 * the refusal to the moment the choice is made; asking here as well as there
 * is not a second rule, it is the same one called sooner.
 */
export function assertConfiguredIndependence(config: WorkspaceConfig): void {
  try {
    assertIndependentReview(modelSelection(config, "author"), modelSelection(config, "critic"), {
      required: true,
      ...(config.independenceOverrideRationale === undefined
        ? {}
        : { overrideRationale: config.independenceOverrideRationale }),
    });
  } catch (error) {
    if (error instanceof SemanticValidationError) {
      // The domain's own wording, so the two cannot drift; it names no
      // configured value, only what the pairing must satisfy.
      throw new CliUserError(error.issues.map((issue) => issue.message).join(" "));
    }
    throw error;
  }
}

/**
 * Refuse a mismatched model ID, then a pairing the domain would refuse.
 */
export function assertWorkspaceModelPairing(config: WorkspaceConfig): WorkspaceConfig {
  assertModelCompaniesMatch(config);
  assertConfiguredIndependence(config);
  return config;
}
