/**
 * Bridge contract for each knowledge source's evidence kind: what the material is (a CV, a
 * performance review, notes, ...), detected locally or set by the person. The renderer reads the
 * kinds of one knowledge base's current sources and sets or clears one source's override. Only
 * ids, the source's display name and the kind cross the bridge; never text or paths. The runtime
 * key lists are bound to the interfaces, so adding a field to one without the other is a compile
 * error rather than a validator that silently rejects real payloads.
 */
import {
  type CandidateEvidenceKind,
  candidateEvidenceKinds,
} from "@draft-loop/domain/candidate-evidence-kind";

export type { CandidateEvidenceKind } from "@draft-loop/domain/candidate-evidence-kind";
export { candidateEvidenceKinds } from "@draft-loop/domain/candidate-evidence-kind";

export const sourceEvidenceKindOrigins = ["detected", "user"] as const;
export type SourceEvidenceKindOrigin = (typeof sourceEvidenceKindOrigins)[number];

export interface SourceEvidenceKindsInput {
  readonly storeId: string;
  readonly knowledgeBaseId: string;
}

export interface SourceEvidenceKindSetInput extends SourceEvidenceKindsInput {
  readonly sourceId: string;
  /** The kind to pin, or null to clear the override and return to the detected kind. */
  readonly kind: CandidateEvidenceKind | null;
}

export interface SourceEvidenceKindSummary {
  readonly sourceId: string;
  readonly displayName: string;
  readonly kind: CandidateEvidenceKind;
  readonly origin: SourceEvidenceKindOrigin;
}

export interface SourceEvidenceKindsResult {
  readonly storeId: string;
  readonly knowledgeBaseId: string;
  readonly sources: readonly SourceEvidenceKindSummary[];
  /** True when the base has more current sources than the bridge returns. */
  readonly truncated: boolean;
}

export interface SourceEvidenceKindSetResult {
  readonly storeId: string;
  readonly knowledgeBaseId: string;
  readonly source: SourceEvidenceKindSummary;
}

/** The most sources one listing returns; the rest are reported as truncated. */
export const maximumSourceEvidenceKindEntries = 200;
export const maximumSourceEvidenceKindDisplayNameLength = 200;

function exactKeys<Shape extends object>() {
  return <const Keys extends readonly (keyof Shape & string)[]>(
    keys: Keys & {
      readonly [Key in Exclude<keyof Shape, Keys[number]>]: "add this key to the runtime key list";
    },
  ): Keys => keys;
}

export const sourceEvidenceKindsInputKeys = exactKeys<SourceEvidenceKindsInput>()([
  "storeId",
  "knowledgeBaseId",
]);
export const sourceEvidenceKindSetInputKeys = exactKeys<SourceEvidenceKindSetInput>()([
  "storeId",
  "knowledgeBaseId",
  "sourceId",
  "kind",
]);
const summaryKeys = exactKeys<SourceEvidenceKindSummary>()([
  "sourceId",
  "displayName",
  "kind",
  "origin",
]);
const listResultKeys = exactKeys<SourceEvidenceKindsResult>()([
  "storeId",
  "knowledgeBaseId",
  "sources",
  "truncated",
]);
const setResultKeys = exactKeys<SourceEvidenceKindSetResult>()([
  "storeId",
  "knowledgeBaseId",
  "source",
]);

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$/u;

type Raw = Readonly<Record<string, unknown>>;

function record(value: unknown, keys: readonly string[]): Raw | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const raw = value as Raw;
  return Object.keys(raw).every((key) => keys.includes(key)) ? raw : undefined;
}

function identifier(value: unknown): string | undefined {
  return typeof value === "string" && identifierPattern.test(value) ? value : undefined;
}

function evidenceKind(value: unknown): CandidateEvidenceKind | undefined {
  return candidateEvidenceKinds.find((candidate) => candidate === value);
}

function displayName(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.trim() !== "" &&
    [...value].length <= maximumSourceEvidenceKindDisplayNameLength &&
    !/[\r\n]/u.test(value)
    ? value
    : undefined;
}

/** Validates a renderer request for one base's kinds; undefined rejects it. */
export function parseSourceEvidenceKindsInput(
  value: unknown,
): SourceEvidenceKindsInput | undefined {
  const raw = record(value, sourceEvidenceKindsInputKeys);
  const storeId = identifier(raw?.storeId);
  const knowledgeBaseId = identifier(raw?.knowledgeBaseId);
  return storeId === undefined || knowledgeBaseId === undefined
    ? undefined
    : { storeId, knowledgeBaseId };
}

/** Validates a renderer request to set or clear one source's kind; undefined rejects it. */
export function parseSourceEvidenceKindSetInput(
  value: unknown,
): SourceEvidenceKindSetInput | undefined {
  const raw = record(value, sourceEvidenceKindSetInputKeys);
  const base = parseSourceEvidenceKindsInput(
    raw === undefined ? undefined : { storeId: raw.storeId, knowledgeBaseId: raw.knowledgeBaseId },
  );
  const sourceId = identifier(raw?.sourceId);
  if (raw === undefined || !("kind" in raw)) return undefined;
  const kind = raw.kind === null ? null : evidenceKind(raw.kind);
  return base === undefined || sourceId === undefined || kind === undefined
    ? undefined
    : { ...base, sourceId, kind };
}

function summary(value: unknown): SourceEvidenceKindSummary | undefined {
  const raw = record(value, summaryKeys);
  const sourceId = identifier(raw?.sourceId);
  const name = displayName(raw?.displayName);
  const kind = evidenceKind(raw?.kind);
  const origin = sourceEvidenceKindOrigins.find((candidate) => candidate === raw?.origin);
  return sourceId === undefined || name === undefined || kind === undefined || origin === undefined
    ? undefined
    : { sourceId, displayName: name, kind, origin };
}

/** Validates the host's listing; undefined means the host answered wrongly. */
export function normalizeSourceEvidenceKindsResult(
  value: unknown,
): SourceEvidenceKindsResult | undefined {
  const raw = record(value, listResultKeys);
  const storeId = identifier(raw?.storeId);
  const knowledgeBaseId = identifier(raw?.knowledgeBaseId);
  if (
    raw === undefined ||
    storeId === undefined ||
    knowledgeBaseId === undefined ||
    typeof raw.truncated !== "boolean" ||
    !Array.isArray(raw.sources) ||
    raw.sources.length > maximumSourceEvidenceKindEntries
  ) {
    return undefined;
  }
  const sources: SourceEvidenceKindSummary[] = [];
  for (const entry of raw.sources) {
    const parsed = summary(entry);
    if (parsed === undefined || sources.some((source) => source.sourceId === parsed.sourceId)) {
      return undefined;
    }
    sources.push(parsed);
  }
  return { storeId, knowledgeBaseId, sources, truncated: raw.truncated };
}

/** Validates the host's answer to a set or clear; undefined means the host answered wrongly. */
export function normalizeSourceEvidenceKindSetResult(
  value: unknown,
): SourceEvidenceKindSetResult | undefined {
  const raw = record(value, setResultKeys);
  const storeId = identifier(raw?.storeId);
  const knowledgeBaseId = identifier(raw?.knowledgeBaseId);
  const source = summary(raw?.source);
  return storeId === undefined || knowledgeBaseId === undefined || source === undefined
    ? undefined
    : { storeId, knowledgeBaseId, source };
}

/** How the panel names a kind. */
export function evidenceKindLabel(kind: CandidateEvidenceKind): string {
  switch (kind) {
    case "cv":
      return "CV";
    case "linkedin-export":
      return "LinkedIn export";
    case "performance-review":
      return "Performance review";
    case "notes":
      return "Notes";
    case "transcript":
      return "Transcript";
    case "other":
      return "Other";
  }
}

/** How the panel says where a kind came from. */
export function evidenceKindOriginLabel(origin: SourceEvidenceKindOrigin): string {
  return origin === "user" ? "set by you" : "detected";
}
