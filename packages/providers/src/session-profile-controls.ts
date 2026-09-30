import type { ModelSelection } from "@draft-loop/domain";
import type { ModelProfileEffort } from "@draft-loop/domain/model-profile";
import {
  type AnthropicProfileThinking,
  resolveProfileRuntimeControls,
} from "./profile-runtime-controls.js";

const verifiedSonnet45ModelIds = new Set(["claude-sonnet-4-5", "claude-sonnet-4-5-20250929"]);

export interface ClaudeSessionProfileControls {
  readonly maxOutputTokens: number;
  readonly effort?: Exclude<ModelProfileEffort, "provider-default">;
  readonly thinking?: AnthropicProfileThinking;
}

type InvalidRequestFactory = () => Error;

/** Resolve only profile controls the installed Claude CLI adapter can express. */
export function resolveClaudeSessionProfileControls(
  configuredSelection: ModelSelection,
  requestedSelection: ModelSelection,
  requestedMaxOutputTokens: number | undefined,
  configuredEffort: Exclude<ModelProfileEffort, "provider-default"> | undefined,
  invalidRequest: InvalidRequestFactory,
): ClaudeSessionProfileControls | undefined {
  const controls = resolveProfileRuntimeControls(
    "anthropic",
    configuredSelection,
    requestedSelection,
    requestedMaxOutputTokens,
    invalidRequest,
  );
  if (controls === undefined) return undefined;
  if (controls.provider !== "anthropic") throw invalidRequest();

  if (configuredEffort !== undefined && configuredEffort !== controls.effort) {
    throw invalidRequest();
  }

  const isVerifiedSonnet45 = verifiedSonnet45ModelIds.has(requestedSelection.modelId);
  if (
    (controls.thinking !== undefined && !isVerifiedSonnet45) ||
    (controls.effort !== undefined && isVerifiedSonnet45)
  ) {
    throw invalidRequest();
  }

  return {
    maxOutputTokens: controls.maxOutputTokens,
    ...(controls.effort === undefined ? {} : { effort: controls.effort }),
    ...(controls.thinking === undefined ? {} : { thinking: controls.thinking }),
  };
}
