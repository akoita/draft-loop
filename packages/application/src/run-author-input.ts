import { randomUUID } from "node:crypto";

import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import type { SqliteStorage } from "@draft-loop/storage";
import { z } from "zod";

import { CliUserError } from "./cli-user-error.js";
import { profileFactEvidenceIdPrefix } from "./profile-fact-evidence.js";
import {
  type AuthorInputRecord,
  createProviderAuthorAgent,
  type ProviderAuthorAgentDependencies,
} from "./provider-author-agent.js";

/**
 * What one author step was given, recorded in run history as a `run.author-input` audit event so a
 * review surface can show it without a fresh query. Counts and ids only: no evidence text.
 */
export interface RunAuthorInput {
  readonly round: number;
  /** Distinct knowledge-chunk items sent to the author. */
  readonly sentChunkCount: number;
  /** Distinct profile-fact items sent to the author. */
  readonly sentFactCount: number;
  /** Eligible chunks across the run's pinned sources; absent without a knowledge selection. */
  readonly knowledgeChunkCount?: number;
  /** Candidate facts of the run's pinned profile; absent when no profile is pinned. */
  readonly knowledgeFactCount?: number;
  /** Requirements, responsibilities included, that matched no sent item. */
  readonly unmatchedRequirementIds: readonly string[];
}

/** The knowledge-base totals of a run's pinned selection. */
export interface RunAuthorInputTotals {
  readonly knowledgeChunkCount: number;
  readonly knowledgeFactCount?: number;
}

/** Records one author step's input; a failure is the caller's to drop. */
export type RecordAuthorInput = (input: AuthorInputRecord) => Promise<void>;

/** Count what an author step received, deduplicating items by id as the achievement plan does. */
export function summarizeAuthorInput(input: {
  readonly round: number;
  readonly retrievedEvidence: readonly Pick<ScoredEvidenceChunk, "id">[];
  readonly uncoveredRequirementIds: readonly string[];
  readonly totals?: RunAuthorInputTotals;
}): RunAuthorInput {
  const ids = new Set(input.retrievedEvidence.map(({ id }) => id));
  const sentFactCount = [...ids].filter((id) => id.startsWith(profileFactEvidenceIdPrefix)).length;
  const totals = input.totals;
  return {
    round: input.round,
    sentChunkCount: ids.size - sentFactCount,
    sentFactCount,
    ...(totals === undefined ? {} : { knowledgeChunkCount: totals.knowledgeChunkCount }),
    ...(totals?.knowledgeFactCount === undefined
      ? {}
      : { knowledgeFactCount: totals.knowledgeFactCount }),
    unmatchedRequirementIds: [...input.uncoveredRequirementIds],
  };
}

/** Append the `run.author-input` audit event; a retry of the same round appends another. */
export async function recordRunAuthorInput(
  storage: Pick<SqliteStorage, "appendAuditEvent">,
  request: {
    readonly workspaceId: string;
    readonly runId: string;
    readonly summary: RunAuthorInput;
  },
): Promise<void> {
  await storage.appendAuditEvent({
    id: `author-input:${request.runId}:${randomUUID()}`,
    workspaceId: request.workspaceId,
    eventType: "run.author-input",
    entityType: "run",
    entityId: request.runId,
    payload: {
      ...request.summary,
      unmatchedRequirementIds: [...request.summary.unmatchedRequirementIds],
    },
    createdAt: new Date().toISOString(),
  });
}

const count = z.number().int().nonnegative();
const runAuthorInputPayloadSchema = z.object({
  round: count,
  sentChunkCount: count,
  sentFactCount: count,
  knowledgeChunkCount: count.optional(),
  knowledgeFactCount: count.optional(),
  unmatchedRequirementIds: z.array(z.string()),
});

/** The parsed payload, or `undefined` when it does not have the recorded shape. */
export function parseRunAuthorInputPayload(payload: unknown): RunAuthorInput | undefined {
  const parsed = runAuthorInputPayloadSchema.safeParse(payload);
  if (!parsed.success) return undefined;
  const { knowledgeChunkCount, knowledgeFactCount, ...required } = parsed.data;
  return {
    ...required,
    ...(knowledgeChunkCount === undefined ? {} : { knowledgeChunkCount }),
    ...(knowledgeFactCount === undefined ? {} : { knowledgeFactCount }),
  };
}

/** The part of a run's candidate retrieval that can count its pinned selection. */
export interface RunAuthorInputTotalsSource {
  readonly knowledgeChunkCount: () => Promise<number>;
  readonly knowledgeFactCount?: () => Promise<number>;
}

/**
 * The recorder for one run engine. Totals are computed at most once, on the first author step,
 * and only when the run has a candidate knowledge selection; if they cannot be computed the event
 * is still written without them.
 */
export function runAuthorInputRecorder(
  storage: Pick<SqliteStorage, "appendAuditEvent">,
  workspaceId: string,
  source: RunAuthorInputTotalsSource | undefined,
): RecordAuthorInput {
  let totals: Promise<RunAuthorInputTotals | undefined> | undefined;
  const resolveTotals = () => {
    totals ??= (async () => {
      if (source === undefined) return undefined;
      try {
        const knowledgeChunkCount = await source.knowledgeChunkCount();
        const knowledgeFactCount = await source.knowledgeFactCount?.();
        return {
          knowledgeChunkCount,
          ...(knowledgeFactCount === undefined ? {} : { knowledgeFactCount }),
        };
      } catch {
        return undefined;
      }
    })();
    return totals;
  };
  return async ({ runId, round, retrievedEvidence, uncoveredRequirementIds }) => {
    const resolved = await resolveTotals();
    const summary = summarizeAuthorInput({
      round,
      retrievedEvidence,
      uncoveredRequirementIds,
      ...(resolved === undefined ? {} : { totals: resolved }),
    });
    await recordRunAuthorInput(storage, { workspaceId, runId, summary });
  };
}

/** The local driver's provider author: its identity, CLI user errors, and input recording. */
export function createRecordedAuthorAgent(
  context: ProviderAuthorAgentDependencies["context"],
  identity: { readonly company: string; readonly modelId: string },
  deps: Omit<
    ProviderAuthorAgentDependencies,
    "context" | "authorCompany" | "authorModel" | "userError"
  >,
) {
  return createProviderAuthorAgent({
    ...deps,
    context,
    authorCompany: identity.company,
    authorModel: identity.modelId,
    userError: (message) => new CliUserError(message),
  });
}
