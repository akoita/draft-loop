import type { ApiInput, ApiSchemas } from "./api-client.js";

/** Phase 1 serves the owner alone, so the screen works in one workspace (ADR 0011, phase 1). */
export const ownerWorkspaceId = "owner";

export type Company = "anthropic" | "openai";

/** The setup form as the owner types it; empty model ids leave the service's defaults. */
export interface WorkspaceForm {
  readonly language: string;
  readonly requiredSections: string;
  readonly maxRounds: string;
  readonly authorCompany: Company;
  readonly authorModel: string;
  readonly criticCompany: Company;
  readonly criticModel: string;
  readonly fixtureMode: boolean;
}

/** The default pair is an Anthropic author with an OpenAI critic, two companies. */
export const defaultWorkspaceForm: WorkspaceForm = {
  language: "en",
  requiredSections: "",
  maxRounds: "3",
  authorCompany: "anthropic",
  authorModel: "",
  criticCompany: "openai",
  criticModel: "",
  fixtureMode: false,
};

const modelIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

/** The sections, one per line or separated by commas, without blanks. */
export function sectionList(text: string): string[] {
  return text
    .split(/[\n,]/u)
    .map((section) => section.trim())
    .filter((section) => section.length > 0);
}

/** What the owner must fix before the workspace can be created. */
export function workspaceFormProblems(form: WorkspaceForm): string[] {
  const problems: string[] = [];
  const language = form.language.trim();
  if (language.length < 2 || language.length > 35)
    problems.push("Give the CV's language as a code such as en or fr.");
  const rounds = Number(form.maxRounds);
  if (!/^\d+$/u.test(form.maxRounds.trim()) || rounds < 1 || rounds > 10)
    problems.push("Allow from 1 to 10 rounds.");
  if (sectionList(form.requiredSections).length > 20) problems.push("List at most 20 sections.");
  for (const [role, model] of [
    ["author", form.authorModel],
    ["critic", form.criticModel],
  ] as const) {
    if (model.trim() !== "" && !modelIdPattern.test(model.trim()))
      problems.push(`The ${role} model is a model id, such as the provider names it.`);
  }
  return problems;
}

/** A warning when author and critic come from one company, which weakens the critique. */
export function samePairWarning(author: Company, critic: Company): string | undefined {
  if (author !== critic) return undefined;
  return "The author and the critic come from the same company. A critic from another company catches more of the author's mistakes.";
}

type CreateWorkspaceBody = ApiInput<"PUT /v1/workspaces/{workspaceId}">["body"];

/** The create request for a valid form; empty fields are left to the service's defaults. */
export function workspaceRequestBody(form: WorkspaceForm): CreateWorkspaceBody {
  const sections = sectionList(form.requiredSections);
  const authorModel = form.authorModel.trim();
  const criticModel = form.criticModel.trim();
  return {
    language: form.language.trim(),
    maxRounds: Number(form.maxRounds),
    fixtureMode: form.fixtureMode,
    ...(sections.length === 0 ? {} : { requiredSections: sections }),
    ...(authorModel === "" ? {} : { author: { company: form.authorCompany, model: authorModel } }),
    ...(criticModel === "" ? {} : { critic: { company: form.criticCompany, model: criticModel } }),
  };
}

/** How a model reads on the screen, such as `anthropic · claude-model`. */
export function modelLabel(model: ApiSchemas["Workspace"]["author"]): string {
  return `${model.company} · ${model.model}`;
}
