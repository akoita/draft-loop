import { type ApiInput, ApiRequestError, type ApiSchemas, describeError } from "./api-client.js";

export type ConsentEntry = ApiSchemas["ConsentEntry"];
export type Consents = ApiSchemas["Consents"];
export type ConsentKind = ConsentEntry["kind"];
export type ConsentBasis = ConsentEntry["basis"];
export type ConsentProvider = "anthropic" | "openai";
type ConsentBody = ApiInput<"POST /v1/workspaces/{workspaceId}/consents">["body"];

/** The longest note the consent ledger keeps. */
export const maximumConsentNoteLength = 500;

const basisLabels: Readonly<Record<ConsentBasis, string>> = {
  "candidate-consent": "The candidate consented",
  contract: "A contract with the candidate",
  "legitimate-interest": "Legitimate interest",
};

/** The bases each kind takes: storage any lawful basis, transmission only the candidate's consent. */
export const consentBases: Readonly<Record<ConsentKind, readonly ConsentBasis[]>> = {
  "material-storage": ["candidate-consent", "contract", "legitimate-interest"],
  "provider-transmission": ["candidate-consent"],
};

const kindLabels: Readonly<Record<ConsentKind, string>> = {
  "material-storage": "Storing material",
  "provider-transmission": "Sending to providers",
};

const providerNames: Readonly<Record<ConsentProvider, string>> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
};

/** A basis as people read it, such as `A contract with the candidate`. */
export function basisLabel(basis: ConsentBasis): string {
  return basisLabels[basis];
}

/** A consent kind as the history names it. */
export function consentKindLabel(kind: ConsentKind): string {
  return kindLabels[kind];
}

/** A provider as people read it, such as `OpenAI`. */
export function providerName(provider: string): string {
  return providerNames[provider as ConsentProvider] ?? provider;
}

/** Providers in plain words, such as `Anthropic and OpenAI`. */
export function providerList(providers: readonly string[]): string {
  const names = providers.map(providerName);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function isProvider(company: string): company is ConsentProvider {
  return company in providerNames;
}

/**
 * The providers a run sends material to: the companies of the workspace's author and critic,
 * Anthropic and OpenAI by default.
 */
export function workspaceProviders(
  workspace: Pick<ApiSchemas["Workspace"], "author" | "critic"> | undefined,
): ConsentProvider[] {
  if (workspace === undefined) return ["anthropic", "openai"];
  const companies = [workspace.author.company, workspace.critic.company].filter(isProvider);
  return [...new Set(companies)].sort();
}

export interface GrantInput {
  readonly basis: ConsentBasis | undefined;
  /** The providers a transmission grant names; ignored for storage. */
  readonly providers?: readonly ConsentProvider[];
  readonly note?: string;
  /** For a transmission grant: the member confirms the candidate agreed. */
  readonly confirmed?: boolean;
}

/** The grant request for a kind, or what is missing first. */
export function grantRequest(
  kind: ConsentKind,
  input: GrantInput,
): { readonly body: ConsentBody } | { readonly problem: string } {
  const note = input.note?.trim() ?? "";
  if (note.length > maximumConsentNoteLength)
    return { problem: `Keep the note to ${maximumConsentNoteLength} characters.` };
  const noted = note === "" ? {} : { note };
  if (kind === "material-storage") {
    if (input.basis === undefined || !consentBases[kind].includes(input.basis))
      return { problem: "Choose the basis for storing the candidate's material." };
    return { body: { kind, action: "granted", basis: input.basis, ...noted } };
  }
  const providers = [...new Set(input.providers ?? [])].sort();
  if (providers.length === 0)
    return { problem: "Set up the workspace's author and critic models first." };
  if (input.confirmed !== true)
    return { problem: "Confirm that the candidate agreed to send their material." };
  return {
    body: { kind, action: "granted", basis: "candidate-consent", providers, ...noted },
  };
}

/** The withdrawal of a kind's current grant, or why there is nothing to withdraw. */
export function withdrawRequest(
  kind: ConsentKind,
  consents: Consents,
): { readonly body: ConsentBody } | { readonly problem: string } {
  const current = consents.current[kind];
  if (current === null || current.action !== "granted")
    return { problem: "There is no consent to withdraw." };
  return { body: { kind, action: "withdrawn", basis: current.basis } };
}

/** Whether a kind's latest entry is a grant. */
export function isGranted(consents: Consents, kind: ConsentKind): boolean {
  return consents.current[kind]?.action === "granted";
}

/** The providers the workspace uses that the current transmission grant does not name. */
export function unconsentedProviders(
  consents: Consents,
  providers: readonly ConsentProvider[],
): ConsentProvider[] {
  const current = consents.current["provider-transmission"];
  if (current?.action !== "granted") return [];
  return providers.filter((provider) => !current.providers.includes(provider));
}

/**
 * Why a run cannot start for lack of the candidate's consent to send material to the providers,
 * or `null` once it covers every provider. Without a reading yet, Start waits.
 */
export function transmissionBlockedReason(
  consents: Consents | undefined,
  providers: readonly ConsentProvider[],
): string | null {
  if (consents === undefined) return "Checking the candidate's consent to send material…";
  if (!isGranted(consents, "provider-transmission"))
    return `Record the candidate's consent to send material to ${providerList(providers)} first.`;
  const missing = unconsentedProviders(consents, providers);
  if (missing.length === 0) return null;
  return `The candidate's consent does not name ${providerList(missing)}. Withdraw it and record it again for ${providerList(providers)}.`;
}

/** A recording time as people read it, in UTC. */
export function formatRecordedAt(recordedAt: string, locale?: string): string {
  const time = new Date(recordedAt).toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
  return `${time} UTC`;
}

function recorderLabel(entry: ConsentEntry): string {
  return entry.recordedBy.kind === "owner" ? "the owner" : "a member";
}

/** One line on a kind's current state, such as `Granted on 24 Oct 2026, 09:00 UTC: …`. */
export function consentSummary(consents: Consents, kind: ConsentKind, locale?: string): string {
  const current = consents.current[kind];
  if (current === null) return "Not recorded yet.";
  const when = formatRecordedAt(current.recordedAt, locale);
  if (current.action === "withdrawn") return `Withdrawn on ${when}.`;
  const providers = current.providers.length === 0 ? "" : ` for ${providerList(current.providers)}`;
  return `Granted on ${when}${providers}. Basis: ${basisLabel(current.basis).toLowerCase()}.`;
}

/** One history line: when, what, the basis and who recorded it, never an internal id. */
export function historyLine(entry: ConsentEntry, locale?: string): string {
  const action = entry.action === "granted" ? "Granted" : "Withdrawn";
  const providers = entry.providers.length === 0 ? "" : ` (${providerList(entry.providers)})`;
  const note = entry.note === undefined ? "" : ` Note: ${entry.note}`;
  return (
    `${formatRecordedAt(entry.recordedAt, locale)} · ${action}: ` +
    `${consentKindLabel(entry.kind).toLowerCase()}${providers} · ` +
    `${basisLabel(entry.basis)} · by ${recorderLabel(entry)}.${note}`
  );
}

/** A kind's history, newest first. */
export function consentHistory(consents: Consents, kind: ConsentKind): ConsentEntry[] {
  return consents.history.filter((entry) => entry.kind === kind).reverse();
}

const refusals: Readonly<Record<string, { kind: ConsentKind; message: string }>> = {
  storage_consent_required: {
    kind: "material-storage",
    message:
      "The candidate's material cannot be stored yet. Record the basis for storing it in the Sources step, then upload again.",
  },
  transmission_consent_required: {
    kind: "provider-transmission",
    message:
      "The candidate has not agreed to send their material to the model providers. Record their consent in the Run step, then try again.",
  },
};

/** The missing consent behind a refused upload or run, if a consent is what is missing. */
export function consentRefusal(
  error: unknown,
): { readonly kind: ConsentKind; readonly message: string } | undefined {
  if (!(error instanceof ApiRequestError) || error.status !== 409) return undefined;
  return refusals[error.code];
}

/** What to tell the member about a failed call, pointing to a missing consent when it is one. */
export function describeActionError(error: unknown): string {
  return consentRefusal(error)?.message ?? describeError(error);
}
