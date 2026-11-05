import { ApiRequestError, type ApiSchemas, describeError } from "./api-client.js";

/**
 * The web's application material (#2217): what the prepare panel says before the first draft,
 * how it explains a refusal, and the Markdown it downloads. Pure, so it is tested without a page.
 */

export type ApplicationMaterialKind = ApiSchemas["ApplicationMaterialRequestInput"]["kind"];
export type ApplicationMaterialDraft = ApiSchemas["ApplicationMaterialDraft"];

export const applicationMaterialKindLabels: Readonly<Record<ApplicationMaterialKind, string>> = {
  "cover-letter": "Cover letter",
  "interview-questions": "Interview questions",
};

/** Named before the first draft: what goes to Anthropic, and what never does. */
export const applicationMaterialDisclosure =
  "Drafting sends this application's job requirements and the facts in your career profile to Anthropic (Claude). Your name and contact details are never sent, and the draft is not stored on the server.";

const refusals: Readonly<Record<string, string>> = {
  material_model_unavailable:
    "Drafting is not available on this server: it has no Claude route. The rest of the application works as before.",
  consent_required:
    "Record permission to send career material to Anthropic in this record's consent, then draft again.",
  no_citable_facts:
    "Your career profile has no fact a draft could cite yet. Build or review the profile first.",
  invalid_draft:
    "The draft cited something your record does not support, so it was refused. Try again, or add the missing facts to your record.",
  cost_cap_reached: "This draft would pass the server's cost cap for one request.",
  material_quarantined:
    "The job post was quarantined by injection screening. Release or replace it before drafting.",
  material_unscreened: "The job post has not been screened yet. Save the brief again to screen it.",
};

/** What to tell the candidate when the draft is refused; the API's words for any other code. */
export function applicationMaterialProblem(error: unknown): string {
  if (error instanceof ApiRequestError) return refusals[error.code] ?? error.message;
  return describeError(error);
}

/** The file name the download is saved under. */
export function applicationMaterialFileName(kind: ApplicationMaterialKind): string {
  return `${kind}.md`;
}

/**
 * The draft as Markdown: each paragraph or question with its talking point, and the facts it
 * cites under it, so the candidate can check every claim before using the text.
 */
export function applicationMaterialMarkdown(draft: ApplicationMaterialDraft): string {
  const lines = [`# ${applicationMaterialKindLabels[draft.kind]}`, ""];
  draft.items.forEach((item, index) => {
    if (draft.kind === "interview-questions") {
      lines.push(`## ${index + 1}. ${item.question}`, "");
    }
    lines.push(item.text, "");
    lines.push(...item.citations.map((citation) => `> Source: ${citation.text}`), "");
  });
  lines.push(`_Drafted by ${draft.model.model} (${draft.model.provider}). Check before use._`, "");
  return lines.join("\n");
}
