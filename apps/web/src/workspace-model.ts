import type {
  WorkspaceSetupChoice,
  WorkspaceSetupPreset,
} from "@draft-loop/ui/workspace-setup-model";

import type { ApiInput, ApiSchemas } from "./api-client.js";

/**
 * The owner token works in one workspace (ADR 0011, phase 1); sign-in mode chooses among the
 * caller's candidate records instead.
 */
export const ownerWorkspaceId = "owner";

/** What the screens call that workspace, since its id names no one's job search. */
export const ownerWorkspaceName = "Your workspace";

export type Company = "anthropic" | "openai";

/** A warning when author and critic come from one company, which weakens the critique. */
export function samePairWarning(author: Company, critic: Company): string | undefined {
  if (author !== critic) return undefined;
  return "The author and the critic come from the same company. A critic from another company catches more of the author's mistakes.";
}

type CreateWorkspaceBody = ApiInput<"PUT /v1/workspaces/{workspaceId}">["body"];

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
  throw new Error("The hosted service runs Anthropic and OpenAI models only.");
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

/** How a model reads on the screen, such as `anthropic · claude-model`. */
export function modelLabel(model: ApiSchemas["Workspace"]["author"]): string {
  return `${model.company} · ${model.model}`;
}
