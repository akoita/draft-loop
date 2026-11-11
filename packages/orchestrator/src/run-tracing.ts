/**
 * A provider-independent tracing port for runs (#1102): one `invoke_workflow` span per engine
 * advance of a run, one `invoke_agent` span per author, critic or revision attempt, and a child
 * span for evidence retrieval. The orchestrator holds no OpenTelemetry dependency; an adapter
 * elsewhere maps these spans to a real exporter or a store.
 *
 * Spans are content-free by construction: only the attribute names below are accepted, and every
 * value is a number, a boolean or a short identifier. No candidate material, prompt or model
 * output can enter a span.
 */

import {
  isContentFreeSpanValue,
  isRunSpanAttributeName,
  type RunSpanAttributeName,
  type RunSpanAttributes,
  type RunSpanName,
  type RunSpanStatus,
  runSpanAttributeNames,
  runSpanNames,
} from "@draft-loop/domain/run-span";

/** The OpenTelemetry GenAI semantic-convention version these attribute names follow. */
export const genAiSemanticConventionsVersion = "1.37.0";

export {
  type RunSpanAttributeName,
  type RunSpanAttributes,
  type RunSpanName,
  type RunSpanStatus,
  runSpanAttributeNames,
  runSpanNames,
};

export interface RunSpan {
  readonly setAttributes: (attributes: RunSpanAttributes) => void;
  /** Ends the span once; later calls do nothing. */
  readonly end: (status: RunSpanStatus) => void;
}

export interface RunTracer {
  readonly startSpan: (
    name: RunSpanName,
    attributes: RunSpanAttributes,
    parent?: RunSpan,
  ) => RunSpan;
}

/** The attributes with every unknown name and every non-identifier string dropped. */
export function contentFreeSpanAttributes(attributes: Record<string, unknown>): RunSpanAttributes {
  const kept: Record<string, string | number | boolean> = {};
  for (const [name, value] of Object.entries(attributes)) {
    if (isRunSpanAttributeName(name) && isContentFreeSpanValue(value)) kept[name] = value;
  }
  return kept as RunSpanAttributes;
}

const noopSpan: RunSpan = { setAttributes: () => undefined, end: () => undefined };

/** The default tracer: records nothing. */
export const noopRunTracer: RunTracer = { startSpan: () => noopSpan };

export interface RecordedRunSpan {
  readonly id: number;
  readonly parentId: number | null;
  readonly name: RunSpanName;
  readonly attributes: RunSpanAttributes;
  readonly status: RunSpanStatus | null;
}

/** A tracer that keeps spans in memory, for tests and for an adapter that copies them later. */
export function createMemoryRunTracer(): RunTracer & {
  readonly spans: () => readonly RecordedRunSpan[];
} {
  const recorded: {
    id: number;
    parentId: number | null;
    name: RunSpanName;
    attributes: RunSpanAttributes;
    status: RunSpanStatus | null;
  }[] = [];
  const ids = new WeakMap<RunSpan, number>();
  return {
    startSpan: (name, attributes, parent) => {
      const entry = {
        id: recorded.length + 1,
        parentId: parent === undefined ? null : (ids.get(parent) ?? null),
        name,
        attributes: contentFreeSpanAttributes(attributes),
        status: null as RunSpanStatus | null,
      };
      recorded.push(entry);
      const span: RunSpan = {
        setAttributes: (more) => {
          if (entry.status !== null) return;
          entry.attributes = { ...entry.attributes, ...contentFreeSpanAttributes(more) };
        },
        end: (status) => {
          if (entry.status === null) entry.status = status;
        },
      };
      ids.set(span, entry.id);
      return span;
    },
    spans: () => recorded.map((entry) => ({ ...entry, attributes: { ...entry.attributes } })),
  };
}

/** The content-free fields of a saved execution, as span attributes. */
export function executionSpanAttributes(execution: {
  readonly provider: string;
  readonly modelId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens?: number;
  readonly cacheWriteInputTokens?: number;
  readonly estimatedUsd: number | null;
}): RunSpanAttributes {
  return contentFreeSpanAttributes({
    "gen_ai.provider.name": execution.provider,
    "gen_ai.request.model": execution.modelId,
    "gen_ai.usage.input_tokens": execution.inputTokens,
    "gen_ai.usage.output_tokens": execution.outputTokens,
    "gen_ai.usage.cache_read.input_tokens": execution.cachedInputTokens,
    "gen_ai.usage.cache_creation.input_tokens": execution.cacheWriteInputTokens,
    "draftloop.estimated_usd": execution.estimatedUsd ?? undefined,
  });
}
