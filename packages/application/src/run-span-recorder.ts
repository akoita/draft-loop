import { randomUUID } from "node:crypto";

import type { RunSpanAttributes } from "@draft-loop/domain/run-span";
import { contentFreeSpanAttributes, type RunSpan, type RunTracer } from "@draft-loop/orchestrator";
import type { RunSpanRecord, RunSpanStore } from "@draft-loop/storage/run-spans";

/**
 * Records one run's spans in the span store (#2686). The engine's tracer is synchronous and must
 * never fail a run, so each span is queued for saving when it starts and again when it ends, the
 * saves run one after another in the background, and a save that fails is reported and stops the
 * recording instead of reaching the run. `flush` waits for what is queued.
 */
export interface RunSpanRecorder {
  readonly tracer: RunTracer;
  /** Resolves when every queued save has finished; never rejects. */
  readonly flush: () => Promise<void>;
}

export interface RunSpanRecorderOptions {
  readonly store: Pick<RunSpanStore, "put">;
  readonly workspaceId: string;
  readonly runId: string;
  readonly now?: () => Date;
  /** A span id unique within the run across resumes. Defaults to a random one. */
  readonly newSpanId?: () => string;
  /** Told once, when a save first fails; recording stops there. */
  readonly onError?: (error: unknown) => void;
}

export function createRunSpanRecorder(options: RunSpanRecorderOptions): RunSpanRecorder {
  const now = options.now ?? (() => new Date());
  const newSpanId = options.newSpanId ?? (() => `s-${randomUUID()}`);
  const ids = new WeakMap<RunSpan, string>();
  let queue: Promise<void> = Promise.resolve();
  let stopped = false;

  const save = (record: RunSpanRecord): void => {
    queue = queue.then(async () => {
      if (stopped) return;
      try {
        await options.store.put(record);
      } catch (error) {
        stopped = true;
        try {
          options.onError?.(error);
        } catch {
          // A reporter that throws must not reach the run either.
        }
      }
    });
  };

  return {
    tracer: {
      startSpan: (name, attributes, parent) => {
        let record: RunSpanRecord = {
          workspaceId: options.workspaceId,
          runId: options.runId,
          spanId: newSpanId(),
          parentSpanId: parent === undefined ? null : (ids.get(parent) ?? null),
          name,
          startedAt: now().toISOString(),
          endedAt: null,
          status: null,
          attributes: contentFreeSpanAttributes(attributes),
        };
        save(record);
        const span: RunSpan = {
          setAttributes: (more: RunSpanAttributes) => {
            if (record.status !== null) return;
            record = {
              ...record,
              attributes: { ...record.attributes, ...contentFreeSpanAttributes(more) },
            };
          },
          end: (status) => {
            if (record.status !== null) return;
            record = { ...record, endedAt: now().toISOString(), status };
            save(record);
          },
        };
        ids.set(span, record.spanId);
        return span;
      },
    },
    flush: () => queue,
  };
}
