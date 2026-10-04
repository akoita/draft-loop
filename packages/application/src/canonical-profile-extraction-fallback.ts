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
  type CanonicalProfileExtractionPlannedCall,
  planCanonicalProfileExtractionCalls,
} from "./canonical-profile-extraction-plan.js";
import { reportCanonicalProfileExtractionProgress } from "./canonical-profile-extraction-progress.js";
import {
  type CanonicalProfileExtractionTextWindow,
  canonicalProfileExtractionSectionFocus,
  canonicalProfileExtractionSectionFocusInstructions,
  planCanonicalProfileExtractionTextWindows,
} from "./canonical-profile-extraction-sections.js";

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

async function executePlannedBatch(
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
  const batch = parseBatch(response.output, controls.model.company);
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
 * A second failure drops only the ungrounded facts when the request supplies a filter.
 */
async function executePlannedCall(
  executor: CanonicalProfileExtractionExecutor,
  request: CanonicalCandidateProfileExtractionRequest,
  controls: CanonicalProfileExtractionControls,
  plannedCall: CanonicalProfileExtractionPlannedCall,
): Promise<CanonicalCandidateProfileExtractionProposal> {
  try {
    return await executePlannedBatch(executor, request, controls, plannedCall);
  } catch (error) {
    throwIfAborted(request.signal);
    if (!(error instanceof CandidateProfileGroundingError)) throw error;
    const groundingRecovery = Object.freeze(
      error.diagnosticCounts.map(({ code, count }) => Object.freeze({ code, count })),
    );
    return executePlannedBatch(executor, request, controls, plannedCall, groundingRecovery);
  }
}

/** Retry only explicit output-token truncation with bounded, source-focused batches. */
export async function executeCanonicalProfileExtractionWithFallback(
  executor: CanonicalProfileExtractionExecutor,
  request: CanonicalCandidateProfileExtractionRequest,
  controls: CanonicalProfileExtractionControls,
): Promise<JsonObject> {
  throwIfAborted(request.signal);
  if (request.groundingRecovery !== undefined) {
    const response = await executeWithCancellation(
      executor,
      buildRequest(request, controls),
      request.signal,
    );
    throwIfAborted(request.signal);
    return response.output;
  }

  const plannedCalls = planCanonicalProfileExtractionCalls(request.sources);
  if (plannedCalls !== null) {
    const batches: CanonicalCandidateProfileExtractionProposal[] = [];
    reportCanonicalProfileExtractionProgress(request.onProgress, 0, plannedCalls.length);
    for (const [index, plannedCall] of plannedCalls.entries()) {
      batches.push(await executePlannedCall(executor, request, controls, plannedCall));
      reportCanonicalProfileExtractionProgress(request.onProgress, index + 1, plannedCalls.length);
    }

    const aggregate = aggregateBatches(batches, controls.model.company);
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
