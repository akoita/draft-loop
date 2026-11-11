/**
 * Bridge contract for a run's trace (#2693): the content-free spans the server recorded while it
 * executed the run. A span crosses the bridge with its timing, status and a closed set of
 * attributes (numbers, booleans and short identifiers), never a prompt, a draft or candidate
 * material. Hosts that record no trace leave the capability out, and Run details then shows no
 * steps.
 */

import {
  isContentFreeSpanValue,
  isRunSpanAttributeName,
  isRunSpanName,
  type RunSpanAttributes,
  type RunSpanName,
  type RunSpanStatus,
} from "@draft-loop/domain/run-span";

export interface RunTraceSpanView {
  readonly spanId: string;
  /** The span this one ran inside; null for a root. */
  readonly parentSpanId: string | null;
  readonly name: RunSpanName;
  readonly startedAt: string;
  /** Null when the step never finished. */
  readonly endedAt: string | null;
  readonly status: RunSpanStatus | null;
  readonly attributes: RunSpanAttributes;
}

export interface RunTraceInput {
  readonly workspaceId: string;
  readonly runId: string;
}

export interface RunTraceResult {
  readonly workspaceId: string;
  readonly runId: string;
  /** In start order. */
  readonly spans: readonly RunTraceSpanView[];
}

type Raw = Readonly<Record<string, unknown>>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$/u;
/** A run that needs more spans than this is not one the drawer can list. */
const maximumSpans = 2000;

function record(value: unknown): Raw | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Raw)
    : undefined;
}

function onlyKeys(value: Raw, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function identifier(value: unknown): string | undefined {
  return typeof value === "string" && identifierPattern.test(value) ? value : undefined;
}

function timestamp(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value))
    ? value
    : undefined;
}

function attributes(value: unknown): RunSpanAttributes | undefined {
  const raw = record(value);
  if (raw === undefined) return undefined;
  const kept: Record<string, string | number | boolean> = {};
  for (const [name, entry] of Object.entries(raw)) {
    if (!isRunSpanAttributeName(name) || !isContentFreeSpanValue(entry)) return undefined;
    kept[name] = entry;
  }
  return kept;
}

function span(value: unknown): RunTraceSpanView | undefined {
  const raw = record(value);
  if (
    raw === undefined ||
    !onlyKeys(raw, [
      "spanId",
      "parentSpanId",
      "name",
      "startedAt",
      "endedAt",
      "status",
      "attributes",
    ])
  ) {
    return undefined;
  }
  const spanId = identifier(raw.spanId);
  const parentSpanId = raw.parentSpanId === null ? null : identifier(raw.parentSpanId);
  const startedAt = timestamp(raw.startedAt);
  const endedAt = raw.endedAt === null ? null : timestamp(raw.endedAt);
  const status =
    raw.status === null || raw.status === "ok" || raw.status === "error" ? raw.status : undefined;
  const kept = attributes(raw.attributes);
  if (
    spanId === undefined ||
    parentSpanId === undefined ||
    !isRunSpanName(raw.name) ||
    startedAt === undefined ||
    endedAt === undefined ||
    status === undefined ||
    kept === undefined
  ) {
    return undefined;
  }
  return { spanId, parentSpanId, name: raw.name, startedAt, endedAt, status, attributes: kept };
}

export function validateRunTraceInput(value: unknown): RunTraceInput | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, ["workspaceId", "runId"])) return undefined;
  const workspaceId = identifier(raw.workspaceId);
  const runId = identifier(raw.runId);
  return workspaceId === undefined || runId === undefined ? undefined : { workspaceId, runId };
}

/** The trace as the host answered it; `undefined` when any span carries more than the contract. */
export function normalizeRunTraceResult(value: unknown): RunTraceResult | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, ["workspaceId", "runId", "spans"])) return undefined;
  const workspaceId = identifier(raw.workspaceId);
  const runId = identifier(raw.runId);
  if (
    workspaceId === undefined ||
    runId === undefined ||
    !Array.isArray(raw.spans) ||
    raw.spans.length > maximumSpans
  ) {
    return undefined;
  }
  const spans = raw.spans.map(span);
  if (spans.some((entry) => entry === undefined)) return undefined;
  return { workspaceId, runId, spans: spans as RunTraceSpanView[] };
}
