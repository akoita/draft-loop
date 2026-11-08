import { t } from "@lingui/core/macro";
import { ApiRequestError, type ApiSchemas, describeError } from "./api-client.js";

/**
 * The web's application material (#2217): what the prepare panel says before the first draft,
 * how it explains a refusal, and the Markdown it downloads. Pure, so it is tested without a page.
 */

export type ApplicationMaterialKind = ApiSchemas["ApplicationMaterialRequestInput"]["kind"];
export type ApplicationMaterialDraft = ApiSchemas["ApplicationMaterialDraft"];
export type ApplicationMaterialGuidance = NonNullable<
  ApiSchemas["ApplicationMaterialRequestInput"]["guidance"]
>;

export const applicationMaterialToneLabels = (): Readonly<
  Record<NonNullable<ApplicationMaterialGuidance["tone"]>, string>
> => ({ formal: t`Formal`, warm: t`Warm`, direct: t`Direct` });

export const applicationMaterialLengthLabels = (): Readonly<
  Record<NonNullable<ApplicationMaterialGuidance["length"]>, string>
> => ({ short: t`Short`, standard: t`Standard`, long: t`Long` });

/**
 * The guidance the request carries for one kind: empty fields left out, and no addressee for
 * interview questions. Undefined when the candidate gave none.
 */
export function applicationMaterialGuidanceFor(
  kind: ApplicationMaterialKind,
  guidance: ApplicationMaterialGuidance,
): ApplicationMaterialGuidance | undefined {
  const emphasis = guidance.emphasis?.trim();
  const addressee = kind === "cover-letter" ? guidance.addressee?.trim() : undefined;
  const chosen: ApplicationMaterialGuidance = {
    ...(emphasis ? { emphasis } : {}),
    ...(guidance.tone === undefined ? {} : { tone: guidance.tone }),
    ...(guidance.length === undefined ? {} : { length: guidance.length }),
    ...(addressee ? { addressee } : {}),
  };
  return Object.keys(chosen).length === 0 ? undefined : chosen;
}

export const applicationMaterialKindLabels = (): Readonly<
  Record<ApplicationMaterialKind, string>
> => ({
  "cover-letter": t`Cover letter`,
  "interview-questions": t`Interview questions`,
});

/** Named before the first draft: what goes to Anthropic, and what never does. */
export const applicationMaterialDisclosure = () =>
  t`Drafting sends this application's job requirements and the facts in your career profile to Anthropic (Claude). Your name and contact details are never sent. Each draft is saved with this application, where you can reopen or delete it.`;

const refusals = (): Readonly<Record<string, string>> => ({
  material_model_unavailable: t`Drafting is not available on this server: it has no Claude route. The rest of the application works as before.`,
  consent_required: t`Record permission to send career material to Anthropic in this record's consent, then draft again.`,
  no_citable_facts: t`Your career profile has no fact a draft could cite yet. Build or review the profile first.`,
  invalid_draft: t`The draft cited something your record does not support, so it was refused. Try again, or add the missing facts to your record.`,
  cost_cap_reached: t`This draft would pass the server's cost cap for one request.`,
  material_model_failed: t`The model's answer could not be used, so nothing was drafted. Try again.`,
  material_quarantined: t`The job post was quarantined by injection screening. Release or replace it before drafting.`,
  material_unscreened: t`The job post has not been screened yet. Save the brief again to screen it.`,
});

/**
 * How a saved version is named in the version list: when it was drafted and by which model, in
 * the reader's locale. A draft from a server that keeps none has no time and is named "Unsaved".
 */
export function applicationMaterialVersionLabel(
  draft: ApplicationMaterialDraft,
  options: { readonly locale?: string; readonly timeZone?: string } = {},
): string {
  if (draft.created_at === undefined) return t`Unsaved draft`;
  const when = new Intl.DateTimeFormat(options.locale, {
    dateStyle: "medium",
    timeStyle: "short",
    ...(options.timeZone === undefined ? {} : { timeZone: options.timeZone }),
  }).format(new Date(draft.created_at));
  return `${when} · ${draft.model.model}`;
}

/** What to tell the candidate when the draft is refused; the API's words for any other code. */
export function applicationMaterialProblem(error: unknown): string {
  if (error instanceof ApiRequestError) return refusals()[error.code] ?? error.message;
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
  const lines = [`# ${applicationMaterialKindLabels()[draft.kind]}`, ""];
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
