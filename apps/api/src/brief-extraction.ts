import type { WorkspaceDescriptor } from "@draft-loop/application";
import type { BriefExtractionState } from "@draft-loop/run-queue";
import type { OpportunityBriefVersionRecord } from "@draft-loop/storage";
import type { FastifyBaseLogger } from "fastify";

import type { OpportunityScreening } from "./content-screening-views.js";

/**
 * What the API says about a version's extraction: the queue's state, or `limited` when the day's
 * allowance left the brief for the person to fill in.
 */
export type BriefExtractionView = BriefExtractionState | "limited";

/** Whether a version is the unread first draft a spent allowance would explain. */
export function isUnreadFirstDraft(record: OpportunityBriefVersionRecord): boolean {
  const { brief } = record;
  return brief.version === 1 && brief.role === null && brief.requirements.length === 0;
}

/** One version of a brief in a workspace, as the API addresses it. */
export interface BriefExtractionVersion {
  readonly workspaceId: string;
  readonly briefId: string;
  readonly version: number;
}

/** The worker's extraction of live briefs (ADR 0011, D9), as the API queues and reads it. */
export interface BriefExtractions {
  /** Queues the version's extraction; false when the deployment extracts nothing on the worker. */
  readonly queue: (
    job: BriefExtractionVersion & { readonly applicationId: string },
  ) => Promise<boolean>;
  /** Whether the version's extraction waits or failed; undefined when none is outstanding. */
  readonly state: (version: BriefExtractionVersion) => Promise<BriefExtractionState | undefined>;
}

/** A deployment that queues no extraction, as an application composed without a queue. */
export const noBriefExtractions: BriefExtractions = {
  queue: async () => false,
  state: async () => undefined,
};

export interface LiveBriefExtractionInput {
  readonly extractions: BriefExtractions;
  readonly workspaceId: string;
  readonly workspace: Pick<WorkspaceDescriptor, "fixtureMode">;
  /** The application whose kept job text the brief came from. */
  readonly applicationId: string | undefined;
  readonly record: OpportunityBriefVersionRecord;
  /** The brief's sources' screening; undefined when screening is off or screened nothing. */
  readonly screening: OpportunityScreening | undefined;
  readonly log: FastifyBaseLogger;
  /**
   * Takes one model call from the day's allowance, asked only for a brief that would be queued.
   * False leaves the brief for the person, as when the deployment extracts nothing.
   */
  readonly allowance?: () => Promise<boolean>;
}

/**
 * Queues a just-saved live brief's extraction once screening cleared its job text. A fixture
 * workspace's brief is extracted as it is saved; a brief outside a named application has no kept
 * job text for the worker to read; a flagged or unscreened source is never sent. A queue that
 * fails leaves the brief for the person to fill in: the brief is saved, so the request succeeds.
 */
export async function queueLiveBriefExtraction(
  input: LiveBriefExtractionInput,
): Promise<BriefExtractionView | undefined> {
  const { record, screening, applicationId } = input;
  const { brief } = record;
  if (input.workspace.fixtureMode || applicationId === undefined || applicationId === "default") {
    return undefined;
  }
  if (!isUnreadFirstDraft(record)) return undefined;
  const postings = brief.sources.filter((source) => source.classification === "job-posting");
  const cleared =
    screening !== undefined &&
    screening.verdict === "clear" &&
    postings.length > 0 &&
    postings.every((posting) =>
      screening.sources.some(
        ({ sourceId, verdict }) => sourceId === posting.id && verdict === "clear",
      ),
    );
  if (!cleared) return undefined;
  if (input.allowance !== undefined && !(await input.allowance())) return "limited";
  try {
    const queued = await input.extractions.queue({
      workspaceId: input.workspaceId,
      applicationId,
      briefId: brief.id,
      version: brief.version,
    });
    return queued ? "pending" : undefined;
  } catch (error) {
    // Ids only: the brief's text never reaches a log line.
    input.log.warn(
      { err: error, workspaceId: input.workspaceId, briefId: brief.id },
      "brief extraction could not be queued",
    );
    return undefined;
  }
}
