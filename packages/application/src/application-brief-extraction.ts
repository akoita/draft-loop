import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { expandLigatures } from "@draft-loop/ingestion";
import type { OpportunityBriefSource } from "@draft-loop/schemas";
import type { OpportunityBriefVersionRecord } from "@draft-loop/storage";

import { type LocalApplicationDriverOptions, readWorkspace } from "./local.js";
import { opportunityExtractionPortFor } from "./local-extraction-ports.js";
import { storageFactory } from "./local-storage-factory.js";
import { processOpportunityExtraction } from "./opportunity-extraction.js";
import {
  createOpportunityPersistenceService,
  opportunityBriefVersionStaleErrorMessage,
} from "./opportunity-persistence.js";

/** Extract a brief from the job text its application keeps, at the version it was queued for. */
export interface ExtractApplicationBriefCommand {
  readonly root: string;
  readonly applicationId: string;
  readonly briefId: string;
  /** The version the extraction was queued for; a brief that moved on is left as it is. */
  readonly expectedVersion: number;
  /** Required outside fixture mode: the extraction sends the job text to the author's company. */
  readonly allowProviderData?: boolean;
  readonly createdAt?: string;
  readonly signal?: AbortSignal;
}

/** What one extraction did; every outcome but `extracted` made no provider call. */
export type ApplicationBriefExtractionOutcome =
  /** The extracted role, employer and requirements were saved as the next draft version. */
  | "extracted"
  /** No such application or brief, or the brief belongs to another application. */
  | "missing"
  /** The brief is past the queued version or reviewed: the person's edit wins. */
  | "brief-moved"
  /** The application keeps no job text, or it no longer matches the brief's source checksum. */
  | "job-text-changed"
  /** Provider data was not approved for a workspace outside fixture mode. */
  | "provider-data-refused";

export interface ApplicationBriefExtractionResult {
  readonly outcome: ApplicationBriefExtractionOutcome;
  /** The saved version when the outcome is `extracted`. */
  readonly record?: OpportunityBriefVersionRecord;
}

function checksumOf(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The brief's pasted job posting that the application's job text produced, if it still does. */
function jobPostingSource(
  sources: readonly OpportunityBriefSource[],
  checksum: string,
): OpportunityBriefSource | undefined {
  return sources.find(
    (source) =>
      source.classification === "job-posting" &&
      source.provenance.kind === "pasted-content" &&
      source.provenance.checksum === checksum,
  );
}

/**
 * Extracts a brief that was saved without extraction, as the hosted service saves a live
 * workspace's brief before its job text is screened (ADR 0011, D9). The job text is the one the
 * application already keeps, never a second copy, and it must still match the checksum the brief
 * recorded for it. The result is saved only if the brief is still at the queued version, so a
 * person's edit made meanwhile is kept.
 */
export async function extractApplicationBrief(
  command: ExtractApplicationBriefCommand,
  options: LocalApplicationDriverOptions = {},
): Promise<ApplicationBriefExtractionResult> {
  const root = resolve(command.root);
  const config = await readWorkspace(root);
  if (!config.fixtureMode && command.allowProviderData !== true) {
    return { outcome: "provider-data-refused" };
  }
  const storage = await storageFactory().open(root);
  try {
    const { applications } = storage;
    const owner = await applications.applicationIdForBrief(config.id, command.briefId);
    const application =
      owner === command.applicationId
        ? await applications.getApplication(config.id, command.applicationId)
        : undefined;
    const latest = await storage.getLatestOpportunityBrief(config.id, command.briefId);
    if (application === undefined || latest === undefined) return { outcome: "missing" };
    const { brief } = latest;
    if (brief.version !== command.expectedVersion || brief.status !== "draft") {
      return { outcome: "brief-moved" };
    }
    if (application.jobSource.kind !== "stored-text") return { outcome: "job-text-changed" };
    const text = application.jobSource.text;
    const checksum = checksumOf(text);
    const source = jobPostingSource(brief.sources, checksum);
    if (source === undefined) return { outcome: "job-text-changed" };

    const extractor = opportunityExtractionPortFor(config, {
      allowProviderData: true,
      ...(options.providerAuthMode === undefined
        ? {}
        : { providerAuthMode: options.providerAuthMode }),
      ...(options.providerAuthModeConfiguration === undefined
        ? {}
        : { providerAuthModeConfiguration: options.providerAuthModeConfiguration }),
      ...(options.resolveCredential === undefined
        ? {}
        : { resolveCredential: options.resolveCredential }),
      ...(options.providerClientFactories === undefined
        ? {}
        : { providerClientFactories: options.providerClientFactories }),
      ...(options.userSessionRunners === undefined
        ? {}
        : { userSessionRunners: options.userSessionRunners }),
      ...(options.userSessionTimeoutMs === undefined
        ? {}
        : { userSessionTimeoutMs: options.userSessionTimeoutMs }),
    });
    // A failed call comes back as an issue on the brief, as the desktop's extraction reports it.
    const extracted = await processOpportunityExtraction(extractor, {
      operationId: `extraction-${checksumOf(
        ["application-brief-extraction", brief.id, String(brief.version), checksum].join("\u0000"),
      ).slice(0, 32)}`,
      sources: [
        {
          id: source.id,
          classification: "job-posting",
          status: "available",
          mediaType: "text/plain",
          checksum,
          text: expandLigatures(text),
        },
      ],
      ...(command.signal === undefined ? {} : { signal: command.signal }),
    });
    command.signal?.throwIfAborted();
    try {
      const record = await createOpportunityPersistenceService(storage).editLatestOpportunityBrief({
        workspaceId: config.id,
        briefId: brief.id,
        expectedVersion: brief.version,
        patch: {
          role: extracted.role,
          employer: extracted.employer,
          responsibilities: [...extracted.responsibilities],
          requirements: [...extracted.requirements],
          priorities: [...extracted.priorities],
          issues: [...brief.issues, ...extracted.issues],
        },
        createdAt: command.createdAt ?? new Date().toISOString(),
      });
      return { outcome: "extracted", record };
    } catch (error) {
      // The person saved a version while the provider answered: theirs wins.
      if (error instanceof Error && error.message === opportunityBriefVersionStaleErrorMessage) {
        return { outcome: "brief-moved" };
      }
      throw error;
    }
  } finally {
    await storage.close();
  }
}
