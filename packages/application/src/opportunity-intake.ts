import { createHash } from "node:crypto";
import { basename } from "node:path";
import {
  opportunityBriefMaximumCollectionEntries,
  opportunityBriefMaximumIdLength,
  opportunityBriefMaximumSourceCount,
  opportunityBriefMaximumSourceIds,
  opportunityBriefMaximumTextLength,
} from "@draft-loop/domain";
import {
  ingestFile as defaultIngestFile,
  ingestUrl as defaultIngestUrl,
  type IngestionIssue,
  type IngestionOptions,
  type IngestionResult,
  type UrlIngestionOptions,
} from "@draft-loop/ingestion";
import type {
  OpportunityBrief,
  OpportunityBriefCandidateInstructions,
  OpportunityBriefInput,
  OpportunityBriefIssue,
  OpportunityBriefProvenance,
  OpportunityBriefSource,
  OpportunityBriefSourcedText,
} from "@draft-loop/schemas";
import { buildOpportunityBrief } from "./opportunity-brief.js";
import {
  type OpportunityExtractionPort,
  type OpportunityExtractionSource,
  processOpportunityExtraction,
} from "./opportunity-extraction.js";

/** Maximum raw text accepted from a pasted or candidate-input source. */
export const maximumOpportunityIntakeContentBytes = 64 * 1024;

const opportunitySourceClassifications = [
  "job-posting",
  "social-announcement",
  "company-context",
] as const;
type OpportunitySourceClassification = (typeof opportunitySourceClassifications)[number];

interface CommonOpportunitySourceInput {
  readonly id: string;
  readonly classification: OpportunitySourceClassification;
  readonly capturedAt?: string;
}

export interface ApprovedUrlOpportunitySourceInput extends CommonOpportunitySourceInput {
  readonly kind: "approved-url";
  readonly url: string;
  /** Explicit user approval is required even when the URL is otherwise safe. */
  readonly approved: boolean;
}

export interface LocalFileOpportunitySourceInput extends CommonOpportunitySourceInput {
  readonly kind: "local-file";
  /** Host-owned path; it is never copied into the returned brief. */
  readonly path: string;
}

export interface PastedContentOpportunitySourceInput extends CommonOpportunitySourceInput {
  readonly kind: "pasted-content";
  readonly content: string;
}

export interface CandidateInputOpportunitySourceInput {
  readonly id: string;
  readonly kind: "candidate-input";
  readonly classification: "candidate-instruction";
  readonly capturedAt?: string;
  readonly content: string;
  readonly instructions?: CandidateInputInstructions;
}

export interface CandidateInputInstructions {
  readonly tone?: string;
  readonly applicationGoal?: string;
  readonly forbiddenLanguage?: readonly string[];
  readonly focusAreas?: readonly string[];
}

export type OpportunitySourceInput =
  | ApprovedUrlOpportunitySourceInput
  | LocalFileOpportunitySourceInput
  | PastedContentOpportunitySourceInput
  | CandidateInputOpportunitySourceInput;

export interface CreateOpportunityDraftInput {
  readonly id?: string;
  readonly createdAt?: string;
  readonly sources: readonly OpportunitySourceInput[];
}

export interface OpportunityIntakeDependencies {
  readonly ingestUrl?: typeof defaultIngestUrl;
  readonly ingestFile?: typeof defaultIngestFile;
}

export interface CreateOpportunityDraftOptions {
  readonly now?: () => string;
  readonly dependencies?: OpportunityIntakeDependencies;
  readonly urlIngestionOptions?: UrlIngestionOptions;
  readonly fileIngestionOptions?: IngestionOptions;
  readonly extractor?: OpportunityExtractionPort;
  readonly signal?: AbortSignal;
}

export type OpportunityDraftPatch = Partial<
  Pick<
    OpportunityBriefInput,
    | "role"
    | "employer"
    | "responsibilities"
    | "requirements"
    | "priorities"
    | "candidateInstructions"
    | "issues"
  >
>;

const editableOpportunityDraftFields = new Set([
  "role",
  "employer",
  "responsibilities",
  "requirements",
  "priorities",
  "candidateInstructions",
  "issues",
]);

const opportunityIntakeIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const candidateInstructionFields = new Set([
  "tone",
  "applicationGoal",
  "forbiddenLanguage",
  "focusAreas",
]);

const inaccessibleIngestionCodes = new Set<IngestionIssue["code"]>([
  "approval-required",
  "unsafe-url",
]);

const unsupportedIngestionCodes = new Set<IngestionIssue["code"]>([
  "unsupported-media-type",
  "unsupported-content-type",
  "extractor-unavailable",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contentChecksum(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function safeDigest(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\u0000"), "utf8").digest("hex");
}

function issueId(kind: string, sourceIds: readonly string[]): string {
  return `intake-issue-${safeDigest([kind, ...sourceIds]).slice(0, 32)}`;
}

function assertRawContent(content: unknown): asserts content is string {
  if (typeof content !== "string" || content.trim() === "") {
    throw new Error("Opportunity source content must not be empty.");
  }
  if (content.includes("\0")) {
    throw new Error("Opportunity source content contains an invalid character.");
  }
  if (Buffer.byteLength(content, "utf8") > maximumOpportunityIntakeContentBytes) {
    throw new Error("Opportunity source content exceeds the size limit.");
  }
}

function normalizeInstructionText(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.includes("\0") ||
    value.length > opportunityBriefMaximumTextLength
  ) {
    throw new Error("Candidate instruction text is invalid or exceeds the size limit.");
  }
  return value.trim();
}

function normalizeInstructionList(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > opportunityBriefMaximumCollectionEntries) {
    throw new Error("Candidate instruction values are invalid or exceed the size limit.");
  }
  return value.map((entry) => normalizeInstructionText(entry));
}

function normalizeCandidateInstructions(value: unknown): CandidateInputInstructions | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("Candidate input instructions must be an object.");
  for (const key of Object.keys(value)) {
    if (!candidateInstructionFields.has(key)) {
      throw new Error("Candidate input instructions contain an unsupported field.");
    }
  }
  const tone = value.tone === undefined ? undefined : normalizeInstructionText(value.tone);
  const applicationGoal =
    value.applicationGoal === undefined
      ? undefined
      : normalizeInstructionText(value.applicationGoal);
  const forbiddenLanguage =
    value.forbiddenLanguage === undefined
      ? undefined
      : normalizeInstructionList(value.forbiddenLanguage);
  const focusAreas =
    value.focusAreas === undefined ? undefined : normalizeInstructionList(value.focusAreas);
  return {
    ...(tone === undefined ? {} : { tone }),
    ...(applicationGoal === undefined ? {} : { applicationGoal }),
    ...(forbiddenLanguage === undefined ? {} : { forbiddenLanguage }),
    ...(focusAreas === undefined ? {} : { focusAreas }),
  };
}

function assertHttpsUrl(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Opportunity source URL is required.");
  }
  try {
    if (new URL(value).protocol !== "https:") throw new Error();
  } catch {
    throw new Error("Opportunity source URL must be HTTPS.");
  }
}

function assertSafeIdentifier(value: unknown, message: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length > opportunityBriefMaximumIdLength ||
    !opportunityIntakeIdentifierPattern.test(value)
  ) {
    throw new Error(message);
  }
}

function safeDisplayName(hostPath: string): string {
  const normalized = hostPath.replaceAll("\\", "/");
  const candidate = basename(normalized);
  if (
    candidate === "" ||
    candidate === "." ||
    candidate === ".." ||
    candidate.includes("\0") ||
    candidate.length > opportunityBriefMaximumTextLength ||
    candidate.startsWith("~") ||
    candidate.includes("/") ||
    candidate.includes("\\") ||
    /^[A-Za-z]:/u.test(candidate)
  ) {
    return "local-file";
  }
  return candidate;
}

function validateSourceInputs(
  input: CreateOpportunityDraftInput,
): readonly OpportunitySourceInput[] {
  if (!isRecord(input) || !Array.isArray(input.sources) || input.sources.length === 0) {
    throw new Error("At least one opportunity source is required.");
  }
  if (input.sources.length > opportunityBriefMaximumSourceCount) {
    throw new Error("Too many opportunity sources were supplied.");
  }
  const ids = new Set<string>();
  for (const source of input.sources) {
    if (!isRecord(source)) {
      throw new Error("Opportunity source must be an object with a safe id.");
    }
    assertSafeIdentifier(source.id, "Opportunity source id must be a safe bounded identifier.");
    if (ids.has(source.id)) throw new Error("Opportunity source ids must be unique.");
    ids.add(source.id);
    if (source.kind === "candidate-input") {
      if (source.classification !== "candidate-instruction") {
        throw new Error("Candidate-input sources must use candidate-instruction classification.");
      }
      assertRawContent(source.content);
      normalizeCandidateInstructions(source.instructions);
      continue;
    }
    if (source.instructions !== undefined) {
      throw new Error("Only candidate-input sources may include instructions.");
    }
    if (
      !opportunitySourceClassifications.includes(
        source.classification as OpportunitySourceClassification,
      )
    ) {
      throw new Error("Opportunity sources must use an opportunity classification.");
    }
    if (source.kind === "approved-url") {
      assertHttpsUrl(source.url);
      if (typeof source.approved !== "boolean") {
        throw new Error("URL source approval must be explicit.");
      }
    } else if (source.kind === "local-file") {
      if (typeof source.path !== "string" || source.path.trim() === "") {
        throw new Error("Opportunity source file path is required.");
      }
    } else if (source.kind === "pasted-content") {
      assertRawContent(source.content);
    } else {
      throw new Error("Opportunity source kind is unsupported.");
    }
  }
  return input.sources;
}

function sourceStatus(result: IngestionResult): OpportunityBriefSource["status"] {
  const issues = [...result.issues, ...(result.source?.issues ?? [])];
  if (result.source !== null) return issues.length === 0 ? "available" : "partial";
  if (issues.some(({ code }) => inaccessibleIngestionCodes.has(code))) return "inaccessible";
  if (issues.some(({ code }) => unsupportedIngestionCodes.has(code))) return "unsupported";
  return "failed";
}

function issueForSource(
  status: OpportunityBriefSource["status"],
  sourceId: string,
): OpportunityBriefIssue | null {
  if (status === "available") return null;
  const code =
    status === "inaccessible"
      ? "inaccessible-source"
      : status === "unsupported"
        ? "unsupported-source"
        : status === "failed"
          ? "fetch-failure"
          : "partial-fetch";
  const message =
    status === "inaccessible"
      ? "The approved source could not be accessed."
      : status === "unsupported"
        ? "The source format or content is unsupported."
        : status === "failed"
          ? "The source could not be read or processed."
          : "The source was only partially processed.";
  return {
    id: issueId(code, [sourceId]),
    code,
    status: "open",
    severity: status === "partial" ? "warning" : "error",
    message,
    sourceIds: [sourceId],
  };
}

function urlProvenance(
  input: ApprovedUrlOpportunitySourceInput,
  result: IngestionResult,
  fallbackCapturedAt: string,
): OpportunityBriefProvenance {
  const sourceUrl = result.source?.url ?? result.source?.source.url;
  const capturedAt = sourceUrl?.fetchedAt ?? input.capturedAt ?? fallbackCapturedAt;
  const finalUrl = sourceUrl?.finalUrl;
  return {
    kind: "approved-url",
    originalUrl: input.url.trim(),
    ...(finalUrl === undefined || finalUrl === input.url.trim() ? {} : { finalUrl }),
    capturedAt,
    contentChecksum: result.source?.checksum ?? null,
  };
}

function localFileProvenance(
  input: LocalFileOpportunitySourceInput,
  result: IngestionResult,
  capturedAt: string,
): OpportunityBriefProvenance {
  return {
    kind: "local-file",
    displayName: safeDisplayName(input.path),
    capturedAt,
    checksum: result.source?.checksum ?? null,
  };
}

function issueForDuplicate(sourceIds: readonly string[]): OpportunityBriefIssue {
  return {
    id: issueId("duplicate-source", sourceIds),
    code: "duplicate-source",
    status: "open",
    severity: "warning",
    message: "This source duplicates content captured from another source.",
    sourceIds: [...sourceIds],
  };
}

function instructionSemantic(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

interface CandidateScalarInstruction {
  value: string;
  sourceIds: string[];
  conflictingSourceIds: string[];
}

function mergeCandidateScalar(
  current: CandidateScalarInstruction | null,
  value: string,
  sourceId: string,
): CandidateScalarInstruction {
  if (current === null) {
    return { value, sourceIds: [sourceId], conflictingSourceIds: [] };
  }
  if (instructionSemantic(current.value) === instructionSemantic(value)) {
    if (!current.sourceIds.includes(sourceId)) current.sourceIds.push(sourceId);
    return current;
  }
  if (!current.conflictingSourceIds.includes(sourceId)) {
    current.conflictingSourceIds.push(sourceId);
  }
  return current;
}

function candidateConflictIssue(
  field: "tone" | "applicationGoal",
  sourceIds: readonly string[],
): OpportunityBriefIssue {
  const label = field === "tone" ? "tone" : "application goal";
  return {
    id: issueId(`candidate-instruction-${field}-conflict`, sourceIds),
    code: "contradiction",
    status: "open",
    severity: "warning",
    message: `Candidate instructions contain conflicting ${label} guidance.`,
    sourceIds: [...sourceIds].slice(0, opportunityBriefMaximumSourceIds),
  };
}

function mergeCandidateInstructions(sourceInputs: readonly OpportunitySourceInput[]): {
  readonly instructions: OpportunityBriefCandidateInstructions;
  readonly issues: readonly OpportunityBriefIssue[];
} {
  let tone: CandidateScalarInstruction | null = null;
  let applicationGoal: CandidateScalarInstruction | null = null;
  const listValues = {
    forbiddenLanguage: new Map<string, { readonly value: string; readonly sourceIds: string[] }>(),
    focusAreas: new Map<string, { readonly value: string; readonly sourceIds: string[] }>(),
  };

  for (const source of sourceInputs) {
    if (source.kind !== "candidate-input") continue;
    const instructions = normalizeCandidateInstructions(source.instructions);
    if (instructions === undefined) continue;
    const sourceId = source.id.trim();
    if (instructions.tone !== undefined) {
      tone = mergeCandidateScalar(tone, instructions.tone, sourceId);
    }
    if (instructions.applicationGoal !== undefined) {
      applicationGoal = mergeCandidateScalar(
        applicationGoal,
        instructions.applicationGoal,
        sourceId,
      );
    }
    for (const [field, values] of [
      ["forbiddenLanguage", instructions.forbiddenLanguage],
      ["focusAreas", instructions.focusAreas],
    ] as const) {
      if (values === undefined) continue;
      const entries = listValues[field];
      for (const value of values) {
        const key = instructionSemantic(value);
        const existing = entries.get(key);
        if (existing === undefined) {
          entries.set(key, { value, sourceIds: [sourceId] });
        } else if (!existing.sourceIds.includes(sourceId)) {
          existing.sourceIds.push(sourceId);
        }
      }
    }
  }

  if (
    listValues.forbiddenLanguage.size > opportunityBriefMaximumCollectionEntries ||
    listValues.focusAreas.size > opportunityBriefMaximumCollectionEntries
  ) {
    throw new Error("Candidate instruction values exceed the configured size limit.");
  }

  const issues: OpportunityBriefIssue[] = [];
  if (tone !== null && tone.conflictingSourceIds.length > 0) {
    issues.push(
      candidateConflictIssue("tone", [
        tone.sourceIds[0] ?? "candidate-source",
        ...tone.conflictingSourceIds,
      ]),
    );
  }
  if (applicationGoal !== null && applicationGoal.conflictingSourceIds.length > 0) {
    issues.push(
      candidateConflictIssue("applicationGoal", [
        applicationGoal.sourceIds[0] ?? "candidate-source",
        ...applicationGoal.conflictingSourceIds,
      ]),
    );
  }

  const toSourcedText = (
    value: CandidateScalarInstruction | null,
  ): OpportunityBriefSourcedText | null =>
    value === null ? null : { value: value.value, sourceIds: [...value.sourceIds] };
  const toSourcedList = (
    values: Map<string, { readonly value: string; readonly sourceIds: string[] }>,
  ): OpportunityBriefSourcedText[] =>
    [...values.values()].map(({ value, sourceIds }) => ({
      value,
      sourceIds: [...sourceIds],
    }));

  return {
    instructions: {
      tone: toSourcedText(tone),
      applicationGoal: toSourcedText(applicationGoal),
      forbiddenLanguage: toSourcedList(listValues.forbiddenLanguage),
      focusAreas: toSourcedList(listValues.focusAreas),
    },
    issues,
  };
}

function extractionMaterialFor(
  input: OpportunitySourceInput,
  result: IngestionResult,
): OpportunityExtractionSource | null {
  if (input.kind === "candidate-input" || result.source === null) return null;
  const status = sourceStatus(result);
  if (status !== "available" && status !== "partial" && status !== "stale") return null;
  if (result.source.text.trim() === "") return null;
  return {
    id: input.id.trim(),
    classification: input.classification,
    status,
    mediaType: result.source.mediaType,
    checksum: result.source.checksum,
    text: result.source.text,
  };
}

function extractionOperationId(
  briefId: string,
  version: number,
  sources: readonly OpportunityExtractionSource[],
): string {
  return `extraction-${safeDigest([
    "opportunity-extraction",
    briefId,
    String(version),
    ...sources.map((source) => `${source.id}:${source.checksum}`),
  ]).slice(0, 32)}`;
}

function sourceResult(
  input: OpportunitySourceInput,
  result: IngestionResult,
  fallbackCapturedAt: string,
): { readonly source: OpportunityBriefSource; readonly issue: OpportunityBriefIssue | null } {
  const capturedAt = input.capturedAt ?? fallbackCapturedAt;
  const status = sourceStatus(result);
  const provenance: OpportunityBriefProvenance =
    input.kind === "approved-url"
      ? urlProvenance(input, result, capturedAt)
      : input.kind === "local-file"
        ? localFileProvenance(input, result, capturedAt)
        : {
            kind: input.kind,
            capturedAt,
            checksum: contentChecksum(input.content),
          };
  return {
    source: {
      id: input.id.trim(),
      classification: input.classification,
      status,
      provenance,
    },
    issue: issueForSource(status, input.id.trim()),
  };
}

async function safelyIngest(
  input: OpportunitySourceInput,
  options: CreateOpportunityDraftOptions,
): Promise<IngestionResult> {
  const dependencies = options.dependencies;
  try {
    if (input.kind === "approved-url") {
      const ingestUrl = dependencies?.ingestUrl ?? defaultIngestUrl;
      return await ingestUrl(input.url, {
        ...options.urlIngestionOptions,
        approved: input.approved,
        approval: input.approved,
      });
    }
    if (input.kind === "local-file") {
      const ingestFile = dependencies?.ingestFile ?? defaultIngestFile;
      return await ingestFile({ path: input.path }, options.fileIngestionOptions);
    }
  } catch {
    return { source: null, issues: [] };
  }
  return {
    source: {
      source: { path: input.kind, mediaType: "text/plain" },
      mediaType: "text/plain",
      checksum: contentChecksum(input.content),
      sizeBytes: Buffer.byteLength(input.content, "utf8"),
      text: input.content,
      chunks: [],
      issues: [],
    },
    issues: [],
  };
}

function briefIdentifier(input: CreateOpportunityDraftInput, createdAt: string): string {
  const supplied = input.id;
  if (supplied !== undefined) {
    assertSafeIdentifier(supplied, "Opportunity brief id must be a safe bounded identifier.");
    return supplied;
  }
  return `brief-${safeDigest([createdAt, ...input.sources.map((source) => source.id)]).slice(0, 32)}`;
}

/** Ingest approved/local sources and build one provider-independent draft brief. */
export async function createOpportunityDraft(
  input: CreateOpportunityDraftInput,
  options: CreateOpportunityDraftOptions = {},
): Promise<OpportunityBrief> {
  const sourcesInput = validateSourceInputs(input);
  const createdAt = input.createdAt ?? options.now?.() ?? new Date().toISOString();
  const id = briefIdentifier(input, createdAt);
  const sourceResults: Array<{
    readonly source: OpportunityBriefSource;
    readonly issue: OpportunityBriefIssue | null;
    readonly result: IngestionResult;
  }> = [];
  for (const sourceInput of sourcesInput) {
    const result = await safelyIngest(sourceInput, options);
    sourceResults.push({ ...sourceResult(sourceInput, result, createdAt), result });
  }

  const sources = sourceResults.map(({ source }) => source);
  const issues = sourceResults.flatMap(({ issue }) => (issue === null ? [] : [issue]));
  const firstByChecksum = new Map<string, string>();
  for (const source of sources) {
    const checksum =
      source.provenance.kind === "approved-url"
        ? source.provenance.contentChecksum
        : source.provenance.checksum;
    if (checksum === null) continue;
    const firstSourceId = firstByChecksum.get(checksum);
    if (firstSourceId === undefined) {
      firstByChecksum.set(checksum, source.id);
    } else {
      issues.push(issueForDuplicate([firstSourceId, source.id]));
    }
  }

  const candidate = mergeCandidateInstructions(sourcesInput);
  const extractionSources = sourcesInput.flatMap((sourceInput, index) => {
    const result = sourceResults[index];
    return result === undefined ? [] : [extractionMaterialFor(sourceInput, result.result)];
  });
  const material = extractionSources.flatMap((source) => (source === null ? [] : [source]));
  const extracted =
    options.extractor === undefined || material.length === 0
      ? null
      : await processOpportunityExtraction(options.extractor, {
          operationId: extractionOperationId(id, 1, material),
          sources: material,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });

  return buildOpportunityBrief({
    schemaVersion: 1,
    id,
    version: 1,
    priorVersion: null,
    status: "draft",
    createdAt,
    reviewedAt: null,
    sources,
    role: extracted?.role ?? null,
    employer: extracted?.employer ?? null,
    responsibilities: extracted?.responsibilities ?? [],
    requirements: extracted?.requirements ?? [],
    priorities: extracted?.priorities ?? [],
    candidateInstructions: candidate.instructions,
    issues: [...issues, ...candidate.issues, ...(extracted?.issues ?? [])],
  });
}

function nextOpportunityBriefVersion(version: number): number {
  if (!Number.isSafeInteger(version) || version < 1 || version >= Number.MAX_SAFE_INTEGER) {
    throw new Error("The opportunity brief version cannot be advanced safely.");
  }
  return version + 1;
}

function assertTimestampNotBefore(value: string, previous: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    Date.parse(value) < Date.parse(previous)
  ) {
    throw new Error("The opportunity brief timestamp must be valid and not precede its parent.");
  }
}

function assertEditablePatch(patch: OpportunityDraftPatch): void {
  if (!isRecord(patch)) throw new Error("An opportunity draft patch object is required.");
  for (const key of Object.keys(patch)) {
    if (!editableOpportunityDraftFields.has(key)) {
      throw new Error("Opportunity brief patch field is not editable.");
    }
  }
}

/** Create a new immutable draft version without mutating the current brief. */
export function editOpportunityDraft(
  current: OpportunityBrief,
  patch: OpportunityDraftPatch,
  createdAt: string,
): OpportunityBrief {
  const base = buildOpportunityBrief(current);
  assertEditablePatch(patch);
  assertTimestampNotBefore(createdAt, base.createdAt);
  return buildOpportunityBrief({
    ...base,
    ...patch,
    version: nextOpportunityBriefVersion(base.version),
    priorVersion: base.version,
    status: "draft",
    createdAt,
    reviewedAt: null,
  });
}

/** Review a draft by creating a new immutable reviewed version. */
export function reviewOpportunityDraft(
  currentDraft: OpportunityBrief,
  reviewedAt: string,
): OpportunityBrief {
  const base = buildOpportunityBrief(currentDraft);
  if (base.status !== "draft") {
    throw new Error("Only a draft opportunity brief can be reviewed.");
  }
  assertTimestampNotBefore(reviewedAt, base.createdAt);
  return buildOpportunityBrief({
    ...base,
    version: nextOpportunityBriefVersion(base.version),
    priorVersion: base.version,
    status: "reviewed",
    createdAt: reviewedAt,
    reviewedAt,
  });
}
