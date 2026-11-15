import {
  isContentFreeSpanValue,
  isRunSpanAttributeName,
  isRunSpanName,
  type RunSpanAttributes,
  type RunSpanName,
  type RunSpanStatus,
} from "@draft-loop/domain/run-span";

/**
 * Stored run spans (#1103): what the tracing port recorded about a run, kept so a failed run can be
 * diagnosed after the process that ran it has exited. A span is content-free: the store refuses an
 * attribute outside the allowed set, so no candidate material, prompt or model output can be
 * saved here. This module holds the port and an in-memory implementation for tests and
 * single-process stacks; Postgres implements it too.
 */

export interface RunSpanRecord {
  readonly workspaceId: string;
  readonly runId: string;
  /** Unique within the run; a short identifier. */
  readonly spanId: string;
  /** The span this one ran inside, or null for a root. */
  readonly parentSpanId: string | null;
  readonly name: RunSpanName;
  readonly startedAt: string;
  /** Null while the span is open, and for a span whose process died before it ended. */
  readonly endedAt: string | null;
  readonly status: RunSpanStatus | null;
  readonly attributes: RunSpanAttributes;
}

/** A span with the spans that ran inside it, in start order. */
export interface RunSpanNode extends RunSpanRecord {
  readonly children: readonly RunSpanNode[];
}

export interface RunSpanStore {
  /** Saves a span, replacing the one with the same id in the run, so an ended span can be saved again. */
  put(span: RunSpanRecord): Promise<void>;
  /** One run's spans by start time, then span id. */
  list(workspaceId: string, runId: string): Promise<readonly RunSpanRecord[]>;
  /** Removes a run's spans and says how many it held. */
  removeRun(workspaceId: string, runId: string): Promise<number>;
}

export class RunSpanStoreError extends Error {
  readonly code = "invalid_span";

  constructor(reason: string) {
    super(`The run span is malformed: ${reason}.`);
    this.name = "RunSpanStoreError";
  }
}

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const isTime = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));

/**
 * Checks a span before it is stored and returns a copy holding only the known fields. It refuses,
 * rather than drops, an attribute outside the content-free set: a caller that sends one has a bug
 * worth hearing about.
 */
export function requireRunSpanRecord(span: RunSpanRecord): RunSpanRecord {
  const fail = (reason: string): never => {
    throw new RunSpanStoreError(reason);
  };
  if (typeof span.workspaceId !== "string" || span.workspaceId.length < 1) fail("workspace id");
  if (span.workspaceId.length > 256) fail("workspace id");
  if (typeof span.runId !== "string" || span.runId.length < 1 || span.runId.length > 256) {
    fail("run id");
  }
  if (typeof span.spanId !== "string" || !idPattern.test(span.spanId)) fail("span id");
  if (span.parentSpanId !== null) {
    if (typeof span.parentSpanId !== "string" || !idPattern.test(span.parentSpanId)) {
      fail("parent span id");
    }
    if (span.parentSpanId === span.spanId) fail("parent span id");
  }
  if (!isRunSpanName(span.name)) fail("name");
  if (!isTime(span.startedAt)) fail("start time");
  if (span.endedAt !== null && !isTime(span.endedAt)) fail("end time");
  if (span.status !== null && span.status !== "ok" && span.status !== "error") fail("status");
  const attributes: Record<string, string | number | boolean> = {};
  for (const [name, value] of Object.entries(span.attributes ?? {})) {
    // The name is not echoed: an unknown attribute name is itself untrusted text.
    if (!isRunSpanAttributeName(name)) fail("an attribute outside the allowed set");
    if (!isContentFreeSpanValue(value)) fail("an attribute value that is not content-free");
    else attributes[name] = value;
  }
  return {
    workspaceId: span.workspaceId,
    runId: span.runId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    startedAt: span.startedAt,
    endedAt: span.endedAt,
    status: span.status,
    attributes: attributes as RunSpanAttributes,
  };
}

/** Start order: by start time, then span id, both compared as plain text. */
export function compareRunSpans(a: RunSpanRecord, b: RunSpanRecord): number {
  if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt ? -1 : 1;
  if (a.spanId === b.spanId) return 0;
  return a.spanId < b.spanId ? -1 : 1;
}

/**
 * One run's spans as a tree, each level in start order. A span whose parent is missing, or whose
 * parents form a loop, is shown as a root, so nothing stored is hidden.
 */
export function runSpanTree(spans: readonly RunSpanRecord[]): readonly RunSpanNode[] {
  const ordered = [...spans].sort(compareRunSpans);
  const byId = new Map(ordered.map((span) => [span.spanId, span]));
  const reachesRoot = (span: RunSpanRecord): boolean => {
    const seen = new Set<string>([span.spanId]);
    let parentId = span.parentSpanId;
    while (parentId !== null) {
      const parent = byId.get(parentId);
      if (parent === undefined || seen.has(parentId)) return false;
      seen.add(parentId);
      parentId = parent.parentSpanId;
    }
    return true;
  };
  const isRoot = (span: RunSpanRecord): boolean =>
    span.parentSpanId === null || !byId.has(span.parentSpanId) || !reachesRoot(span);
  const childrenOf = new Map<string, RunSpanRecord[]>();
  for (const span of ordered) {
    if (isRoot(span) || span.parentSpanId === null) continue;
    const siblings = childrenOf.get(span.parentSpanId);
    if (siblings === undefined) childrenOf.set(span.parentSpanId, [span]);
    else siblings.push(span);
  }
  const node = (span: RunSpanRecord): RunSpanNode => ({
    ...span,
    children: (childrenOf.get(span.spanId) ?? []).map(node),
  });
  return ordered.filter(isRoot).map(node);
}

/** Run spans in memory, for tests and single-process stacks. */
export function createMemoryRunSpanStore(): RunSpanStore {
  const runs = new Map<string, Map<string, RunSpanRecord>>();
  const idOf = (workspaceId: string, runId: string) => JSON.stringify([workspaceId, runId]);
  return {
    put: async (input) => {
      const span = requireRunSpanRecord(input);
      const id = idOf(span.workspaceId, span.runId);
      const held = runs.get(id) ?? new Map<string, RunSpanRecord>();
      held.set(span.spanId, span);
      runs.set(id, held);
    },
    list: async (workspaceId, runId) =>
      [...(runs.get(idOf(workspaceId, runId))?.values() ?? [])].sort(compareRunSpans),
    removeRun: async (workspaceId, runId) => {
      const id = idOf(workspaceId, runId);
      const count = runs.get(id)?.size ?? 0;
      runs.delete(id);
      return count;
    },
  };
}
