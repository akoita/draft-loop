import {
  defaultWorkspaceSetupRounds,
  initialSetupPresetId,
  type WorkspaceSetupChoice,
  type WorkspaceSetupPreset,
} from "@draft-loop/ui/workspace-setup-model";
import { t } from "@lingui/core/macro";

import type { ApiInput } from "./api-client.js";

/**
 * The owner token works in one workspace (ADR 0011, phase 1); sign-in mode chooses among the
 * caller's candidate records instead.
 */
export const ownerWorkspaceId = "owner";

/** What the screens call that workspace, since its id names no one's job search. */
export const ownerWorkspaceName = (): string => t`Your workspace`;

export type Company = "anthropic" | "openai";

type CreateWorkspaceBody = ApiInput<"PUT /v1/workspaces/{workspaceId}">["body"];

/**
 * What the setup screen would submit if nobody touched it: the CV language given, the default
 * preset among those offered, the default rounds and demo mode off. A one-person plan creates its
 * record with this choice and shows no setup screen; Settings changes it later.
 */
export function defaultSetupChoice(
  presets: readonly WorkspaceSetupPreset[],
  language: string,
): WorkspaceSetupChoice | undefined {
  const presetId = initialSetupPresetId(presets);
  const preset = presets.find(({ id }) => id === presetId);
  if (preset === undefined) return undefined;
  return { language, maxRounds: defaultWorkspaceSetupRounds, preset, fixtureMode: false };
}

/** The create request for the first-run choice: the preset's two models, language and rounds. */
export function setupRequestBody(choice: WorkspaceSetupChoice): CreateWorkspaceBody {
  return {
    language: choice.language,
    maxRounds: choice.maxRounds,
    fixtureMode: choice.fixtureMode,
    author: {
      company: hostedCompany(choice.preset.author.company),
      model: choice.preset.author.model,
    },
    critic: {
      company: hostedCompany(choice.preset.critic.company),
      model: choice.preset.critic.model,
    },
  };
}

function hostedCompany(company: string): Company {
  if (company === "anthropic" || company === "openai") return company;
  throw new Error(t`The hosted service runs Anthropic and OpenAI models only.`);
}

/** The presets whose author and critic models are both in the service's catalog. */
export function routablePresets(
  presets: readonly WorkspaceSetupPreset[],
  catalog: readonly { readonly company: string; readonly model: string }[],
): readonly WorkspaceSetupPreset[] {
  const routed = (side: { readonly company: string; readonly model: string }) =>
    catalog.some(({ company, model }) => company === side.company && model === side.model);
  return presets.filter(({ author, critic }) => routed(author) && routed(critic));
}
