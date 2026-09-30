import type { ModelCompany, ModelSelection } from "@draft-loop/domain";
import type { ModelProfileEffort } from "@draft-loop/domain/model-profile";
import { modelSelectionSchema } from "@draft-loop/schemas";

export type AnthropicProfileThinking =
  | { readonly type: "disabled" }
  | { readonly type: "enabled"; readonly budget_tokens: number };

export type ProfileRuntimeControls =
  | {
      readonly provider: "anthropic";
      readonly maxOutputTokens: number;
      readonly effort?: Exclude<ModelProfileEffort, "provider-default">;
      readonly thinking?: AnthropicProfileThinking;
    }
  | {
      readonly provider: "openai";
      readonly maxOutputTokens: number;
      readonly reasoning?: {
        readonly effort: Exclude<ModelProfileEffort, "provider-default">;
      };
    };

type InvalidRequestFactory = () => Error;

/**
 * Translate a validated selection snapshot into provider request controls.
 * With two legacy selections this returns undefined so callers retain the
 * existing request path unchanged.
 */
export function resolveProfileRuntimeControls(
  provider: ModelCompany,
  configuredSelection: ModelSelection,
  requestedSelection: ModelSelection,
  requestedMaxOutputTokens: number | undefined,
  invalidRequest: InvalidRequestFactory,
): ProfileRuntimeControls | undefined {
  const configuredHasProfile = configuredSelection.profile !== undefined;
  const requestHasProfile = requestedSelection.profile !== undefined;
  if (!configuredHasProfile && !requestHasProfile) return undefined;

  const fail = (): never => {
    throw invalidRequest();
  };
  if (!configuredHasProfile || !requestHasProfile) return fail();

  const configured = modelSelectionSchema.safeParse(configuredSelection);
  const requested = modelSelectionSchema.safeParse(requestedSelection);
  if (!configured.success || !requested.success) return fail();
  if (
    configured.data.company !== provider ||
    requested.data.company !== provider ||
    JSON.stringify(configured.data.profile) !== JSON.stringify(requested.data.profile)
  ) {
    return fail();
  }

  const profile = requested.data.profile;
  if (profile === undefined) return fail();
  if (
    requestedMaxOutputTokens !== undefined &&
    requestedMaxOutputTokens !== profile.runtime.maxOutputTokens
  ) {
    return fail();
  }

  if (provider === "anthropic") {
    const effort = profile.runtime.effort;
    let thinking: AnthropicProfileThinking | undefined;

    if (profile.runtime.thinking.mode === "disabled") {
      thinking = { type: "disabled" };
    } else if (profile.runtime.thinking.mode === "budgeted") {
      const budgetTokens = profile.runtime.thinking.maxTokens;
      if (budgetTokens < 1024 || budgetTokens >= profile.runtime.maxOutputTokens) return fail();
      thinking = { type: "enabled", budget_tokens: budgetTokens };
    }

    return {
      provider: "anthropic",
      maxOutputTokens: profile.runtime.maxOutputTokens,
      ...(effort === "provider-default" ? {} : { effort }),
      ...(thinking === undefined ? {} : { thinking }),
    };
  }

  if (provider === "openai") {
    if (profile.runtime.thinking.mode !== "provider-default") return fail();
    const effort = profile.runtime.effort;
    return {
      provider: "openai",
      maxOutputTokens: profile.runtime.maxOutputTokens,
      ...(effort === "provider-default" ? {} : { reasoning: { effort } }),
    };
  }

  return fail();
}
