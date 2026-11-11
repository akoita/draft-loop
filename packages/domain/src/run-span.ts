/**
 * What a run span may carry (#1102, #1103). A span records that a step of a run happened, how long
 * it took and what it cost; it never holds candidate material, a prompt or model output. The names
 * below are the whole vocabulary: the tracing port drops anything else, and the span store refuses
 * it.
 */

export const runSpanNames = ["invoke_workflow", "invoke_agent", "retrieve_evidence"] as const;
export type RunSpanName = (typeof runSpanNames)[number];

/** The only attribute names a run span may carry. */
export const runSpanAttributeNames = [
  "gen_ai.operation.name",
  "gen_ai.provider.name",
  "gen_ai.request.model",
  "gen_ai.usage.input_tokens",
  "gen_ai.usage.output_tokens",
  "gen_ai.usage.cache_read.input_tokens",
  "gen_ai.usage.cache_creation.input_tokens",
  "error.type",
  "draftloop.run.id",
  "draftloop.round",
  "draftloop.step",
  "draftloop.attempt",
  "draftloop.estimated_usd",
  "draftloop.failure_stage",
  "draftloop.retrieved_chunks",
] as const;
export type RunSpanAttributeName = (typeof runSpanAttributeNames)[number];

export type RunSpanAttributeValue = string | number | boolean;
export type RunSpanAttributes = Partial<Record<RunSpanAttributeName, RunSpanAttributeValue>>;

export type RunSpanStatus = "ok" | "error";

/** Identifiers are short and plain: a longer or free-text value is not an identifier. */
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/u;
const attributeNames: ReadonlySet<string> = new Set(runSpanAttributeNames);
const spanNames: ReadonlySet<string> = new Set(runSpanNames);

export function isRunSpanName(name: unknown): name is RunSpanName {
  return typeof name === "string" && spanNames.has(name);
}

export function isRunSpanAttributeName(name: string): name is RunSpanAttributeName {
  return attributeNames.has(name);
}

/** A finite number, a boolean or a short identifier: nothing that could hold content. */
export function isContentFreeSpanValue(value: unknown): value is RunSpanAttributeValue {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  return typeof value === "string" && identifierPattern.test(value);
}
