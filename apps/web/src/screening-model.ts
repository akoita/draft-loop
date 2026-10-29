import { type ApiClient, ApiRequestError, type ApiSchemas, describeError } from "./api-client.js";
import { canManageMembers } from "./records-model.js";

/** The record's latest screening status of one job source or knowledge source version. */
export type ScreeningStatus = ApiSchemas["ScreeningStatus"];
/** One piece of material a refused run would have used. */
export type QuarantinedMaterial = ApiSchemas["QuarantinedMaterial"];
type Signal = ScreeningStatus["signals"][number];
type Me = ApiSchemas["Me"];

/** The API's limit on a release reason, in characters. */
export const maximumReleaseReasonLength = 500;

/** Whether the caller releases quarantined material: the owner token, and owners and admins. */
export function canReleaseScreening(me: Me): boolean {
  return canManageMembers(me);
}

const signalLabels: Readonly<Record<Signal, string>> = {
  "exfiltration-link": "link that could send data out",
  "hidden-text": "hidden text",
  "instruction-override": "instruction override",
  "role-change": "role change",
  "screener-unavailable": "screening unavailable",
};

/** The screeners' signal codes in plain words, such as `instruction override, hidden text`. */
export function signalNames(signals: readonly Signal[]): string {
  return signals.map((signal) => signalLabels[signal]).join(", ");
}

export type BadgeKind = "clear" | "flagged" | "unscreened" | "released" | "none";

export interface Badge {
  readonly kind: BadgeKind;
  /** The text the badge shows; it never relies on colour alone. */
  readonly label: string;
  /** Why, such as the signals found; empty when there is nothing to add. */
  readonly detail: string;
  /** Held back from runs until an owner or admin releases it. */
  readonly quarantined: boolean;
}

/** A refused run's material as a quarantined status, so it reads like any other badge. */
export function quarantinedStatus(material: QuarantinedMaterial): ScreeningStatus {
  return { ...material, quarantined: true };
}

/** How a status reads on a source or a brief; no status means nothing was screened. */
export function screeningBadge(status: ScreeningStatus | undefined): Badge {
  if (status === undefined)
    return { kind: "none", label: "Not screened", detail: "", quarantined: false };
  const signals = signalNames(status.signals);
  if (status.release !== undefined && !status.quarantined)
    return {
      kind: "released",
      label: "Released",
      detail:
        status.verdict === "flagged"
          ? `Flagged for ${signals || "injection"}; an owner or admin released it.`
          : "Not screened; an owner or admin released it.",
      quarantined: false,
    };
  switch (status.verdict) {
    case "clear":
      return { kind: "clear", label: "Screened: clear", detail: "", quarantined: false };
    case "flagged":
      return {
        kind: "flagged",
        label: "Quarantined: flagged",
        detail: signals,
        quarantined: status.quarantined,
      };
    case "unscreened":
      return {
        kind: "unscreened",
        label: "Quarantined: not screened",
        detail: "The screener could not read it. Run is refused until it is released or replaced.",
        quarantined: status.quarantined,
      };
  }
}

/** The status of the uploaded version of one knowledge source, if it was screened. */
export function sourceStatus(
  statuses: readonly ScreeningStatus[],
  source: { readonly id: string; readonly knowledgeBaseId: string; readonly versionId: string },
): ScreeningStatus | undefined {
  return statuses.find(
    (status) =>
      status.kind === "knowledge-source-version" &&
      status.knowledgeBaseId === source.knowledgeBaseId &&
      status.sourceId === source.id &&
      status.sourceVersionId === source.versionId,
  );
}

/** What a piece of material is called where the screen has only its ids. */
export function materialName(material: QuarantinedMaterial): string {
  return material.kind === "job-source"
    ? "The job brief"
    : `The knowledge source ${material.sourceId} in ${material.knowledgeBaseId}`;
}

export interface QuarantineRefusal {
  readonly message: string;
  readonly items: readonly QuarantinedMaterial[];
}

/** The run refusal for quarantined material, or `undefined` for any other failure. */
export function quarantineRefusal(error: unknown): QuarantineRefusal | undefined {
  if (!(error instanceof ApiRequestError) || error.code !== "material_quarantined")
    return undefined;
  const items = error.quarantined ?? [];
  const job = items.filter((item) => item.kind === "job-source").length;
  const knowledge = items.length - job;
  const parts = [
    ...(job > 0 ? ["the job brief"] : []),
    ...(knowledge > 0
      ? [knowledge === 1 ? "1 knowledge source" : `${knowledge} knowledge sources`]
      : []),
  ];
  return {
    message: `This run was not started. Injection screening quarantined ${
      parts.length > 0 ? parts.join(" and ") : "material the run would use"
    }. Release it, or replace it, then start the run again.`,
    items,
  };
}

/** The release request, or why the typed reason cannot be sent. */
export function releaseRequest(
  workspaceId: string,
  resultId: string,
  reason: string,
):
  | {
      readonly request: {
        readonly path: { readonly workspaceId: string; readonly resultId: string };
        readonly body: { readonly reason: string };
      };
    }
  | { readonly problem: string } {
  const trimmed = reason.trim();
  if (trimmed.length === 0) return { problem: "Write why this text is safe to use." };
  if (trimmed.length > maximumReleaseReasonLength)
    return { problem: `Keep the reason to ${maximumReleaseReasonLength} characters or fewer.` };
  return { request: { path: { workspaceId, resultId }, body: { reason: trimmed } } };
}

/** What to tell the person when the API refuses a release. */
export function releaseRefusal(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 403)
      return "Only owners and admins of your organisation can release quarantined material.";
    if (error.status === 404)
      return "This screening result was not found on this record. Reload the page and try again.";
    if (error.status === 409 && error.code === "result_superseded")
      return "A newer screening result replaced this one. Reload to see the current status.";
    if (error.status === 409 && error.code === "not_releasable")
      return "This text was screened clear, so there is nothing to release.";
  }
  return describeError(error);
}

/** Sends the release; resolves with a problem to show, or `undefined` once it is released. */
export async function releaseScreening(
  client: ApiClient,
  workspaceId: string,
  resultId: string,
  reason: string,
): Promise<string | undefined> {
  const found = releaseRequest(workspaceId, resultId, reason);
  if ("problem" in found) return found.problem;
  try {
    await client.call("POST /v1/workspaces/{workspaceId}/screening/{resultId}/release", {
      ...found.request,
    });
    return undefined;
  } catch (error) {
    return releaseRefusal(error);
  }
}
