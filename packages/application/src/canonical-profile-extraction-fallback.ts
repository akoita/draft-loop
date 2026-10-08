import {
  type JsonObject,
  type ModelRequest,
  type ModelResponse,
  ProviderAdapterError,
} from "@draft-loop/providers";
import {
  type CanonicalCandidateProfileExtractionProposal,
  canonicalCandidateProfileExtractionProposalJsonSchema,
} from "@draft-loop/schemas";

import type { CanonicalCandidateProfileExtractionRequest } from "./candidate-profile-extraction.js";
import { CandidateProfileGroundingError } from "./candidate-profile-grounding-diagnostics.js";
import {
  CandidateProfileProposalValidationError,
  parseCanonicalCandidateProfileExtractionProposal,
} from "./candidate-profile-proposal-validation.js";
import {
  buildBoundedCallRequest,
  groundingCorrectionInstructions,
} from "./canonical-profile-extraction-bounded-calls.js";
import {
  type CanonicalProfileExtractionPartCache,
  createCanonicalProfileExtractionPartCache,
  defaultCanonicalProfileExtractionConcurrencyFor,
  runCanonicalProfileExtractionParts,
} from "./canonical-profile-extraction-parts.js";
import {
  type CanonicalProfileExtractionPlannedCall,
  planCanonicalProfileExtractionCalls,
  proactivePlanMaximumCallCount,
} from "./canonical-profile-extraction-plan.js";
import { reportCanonicalProfileExtractionProgress } from "./canonical-profile-extraction-progress.js";
import {
  type CanonicalProfileExtractionTextWindow,
  canonicalProfileExtractionSectionFocus,
  canonicalProfileExtractionSectionFocusInstructions,
  planCanonicalProfileExtractionTextWindows,
} from "./canonical-profile-extraction-sections.js";
import {
  maximumCanonicalProfileExtractionSplitDepth,
  splitCanonicalProfileExtractionWindow,
} from "./canonical-profile-extraction-split.js";
import {
  canonicalProfileUnboundableSourceMessage,
  hasCanonicalProfileSourceAboveUnplannedBound,
} from "./canonical-profile-unboundable-sources.js";
import { CliUserError } from "./cli-user-error.js";

const maximumFocusedSourceCount = 4;
const outputName = "canonical_candidate_profile_extraction";
const focusInstructions =
  "This is a bounded focused extraction call. Extract all supported facts from the source whose ID is input.extractionFocusSourceId. Keep every supplied source available as conflict context; include facts from another source only when they are grounded counterfacts needed for a conflict or duplicate issue that includes a fact from the focused source. Use concise exact contiguous evidence quotes containing the entire fact value and necessary factual context, rather than repeating unrelated surrounding paragraphs. Preserve the same evidence, unique-key, and schema rules. Do not invent counterfacts.";

export interface CanonicalProfileExtractionExecutor {
  readonly execute: (request: ModelRequest<JsonObject>) => Promise<ModelResponse<JsonObject>>;
}

export interface CanonicalProfileExtractionControls {
  readonly model: ModelRequest<JsonObject>["model"];
  readonly systemPrompt: string;
  readonly maxOutputTokens: number;
  readonly dataPolicy: ModelRequest<JsonObject>["dataPolicy"];
  /** Planned parts run at once; defaults to 8 for Mistral and 4 otherwise, never below 1. */
  readonly concurrency?: number;
  /** Completed-part cache for retry reuse; defaults to one shared for the host's lifetime. */
  readonly partCache?: CanonicalProfileExtractionPartCache<CanonicalProfileExtractionPlannedPartEntry>;
}

function outputLimitFailure(
  provider: ModelRequest<JsonObject>["model"]["company"],
): ProviderAdapterError {
  return new ProviderAdapterError(
    provider,
    "invalid-response",
    "The provider could not complete canonical profile extraction within the output-token limit.",
    {
      retryable: false,
      failureStage: "output-token-budget-exceeded",
      diagnostics: [{ code: "profile_extraction_output_budget_exceeded", path: "output" }],
    },
  );
}

function isOutputLimitFailure(error: unknown): error is ProviderAdapterError {
  return (
    error instanceof ProviderAdapterError &&
    error.code === "invalid-response" &&
    (error.failureStage === "output-token-budget-exceeded" ||
      error.diagnostics.some((diagnostic) => diagnostic.code === "max_tokens") ||
      error.diagnosticCounts.some((diagnostic) => diagnostic.code === "max_tokens"))
  );
}

function invalidBatchFailure(
  provider: ModelRequest<JsonObject>["model"]["company"],
  diagnosticCounts: readonly { readonly code: string; readonly count: number }[] = [],
): ProviderAdapterError {
  return new ProviderAdapterError(
    provider,
    "invalid-response",
    "The provider returned an invalid canonical profile extraction batch.",
    {
      retryable: false,
      failureStage: "response-schema-validation",
      diagnostics: [{ code: "invalid_profile_extraction_batch", path: "output" }],
      diagnosticCounts,
    },
  );
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) signal.throwIfAborted();
}

async function executeWithCancellation(
  executor: CanonicalProfileExtractionExecutor,
  request: ModelRequest<JsonObject>,
  signal: AbortSignal | undefined,
): Promise<ModelResponse<JsonObject>> {
  throwIfAborted(signal);
  try {
    const response = await executor.execute(request);
    throwIfAborted(signal);
    return response;
  } catch (error) {
    throwIfAborted(signal);
    throw error;
  }
}

function canFocusSources(request: CanonicalCandidateProfileExtractionRequest): boolean {
  if (request.sources.length < 2 || request.sources.length > maximumFocusedSourceCount) {
    return false;
  }
  return new Set(request.sources.map((source) => source.id)).size === request.sources.length;
}

function buildRequest(
  request: CanonicalCandidateProfileExtractionRequest,
  controls: CanonicalProfileExtractionControls,
  focusSourceId?: string,
  focusWindow?: CanonicalProfileExtractionTextWindow,
): ModelRequest<JsonObject> {
  const sectionFocus =
    focusSourceId === undefined || focusWindow === undefined
      ? undefined
      : canonicalProfileExtractionSectionFocus(focusSourceId, focusWindow);
  const input = JSON.parse(
    JSON.stringify({
      sources: request.sources,
      ...(request.groundingRecovery === undefined
        ? {}
        : { groundingRecovery: request.groundingRecovery }),
      ...(focusSourceId === undefined
        ? {}
        : sectionFocus === undefined
          ? { extractionFocusSourceId: focusSourceId }
          : sectionFocus),
    }),
  ) as JsonObject;
  return {
    contextSnapshotId: request.operationId,
    model: controls.model,
    systemPrompt: [
      controls.systemPrompt,
      ...(focusSourceId === undefined
        ? []
        : [
            focusInstructions,
            ...(focusWindow === undefined
              ? []
              : [canonicalProfileExtractionSectionFocusInstructions]),
          ]),
      ...(request.groundingRecovery === undefined ? [] : [groundingCorrectionInstructions]),
    ].join(" "),
    input,
    outputSchema: canonicalCandidateProfileExtractionProposalJsonSchema as JsonObject,
    outputName,
    maxOutputTokens: controls.maxOutputTokens,
    dataPolicy: controls.dataPolicy,
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  };
}

function parseBatch(
  output: JsonObject,
  provider: ModelRequest<JsonObject>["model"]["company"],
): CanonicalCandidateProfileExtractionProposal {
  try {
    return parseCanonicalCandidateProfileExtractionProposal(output);
  } catch (error) {
    if (error instanceof CandidateProfileProposalValidationError) {
      throw invalidBatchFailure(provider, error.diagnosticCounts);
    }
    throw error;
  }
}

function aggregateBatches(
  batches: readonly CanonicalCandidateProfileExtractionProposal[],
  provider: ModelRequest<JsonObject>["model"]["company"],
): CanonicalCandidateProfileExtractionProposal {
  const facts: CanonicalCandidateProfileExtractionProposal["facts"] = [];
  const issues: CanonicalCandidateProfileExtractionProposal["issues"] = [];

  for (const [batchIndex, batch] of batches.entries()) {
    const keyMap = new Map<string, string>();
    const namespacedFacts = batch.facts.map((fact, factIndex) => {
      const key = `batch-${batchIndex + 1}-fact-${factIndex + 1}`;
      keyMap.set(fact.key, key);
      return { ...fact, key };
    });
    const namespacedIssues = batch.issues.map((issue) => ({
      ...issue,
      factKeys: issue.factKeys.map((key) => {
        const namespacedKey = keyMap.get(key);
        if (namespacedKey === undefined) {
          throw invalidBatchFailure(provider, [{ code: "profile_unknown_issue_facts", count: 1 }]);
        }
        return namespacedKey;
      }),
    }));
    facts.push(...namespacedFacts);
    issues.push(...namespacedIssues);
  }

  try {
    return parseCanonicalCandidateProfileExtractionProposal({ schemaVersion: 1, facts, issues });
  } catch (error) {
    if (error instanceof CandidateProfileProposalValidationError) {
      throw invalidBatchFailure(provider, error.diagnosticCounts);
    }
    throw error;
  }
}

/** A window's accepted model batch, kept so a retry can replay it without a provider call. */
export interface CanonicalProfileExtractionPlannedLeafEntry {
  readonly batch: CanonicalCandidateProfileExtractionProposal;
  readonly groundingRecovery?: CanonicalCandidateProfileExtractionRequest["groundingRecovery"];
}

/** A window that overflowed the output limit and was halved; a retry splits it again at once. */
export interface CanonicalProfileExtractionPlannedSplitEntry {
  readonly split: true;
}

/** What the part cache keeps per window: an accepted batch, or the decision to split it. */
export type CanonicalProfileExtractionPlannedPartEntry =
  | CanonicalProfileExtractionPlannedLeafEntry
  | CanonicalProfileExtractionPlannedSplitEntry;

type PlannedPartEntry = CanonicalProfileExtractionPlannedPartEntry;

interface LeafRun {
  readonly result: CanonicalCandidateProfileExtractionProposal;
  readonly entry: CanonicalProfileExtractionPlannedLeafEntry;
}

interface PlannedPartRun {
  /** One accepted batch per leaf window, in document order. */
  readonly result: readonly CanonicalCandidateProfileExtractionProposal[];
  readonly entry: PlannedPartEntry;
}

/** Shared by every part of one planned extraction, including the windows made by splitting. */
interface PlannedRunState {
  readonly cache: CanonicalProfileExtractionPartCache<PlannedPartEntry>;
  readonly plannedCount: number;
  /** Keys of windows split during this run; the plan's call cap counts them. */
  readonly splitKeys: Set<string>;
  /** Every key this run wrote, so a successful run can drop them all. */
  readonly touchedKeys: Set<string>;
}

const sharedPlannedPartCache = createCanonicalProfileExtractionPartCache<PlannedPartEntry>();

/** Drop every part kept for retry reuse; for tests and hosts that release memory deliberately. */
export function clearCanonicalProfileExtractionPartCache(): void {
  sharedPlannedPartCache.clear();
}

async function fetchPlannedBatch(
  executor: CanonicalProfileExtractionExecutor,
  request: CanonicalCandidateProfileExtractionRequest,
  controls: CanonicalProfileExtractionControls,
  plannedCall: CanonicalProfileExtractionPlannedCall,
  groundingRecovery?: CanonicalCandidateProfileExtractionRequest["groundingRecovery"],
): Promise<CanonicalCandidateProfileExtractionProposal> {
  throwIfAborted(request.signal);
  let response: ModelResponse<JsonObject>;
  try {
    response = await executeWithCancellation(
      executor,
      buildBoundedCallRequest(request, controls, plannedCall, groundingRecovery),
      request.signal,
    );
  } catch (error) {
    throwIfAborted(request.signal);
    if (isOutputLimitFailure(error)) throw outputLimitFailure(controls.model.company);
    throw error;
  }
  throwIfAborted(request.signal);
  return parseBatch(response.output, controls.model.company);
}

function groundPlannedBatch(
  request: CanonicalCandidateProfileExtractionRequest,
  batch: CanonicalCandidateProfileExtractionProposal,
  groundingRecovery?: CanonicalCandidateProfileExtractionRequest["groundingRecovery"],
): CanonicalCandidateProfileExtractionProposal {
  if (request.groundProposal === undefined) return batch;
  try {
    return request.groundProposal(batch);
  } catch (error) {
    // A replacement batch that still fails grounding keeps its grounded facts when a filter exists.
    if (
      groundingRecovery === undefined ||
      request.filterGroundedProposal === undefined ||
      !(error instanceof CandidateProfileGroundingError)
    ) {
      throw error;
    }
    return request.filterGroundedProposal(batch);
  }
}

/**
 * Run one planned call, with at most one replacement for that same call after a grounding failure.
 * A second failure drops only the ungrounded facts when the request supplies a filter. A cached
 * entry is replayed through the same local grounding without calling the provider.
 */
async function executePlannedCall(
  executor: CanonicalProfileExtractionExecutor,
  request: CanonicalCandidateProfileExtractionRequest,
  controls: CanonicalProfileExtractionControls,
  plannedCall: CanonicalProfileExtractionPlannedCall,
  cached: CanonicalProfileExtractionPlannedLeafEntry | undefined,
): Promise<LeafRun> {
  throwIfAborted(request.signal);
  if (cached !== undefined) {
    return {
      result: groundPlannedBatch(request, cached.batch, cached.groundingRecovery),
      entry: cached,
    };
  }
  const batch = await fetchPlannedBatch(executor, request, controls, plannedCall);
  try {
    return { result: groundPlannedBatch(request, batch), entry: { batch } };
  } catch (error) {
    throwIfAborted(request.signal);
    if (!(error instanceof CandidateProfileGroundingError)) throw error;
    const groundingRecovery = Object.freeze(
      error.diagnosticCounts.map(({ code, count }) => Object.freeze({ code, count })),
    );
    const replacement = await fetchPlannedBatch(
      executor,
      request,
      controls,
      plannedCall,
      groundingRecovery,
    );
    return {
      result: groundPlannedBatch(request, replacement, groundingRecovery),
      entry: { batch: replacement, groundingRecovery },
    };
  }
}

/**
 * Identify a part by its content and the settings that shape its result, not by operation id,
 * because the operation id changes with every snapshot and would never match on a user retry.
 */
function plannedPartKey(
  request: CanonicalCandidateProfileExtractionRequest,
  controls: CanonicalProfileExtractionControls,
  plannedCall: CanonicalProfileExtractionPlannedCall,
): string {
  const source = request.sources.find((candidate) => candidate.id === plannedCall.sourceId);
  return JSON.stringify([
    plannedCall.sourceId,
    source?.checksum,
    source?.text.length,
    plannedCall.window?.start,
    plannedCall.window?.end,
    controls.model,
    controls.systemPrompt,
    controls.maxOutputTokens,
    request.groundProposal !== undefined,
  ]);
}

/**
 * Run one window, and halve it after an output-limit failure. Halves keep exact offsets into the
 * source and run one after the other, each with its own grounding recovery, down to the split
 * depth and size limits or the plan's call cap; past those the output-limit failure stands. A
 * halved window is cached as a split decision so a user retry reuses its cached halves instead of
 * repeating the overflowing request.
 */
async function executePlannedWindow(
  executor: CanonicalProfileExtractionExecutor,
  request: CanonicalCandidateProfileExtractionRequest,
  controls: CanonicalProfileExtractionControls,
  plannedCall: CanonicalProfileExtractionPlannedCall,
  cached: PlannedPartEntry | undefined,
  depth: number,
  state: PlannedRunState,
): Promise<PlannedPartRun> {
  throwIfAborted(request.signal);
  const key = plannedPartKey(request, controls, plannedCall);
  const splitEntry: PlannedPartEntry = { split: true };
  const replayedSplit = cached !== undefined && "split" in cached;
  if (cached === undefined || !("split" in cached)) {
    try {
      const leaf = await executePlannedCall(executor, request, controls, plannedCall, cached);
      return { result: [leaf.result], entry: leaf.entry };
    } catch (error) {
      throwIfAborted(request.signal);
      if (!isOutputLimitFailure(error)) throw error;
    }
  }

  const source = request.sources.find((candidate) => candidate.id === plannedCall.sourceId);
  if (source === undefined) throw outputLimitFailure(controls.model.company);
  const window = plannedCall.window ?? { start: 0, end: source.text.length, text: source.text };
  const halves =
    depth >= maximumCanonicalProfileExtractionSplitDepth
      ? null
      : splitCanonicalProfileExtractionWindow(window);
  // A split replayed from the cache was already admitted; a new one must fit under the call cap.
  const exceedsCallCap =
    !replayedSplit &&
    !state.splitKeys.has(key) &&
    state.plannedCount + state.splitKeys.size + 1 > proactivePlanMaximumCallCount;
  if (halves === null || exceedsCallCap) throw outputLimitFailure(controls.model.company);
  state.splitKeys.add(key);
  state.cache.set(key, splitEntry);
  state.touchedKeys.add(key);

  const results: CanonicalCandidateProfileExtractionProposal[] = [];
  for (const half of halves) {
    const halfCall: CanonicalProfileExtractionPlannedCall = {
      sourceId: plannedCall.sourceId,
      window: half,
    };
    const halfKey = plannedPartKey(request, controls, halfCall);
    const run = await executePlannedWindow(
      executor,
      request,
      controls,
      halfCall,
      state.cache.get(halfKey),
      depth + 1,
      state,
    );
    state.cache.set(halfKey, run.entry);
    state.touchedKeys.add(halfKey);
    results.push(...run.result);
  }
  return { result: results, entry: splitEntry };
}

/** Retry only explicit output-token truncation with bounded, source-focused batches. */
export async function executeCanonicalProfileExtractionWithFallback(
  executor: CanonicalProfileExtractionExecutor,
  request: CanonicalCandidateProfileExtractionRequest,
  controls: CanonicalProfileExtractionControls,
): Promise<JsonObject> {
  throwIfAborted(request.signal);
  const plannedCalls = planCanonicalProfileExtractionCalls(
    request.sources,
    controls.maxOutputTokens,
  );
  // No request may carry more than the unplanned bound of one source: only planned windows may.
  if (
    hasCanonicalProfileSourceAboveUnplannedBound(request.sources) &&
    (plannedCalls === null || request.groundingRecovery !== undefined)
  ) {
    throw new CliUserError(canonicalProfileUnboundableSourceMessage);
  }
  if (request.groundingRecovery !== undefined) {
    const response = await executeWithCancellation(
      executor,
      buildRequest(request, controls),
      request.signal,
    );
    throwIfAborted(request.signal);
    return response.output;
  }

  if (plannedCalls !== null) {
    reportCanonicalProfileExtractionProgress(request.onProgress, 0, plannedCalls.length);
    const cache = controls.partCache ?? sharedPlannedPartCache;
    const state: PlannedRunState = {
      cache,
      plannedCount: plannedCalls.length,
      splitKeys: new Set(),
      touchedKeys: new Set(),
    };
    const parts = await runCanonicalProfileExtractionParts({
      parts: plannedCalls,
      keyOf: (plannedCall) => plannedPartKey(request, controls, plannedCall),
      run: (plannedCall, cached) =>
        executePlannedWindow(executor, request, controls, plannedCall, cached, 0, state),
      cache,
      ...(controls.concurrency === undefined ? {} : { concurrency: controls.concurrency }),
      defaultConcurrency: defaultCanonicalProfileExtractionConcurrencyFor(controls.model.company),
      // A window that still overflows after splitting would only overflow again on a retry.
      shouldRetry: (error) => !isOutputLimitFailure(error),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
      onCompleted: (completed, total) =>
        reportCanonicalProfileExtractionProgress(request.onProgress, completed, total),
    });
    // The extraction succeeded, so nothing it cached is needed for a retry.
    for (const key of state.touchedKeys) cache.delete(key);

    const aggregate = aggregateBatches(parts.flat(), controls.model.company);
    throwIfAborted(request.signal);
    return aggregate as unknown as JsonObject;
  }

  const initialRequest = buildRequest(request, controls);

  let initialResponse: ModelResponse<JsonObject>;
  try {
    initialResponse = await executeWithCancellation(executor, initialRequest, request.signal);
  } catch (error) {
    throwIfAborted(request.signal);
    if (!isOutputLimitFailure(error) || !canFocusSources(request)) throw error;

    const batches: CanonicalCandidateProfileExtractionProposal[] = [];
    for (const source of request.sources) {
      throwIfAborted(request.signal);
      let focusedResponse: ModelResponse<JsonObject>;
      try {
        focusedResponse = await executeWithCancellation(
          executor,
          buildRequest(request, controls, source.id),
          request.signal,
        );
      } catch (batchError) {
        throwIfAborted(request.signal);
        if (!isOutputLimitFailure(batchError)) throw batchError;
        const windows = planCanonicalProfileExtractionTextWindows(source.text);
        if (windows === null) throw outputLimitFailure(controls.model.company);
        for (const window of windows) {
          throwIfAborted(request.signal);
          let sectionResponse: ModelResponse<JsonObject>;
          try {
            sectionResponse = await executeWithCancellation(
              executor,
              buildRequest(request, controls, source.id, window),
              request.signal,
            );
          } catch (sectionError) {
            throwIfAborted(request.signal);
            if (isOutputLimitFailure(sectionError)) {
              throw outputLimitFailure(controls.model.company);
            }
            throw sectionError;
          }
          batches.push(parseBatch(sectionResponse.output, controls.model.company));
        }
        continue;
      }
      throwIfAborted(request.signal);
      batches.push(parseBatch(focusedResponse.output, controls.model.company));
    }

    const aggregate = aggregateBatches(batches, controls.model.company);
    throwIfAborted(request.signal);
    return aggregate as unknown as JsonObject;
  }

  throwIfAborted(request.signal);
  return initialResponse.output;
}
