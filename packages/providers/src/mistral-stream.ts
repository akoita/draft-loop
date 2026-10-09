import { ProviderAdapterError } from "./index.js";
import { mistralProvider } from "./model-identities.js";

/**
 * Streaming support for the Mistral adapter: attempt deadlines and chunk accumulation.
 *
 * A long structured answer can take many minutes to generate, so a request fails only when
 * no data arrives for the idle period (or the generous overall cap is reached). Diagnostics
 * carry fixed codes and character counts only, never stream content.
 */

export type MistralStreamTimeoutPhase = "initial" | "idle" | "total";

type ResponseFailureStage =
  | "transport-parsing"
  | "response-schema-validation"
  | "output-token-budget-exceeded";

const maximumStreamOutputBytes = 8 * 1024 * 1024;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Codes for a reply that was cut off or garbled in transit. A fresh attempt can succeed, so
 * these are retried. Schema mismatches, limits, refusals, and an unexpected model are
 * deterministic for the same request and stay non-retryable.
 */
export const retryableMistralResponseCodes: ReadonlySet<string> = new Set([
  "invalid_json",
  "missing_output",
  "incomplete_stream",
  "incomplete_response",
  "malformed_stream",
]);

export function failResponse(
  message: string,
  code: string,
  failureStage: ResponseFailureStage = "transport-parsing",
  diagnosticCounts?: readonly { readonly code: string; readonly count: number }[],
): ProviderAdapterError {
  return new ProviderAdapterError(mistralProvider, "invalid-response", message, {
    retryable: retryableMistralResponseCodes.has(code),
    failureStage,
    diagnostics: [{ code, path: "response" }],
    ...(diagnosticCounts === undefined ? {} : { diagnosticCounts }),
  });
}

export function canceledError(): ProviderAdapterError {
  return new ProviderAdapterError(
    mistralProvider,
    "cancelled",
    "The Mistral request was cancelled.",
    { retryable: false },
  );
}

/**
 * Wrap the retry delay so a caller cancellation ends the wait at once instead of after the
 * backoff, which now also precedes retries of broken replies.
 */
export function cancellableSleep(
  sleep: ((ms: number) => Promise<void>) | undefined,
  signal: AbortSignal | undefined,
): (ms: number) => Promise<void> {
  const wait = sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  if (signal === undefined) return wait;
  return (ms) => {
    if (signal.aborted) return Promise.reject(canceledError());
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(canceledError());
      signal.addEventListener("abort", onAbort, { once: true });
      wait(ms).then(
        () => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        },
        (error: unknown) => {
          signal.removeEventListener("abort", onAbort);
          reject(error instanceof Error ? error : new Error("The retry delay failed."));
        },
      );
    });
  };
}

function streamTimeoutError(
  phase: MistralStreamTimeoutPhase,
  answerCharacters: number,
): ProviderAdapterError {
  return new ProviderAdapterError(
    mistralProvider,
    "timeout",
    `The Mistral response timed out during the ${phase} phase.`,
    {
      retryable: true,
      diagnostics: [{ code: `stream_timeout_${phase}`, path: `response.stream.${phase}` }],
      diagnosticCounts: [{ code: "stream_answer_characters", count: answerCharacters }],
    },
  );
}

/** Per-attempt abort scope with an idle timer, an overall cap, and caller cancellation. */
export interface MistralStreamWatchdog {
  /** Passed to the SDK so a timeout or cancellation tears down the connection. */
  readonly signal: AbortSignal;
  /** Settle with the operation, or reject first if the attempt times out or is cancelled. */
  readonly run: <Value>(operation: PromiseLike<Value>) => Promise<Value>;
  /** Restart the idle timer; `idle` also leaves the initial phase. */
  readonly touch: (phase?: "idle") => void;
  readonly recordAnswerCharacters: (count: number) => void;
  readonly dispose: () => void;
}

export function createMistralStreamWatchdog(options: {
  readonly externalSignal: AbortSignal | undefined;
  readonly idleTimeoutMs: number;
  readonly totalTimeoutMs: number;
}): MistralStreamWatchdog {
  const controller = new AbortController();
  let failed = false;
  let phase: Exclude<MistralStreamTimeoutPhase, "total"> = "initial";
  let answerCharacters = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let totalTimer: ReturnType<typeof setTimeout> | undefined;
  let rejectFailure: (error: ProviderAdapterError) => void = () => undefined;
  const failure = new Promise<never>((_resolve, reject) => {
    rejectFailure = reject;
  });
  // The losing branch must never surface as an unhandled rejection.
  failure.catch(() => undefined);

  const clearTimers = () => {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    if (totalTimer !== undefined) clearTimeout(totalTimer);
    idleTimer = undefined;
    totalTimer = undefined;
  };
  const fail = (error: ProviderAdapterError) => {
    if (failed) return;
    failed = true;
    clearTimers();
    rejectFailure(error);
    controller.abort();
  };
  const onExternalAbort = () => fail(canceledError());
  const startIdleTimer = () => {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () => fail(streamTimeoutError(phase, answerCharacters)),
      options.idleTimeoutMs,
    );
  };

  if (options.externalSignal?.aborted) onExternalAbort();
  else {
    options.externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
    totalTimer = setTimeout(
      () => fail(streamTimeoutError("total", answerCharacters)),
      options.totalTimeoutMs,
    );
    startIdleTimer();
  }

  return {
    signal: controller.signal,
    run: (operation) => {
      const settled = Promise.resolve(operation);
      settled.catch(() => undefined);
      return Promise.race([settled, failure]);
    },
    touch: (nextPhase) => {
      if (failed) return;
      if (nextPhase !== undefined) phase = nextPhase;
      startIdleTimer();
    },
    recordAnswerCharacters: (count) => {
      answerCharacters = count;
    },
    dispose: () => {
      clearTimers();
      options.externalSignal?.removeEventListener("abort", onExternalAbort);
      controller.abort();
    },
  };
}

export interface MistralStreamCompletion {
  readonly text: string;
  readonly finishReason: string;
  readonly responseId: string | undefined;
  readonly usage: unknown;
  /** Characters of reasoning the stream returned; the reasoning itself is discarded. */
  readonly reasoningCharacters: number;
}

type StreamRejectionReason =
  | "stream_envelope"
  | "stream_chunk_envelope"
  | "stream_model_metadata"
  | "stream_choice_count"
  | "stream_choice_shape"
  | "stream_choice_index"
  | "stream_tool_data"
  | "stream_content_type"
  | "stream_post_terminal_data"
  | "stream_finish_marker";

function malformedStream(reason: StreamRejectionReason): ProviderAdapterError {
  return failResponse(
    "Mistral returned a malformed streamed response.",
    "malformed_stream",
    "transport-parsing",
    [{ code: reason, count: 1 }],
  );
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { readonly [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] ===
      "function"
  );
}

function isExpectedServedModel(value: unknown, modelId: string): value is string {
  return typeof value === "string" && (value === modelId || value.startsWith(`${modelId}-`));
}

/** Characters in a reasoning chunk, counted only; the text is never kept. */
function reasoningLength(chunk: Record<string, unknown>): number {
  if (!Array.isArray(chunk.thinking)) return 0;
  let length = 0;
  for (const part of chunk.thinking as unknown[]) {
    if (isRecord(part) && typeof part.text === "string") length += part.text.length;
  }
  return length;
}

/** Join a delta's text; reasoning chunks are counted but never stored or mixed into the answer. */
function deltaText(content: unknown): { readonly text: string; readonly reasoning: number } {
  if (content === undefined || content === null) return { text: "", reasoning: 0 };
  if (typeof content === "string") return { text: content, reasoning: 0 };
  if (!Array.isArray(content)) throw malformedStream("stream_content_type");
  let text = "";
  let reasoning = 0;
  for (const chunk of content as unknown[]) {
    if (!isRecord(chunk)) throw malformedStream("stream_content_type");
    if (chunk.type === "thinking") {
      reasoning += reasoningLength(chunk);
      continue;
    }
    if ((chunk.type === undefined || chunk.type === "text") && typeof chunk.text === "string") {
      text += chunk.text;
      continue;
    }
    throw malformedStream("stream_content_type");
  }
  return { text, reasoning };
}

/**
 * Accumulate one streamed completion. Every event, even an empty one, restarts the idle
 * timer. The stream is read to its end so the final usage chunk is not missed.
 */
export async function collectMistralStream(
  stream: unknown,
  options: { readonly watchdog: MistralStreamWatchdog; readonly expectedModelId: string },
): Promise<MistralStreamCompletion> {
  if (!isAsyncIterable(stream)) throw malformedStream("stream_envelope");
  const { watchdog } = options;
  const iterator = stream[Symbol.asyncIterator]();
  let completed = false;
  let text = "";
  let textBytes = 0;
  let reasoningCharacters = 0;
  let finishReason: string | undefined;
  let responseId: string | undefined;
  let usage: unknown;

  try {
    while (true) {
      const next = await watchdog.run(iterator.next());
      watchdog.touch("idle");
      if (next.done === true) break;

      const event: unknown = next.value;
      const chunk = isRecord(event) ? event.data : undefined;
      if (!isRecord(chunk) || !Array.isArray(chunk.choices)) {
        throw malformedStream("stream_chunk_envelope");
      }
      if (!isExpectedServedModel(chunk.model, options.expectedModelId)) {
        if (typeof chunk.model !== "string") throw malformedStream("stream_model_metadata");
        throw failResponse(
          "Mistral returned a response from an unexpected model.",
          "unexpected_response_model",
        );
      }
      if (responseId === undefined && typeof chunk.id === "string" && chunk.id.trim() !== "") {
        responseId = chunk.id;
      }
      if (chunk.usage !== undefined && chunk.usage !== null) usage = chunk.usage;
      if (chunk.choices.length > 1) throw malformedStream("stream_choice_count");

      const choice: unknown = chunk.choices[0];
      if (choice === undefined) continue;
      if (!isRecord(choice)) throw malformedStream("stream_choice_shape");
      if (choice.index !== undefined && choice.index !== 0) {
        throw malformedStream("stream_choice_index");
      }
      const delta = choice.delta;
      if (delta !== undefined && delta !== null && !isRecord(delta)) {
        throw malformedStream("stream_choice_shape");
      }
      if (isRecord(delta) && Array.isArray(delta.toolCalls) && delta.toolCalls.length > 0) {
        throw malformedStream("stream_tool_data");
      }
      const parts = isRecord(delta) ? deltaText(delta.content) : { text: "", reasoning: 0 };
      reasoningCharacters += parts.reasoning;
      const piece = parts.text;
      if (piece !== "") {
        if (finishReason !== undefined) throw malformedStream("stream_post_terminal_data");
        text += piece;
        textBytes += Buffer.byteLength(piece, "utf8");
        watchdog.recordAnswerCharacters(text.length);
        if (textBytes > maximumStreamOutputBytes) {
          throw failResponse(
            "Mistral returned an oversized structured response.",
            "output_too_large",
          );
        }
      }
      if (choice.finishReason !== undefined && choice.finishReason !== null) {
        if (typeof choice.finishReason !== "string") throw malformedStream("stream_finish_marker");
        finishReason = choice.finishReason;
      }
    }
    completed = true;
  } finally {
    if (!completed && typeof iterator.return === "function") {
      try {
        void Promise.resolve(iterator.return()).catch(() => undefined);
      } catch {
        // Iterator cleanup is best effort and must never delay timeout or cancellation.
      }
    }
  }

  if (finishReason === undefined) {
    throw failResponse(
      "Mistral ended the stream before completing the response.",
      "incomplete_stream",
    );
  }
  return { text, finishReason, responseId, usage, reasoningCharacters };
}
