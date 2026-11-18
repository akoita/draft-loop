/**
 * Bridge contract for a run's requirement evidence (#3011, #2984): each job requirement of the run
 * with the evidence chunks that may support it, best first. It names sources and line ranges but
 * never quotes evidence, and it carries grades without the grader's reasons. A host without the
 * read leaves the capability out, and Run details then shows no section.
 */

export type RequirementEvidenceOrigin = "semantic" | "keyword" | "both";
export type RequirementEvidenceGrade = "supports" | "partly-supports" | "does-not-support";

export interface RequirementEvidenceCandidateView {
  readonly chunkId: string;
  readonly origin: RequirementEvidenceOrigin;
  /** Similarity by meaning, from -1 to 1; absent for a keyword-only candidate. */
  readonly score?: number;
  /** The source's name; absent for a run recorded before sources were named. */
  readonly source?: string;
  readonly lineStart?: number;
  readonly lineEnd?: number;
  readonly grade?: RequirementEvidenceGrade;
}

export interface RequirementEvidenceRequirementView {
  readonly requirementId: string;
  /** The requirement's text from the run's job, when the run recorded it. */
  readonly text?: string;
  readonly candidates: readonly RequirementEvidenceCandidateView[];
}

export interface RunRequirementEvidenceView {
  readonly runId: string;
  /** `semantic` when the local model ranked by meaning, `keyword` otherwise. */
  readonly mode: "semantic" | "keyword";
  /** Why the map is keyword-only: no-model, uncalibrated-model or embedding-failed. */
  readonly reason?: string;
  readonly modelId?: string;
  readonly chunkCount: number;
  /** `graded` or `failed` when the run graded the map; absent when it did not. */
  readonly grading?: "graded" | "failed";
  readonly requirements: readonly RequirementEvidenceRequirementView[];
}

export interface RunRequirementEvidenceInput {
  readonly workspaceId: string;
  readonly runId: string;
}

export interface RunRequirementEvidenceResult {
  readonly workspaceId: string;
  readonly runId: string;
  /** Null when the run recorded no map, as a run without requirements does. */
  readonly evidence: RunRequirementEvidenceView | null;
}

type Raw = Readonly<Record<string, unknown>>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$/u;
const maximumRequirements = 200;
const maximumCandidates = 50;
const maximumTextLength = 2000;

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

function shortText(value: unknown, limit = 256): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= limit ? value : undefined;
}

function line(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/** Copies an optional field: absent stays absent, present must be valid. */
function optional<Value>(
  raw: Raw,
  key: string,
  read: (value: unknown) => Value | undefined,
): { readonly ok: boolean; readonly value?: Value } {
  if (!(key in raw) || raw[key] === undefined) return { ok: true };
  const value = read(raw[key]);
  return value === undefined ? { ok: false } : { ok: true, value };
}

function origin(value: unknown): RequirementEvidenceOrigin | undefined {
  return value === "semantic" || value === "keyword" || value === "both" ? value : undefined;
}

function grade(value: unknown): RequirementEvidenceGrade | undefined {
  return value === "supports" || value === "partly-supports" || value === "does-not-support"
    ? value
    : undefined;
}

function score(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= -1 && value <= 1
    ? value
    : undefined;
}

function candidate(value: unknown): RequirementEvidenceCandidateView | undefined {
  const raw = record(value);
  if (
    raw === undefined ||
    !onlyKeys(raw, ["chunkId", "origin", "score", "source", "lineStart", "lineEnd", "grade"])
  ) {
    return undefined;
  }
  const chunkId = shortText(raw.chunkId);
  const kept = origin(raw.origin);
  const fields = {
    score: optional(raw, "score", score),
    source: optional(raw, "source", (entry) => shortText(entry)),
    lineStart: optional(raw, "lineStart", line),
    lineEnd: optional(raw, "lineEnd", line),
    grade: optional(raw, "grade", grade),
  };
  if (chunkId === undefined || kept === undefined || Object.values(fields).some((f) => !f.ok)) {
    return undefined;
  }
  return {
    chunkId,
    origin: kept,
    ...(fields.score.value === undefined ? {} : { score: fields.score.value }),
    ...(fields.source.value === undefined ? {} : { source: fields.source.value }),
    ...(fields.lineStart.value === undefined ? {} : { lineStart: fields.lineStart.value }),
    ...(fields.lineEnd.value === undefined ? {} : { lineEnd: fields.lineEnd.value }),
    ...(fields.grade.value === undefined ? {} : { grade: fields.grade.value }),
  };
}

function requirement(value: unknown): RequirementEvidenceRequirementView | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, ["requirementId", "text", "candidates"])) {
    return undefined;
  }
  const requirementId = shortText(raw.requirementId);
  const text = optional(raw, "text", (entry) =>
    typeof entry === "string" && entry.length <= maximumTextLength ? entry : undefined,
  );
  if (
    requirementId === undefined ||
    !text.ok ||
    !Array.isArray(raw.candidates) ||
    raw.candidates.length > maximumCandidates
  ) {
    return undefined;
  }
  const candidates = raw.candidates.map(candidate);
  if (candidates.some((entry) => entry === undefined)) return undefined;
  return {
    requirementId,
    ...(text.value === undefined || text.value === "" ? {} : { text: text.value }),
    candidates: candidates as RequirementEvidenceCandidateView[],
  };
}

function evidence(value: unknown): RunRequirementEvidenceView | undefined {
  const raw = record(value);
  if (
    raw === undefined ||
    !onlyKeys(raw, ["runId", "mode", "reason", "modelId", "chunkCount", "grading", "requirements"])
  ) {
    return undefined;
  }
  const runId = identifier(raw.runId);
  const mode = raw.mode === "semantic" || raw.mode === "keyword" ? raw.mode : undefined;
  const chunkCount = line(raw.chunkCount);
  const reason = optional(raw, "reason", (entry) => shortText(entry));
  const modelId = optional(raw, "modelId", (entry) => shortText(entry));
  const grading = optional(raw, "grading", (entry) =>
    entry === "graded" || entry === "failed" ? entry : undefined,
  );
  if (
    runId === undefined ||
    mode === undefined ||
    chunkCount === undefined ||
    !reason.ok ||
    !modelId.ok ||
    !grading.ok ||
    !Array.isArray(raw.requirements) ||
    raw.requirements.length > maximumRequirements
  ) {
    return undefined;
  }
  const requirements = raw.requirements.map(requirement);
  if (requirements.some((entry) => entry === undefined)) return undefined;
  return {
    runId,
    mode,
    ...(reason.value === undefined ? {} : { reason: reason.value }),
    ...(modelId.value === undefined ? {} : { modelId: modelId.value }),
    chunkCount,
    ...(grading.value === undefined ? {} : { grading: grading.value }),
    requirements: requirements as RequirementEvidenceRequirementView[],
  };
}

export function validateRunRequirementEvidenceInput(
  value: unknown,
): RunRequirementEvidenceInput | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, ["workspaceId", "runId"])) return undefined;
  const workspaceId = identifier(raw.workspaceId);
  const runId = identifier(raw.runId);
  return workspaceId === undefined || runId === undefined ? undefined : { workspaceId, runId };
}

/** The map as the host answered it; `undefined` when anything carries more than the contract. */
export function normalizeRunRequirementEvidenceResult(
  value: unknown,
): RunRequirementEvidenceResult | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, ["workspaceId", "runId", "evidence"])) return undefined;
  const workspaceId = identifier(raw.workspaceId);
  const runId = identifier(raw.runId);
  if (workspaceId === undefined || runId === undefined) return undefined;
  if (raw.evidence === null) return { workspaceId, runId, evidence: null };
  const kept = evidence(raw.evidence);
  return kept === undefined ? undefined : { workspaceId, runId, evidence: kept };
}
