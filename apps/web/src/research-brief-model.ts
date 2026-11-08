import { t } from "@lingui/core/macro";

import { ApiRequestError, type ApiSchemas, describeError } from "./api-client.js";

/**
 * The research brief in the Prepare panel (#2545): what the approval names, how a run's state
 * reads, and how each finding lists its dated sources. Pure, so it is tested without a page.
 */

export type ResearchBrief = ApiSchemas["ResearchBrief"];
export type ResearchRunState = ApiSchemas["ResearchRunState"];

/** The most one run may spend, as the server caps it. */
export const researchMaxCostLabel = "US$0.20";

/** Named before the candidate approves: what is searched, who reads it, and the cap. */
export const researchDisclosure = () =>
  t`Researching searches the public web for this employer and role with the server's search provider (Claude's web search unless the server picked another), screens each page, and sends the kept excerpts to Anthropic (Claude) to write short facts that cite them. Nothing about you is sent. It costs at most ${researchMaxCostLabel} and the brief is saved with this application.`;

/** What the panel says about the newest run, or undefined when there is nothing to say. */
export function researchStateNote(state: ResearchRunState | undefined): string | undefined {
  if (state === undefined || state.status === "none") return undefined;
  if (state.status === "pending") return t`Researching… this usually takes a minute or two.`;
  if (state.status === "failed")
    return t`The research failed and nothing was saved. Try again later.`;
  switch (state.outcome) {
    case "researched":
      return undefined;
    case "no-employer":
      return t`The job brief names no employer yet. Add it to the brief, then research again.`;
    case "consent-required":
      return t`Record permission to send material to Anthropic in this record's consent, then research again.`;
    case "unavailable":
      return t`This server does not research applications, so nothing was searched.`;
    default:
      return t`This application could not be researched.`;
  }
}

/** A refusal from the server, in the panel's words. */
export function researchProblem(error: unknown): string {
  if (error instanceof ApiRequestError && error.code === "research_unavailable") {
    return t`This server does not research applications.`;
  }
  return describeError(error);
}

export interface ResearchFindingView {
  readonly id: string;
  readonly text: string;
  readonly sources: readonly {
    readonly id: string;
    readonly title: string;
    readonly url?: string;
    /** The source's date, or undefined when the page gives none. */
    readonly publishedOn?: string;
  }[];
}

/** Each finding with the sources it cites, in the brief's order. */
export function researchFindings(brief: ResearchBrief): ResearchFindingView[] {
  const sources = new Map(brief.sources.map((source) => [source.id, source]));
  return brief.findings.map((finding) => ({
    id: finding.id,
    text: finding.text,
    sources: finding.source_ids.flatMap((id) => {
      const source = sources.get(id);
      if (source === undefined) return [];
      return [
        {
          id,
          title: source.title,
          ...(source.url === undefined ? {} : { url: source.url }),
          ...(source.published_on === undefined ? {} : { publishedOn: source.published_on }),
        },
      ];
    }),
  }));
}

/** The line under the brief: when it was made, what it kept and dropped, and its cost. */
export function researchSummary(brief: ResearchBrief): string {
  const day = brief.created_at.slice(0, 10);
  const kept = brief.sources.length;
  const dropped = brief.dropped.flagged + brief.dropped.outdated;
  const cost = `US$${brief.cost_usd.toFixed(2)}`;
  const from = brief.from_date;
  return t`Researched on ${day}: ${kept} sources kept, ${dropped} dropped as unsafe or older than ${from}. Cost ${cost}.`;
}
