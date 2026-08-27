import { createHash } from "node:crypto";

import {
  opportunityBriefMaximumIdLength,
  opportunityBriefMaximumSourceCount,
  opportunityBriefMaximumSourceIds,
  opportunityBriefMaximumTextLength,
} from "@draft-loop/domain";
import {
  type OpportunityBriefIssue,
  type OpportunityBriefPriority,
  type OpportunityBriefRequirement,
  type OpportunityBriefResponsibility,
  type OpportunityBriefSourcedText,
  type OpportunityExtractionProposal,
  opportunityExtractionProposalSchema,
} from "@draft-loop/schemas";

const extractionClassifications = [
  "job-posting",
  "social-announcement",
  "company-context",
] as const;
const extractionStatuses = ["available", "partial", "stale"] as const;
const safeIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const checksumPattern = /^[a-f0-9]{64}$/u;

export type OpportunityExtractionSourceClassification = (typeof extractionClassifications)[number];
export type OpportunityExtractionSourceStatus = (typeof extractionStatuses)[number];

/** Sanitized opportunity material supplied to an extraction provider. */
export interface OpportunityExtractionSource {
  readonly id: string;
  readonly classification: OpportunityExtractionSourceClassification;
  readonly status: OpportunityExtractionSourceStatus;
  readonly mediaType: string;
  readonly checksum: string;
  readonly text: string;
}

export interface OpportunityExtractionRequest {
  readonly operationId: string;
  readonly sources: readonly OpportunityExtractionSource[];
  readonly signal?: AbortSignal;
}

/** Provider seam for extracting opportunity facts from sanitized source material. */
export interface OpportunityExtractionPort {
  readonly extract: (request: OpportunityExtractionRequest) => unknown | Promise<unknown>;
}

export interface OpportunityExtractionResult {
  readonly role: OpportunityBriefSourcedText | null;
  readonly employer: OpportunityBriefSourcedText | null;
  readonly responsibilities: readonly OpportunityBriefResponsibility[];
  readonly requirements: readonly OpportunityBriefRequirement[];
  readonly priorities: readonly OpportunityBriefPriority[];
  readonly issues: readonly OpportunityBriefIssue[];
}

export interface OpportunityExtractionProcessor {
  readonly extract: (request: OpportunityExtractionRequest) => Promise<OpportunityExtractionResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneAndFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneAndFreeze(item))) as T;
  }
  if (isRecord(value)) {
    const clone: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      clone[key] = cloneAndFreeze(item);
    }
    return Object.freeze(clone) as T;
  }
  return value;
}

function digest(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\u0000"), "utf8").digest("hex");
}

function normalizedSemantic(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function normalizedSourceIds(sourceIds: readonly string[]): readonly string[] {
  return [...sourceIds].sort((left, right) => left.localeCompare(right));
}

function semanticKey(
  kind: string,
  value: string,
  sourceIds: readonly string[],
  priority?: string,
): string {
  return [kind, normalizedSemantic(value), priority ?? "", ...normalizedSourceIds(sourceIds)].join(
    "\u0001",
  );
}

function generatedEntryId(
  kind: "responsibility" | "requirement" | "priority",
  value: string,
  sourceIds: readonly string[],
  priority?: string,
): string {
  return `extraction-${kind}-${digest([semanticKey(kind, value, sourceIds, priority)]).slice(0, 32)}`;
}

function extractionIssueId(
  kind: string,
  operationId: string,
  sourceIds: readonly string[],
): string {
  return `extraction-issue-${digest([kind, operationId, ...normalizedSourceIds(sourceIds)]).slice(
    0,
    32,
  )}`;
}

function failureSourceIds(sources: readonly OpportunityExtractionSource[]): readonly string[] {
  const safeIds: string[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const sourceId = isRecord(source) && typeof source.id === "string" ? source.id.trim() : "";
    if (
      sourceId.length === 0 ||
      sourceId.length > opportunityBriefMaximumIdLength ||
      !safeIdentifierPattern.test(sourceId) ||
      seen.has(sourceId)
    ) {
      continue;
    }
    seen.add(sourceId);
    safeIds.push(sourceId);
  }
  return (safeIds.length === 0 ? ["extraction-source"] : safeIds).slice(
    0,
    opportunityBriefMaximumSourceIds,
  );
}

function extractionFailure(
  operationId: string,
  sources: readonly OpportunityExtractionSource[],
): OpportunityExtractionResult {
  const sourceIds = failureSourceIds(sources);
  return cloneAndFreeze({
    role: null,
    employer: null,
    responsibilities: [],
    requirements: [],
    priorities: [],
    issues: [
      {
        id: extractionIssueId("extraction-failure", operationId, sourceIds),
        code: "extraction-failure",
        status: "open",
        severity: "error",
        message: "Opportunity source extraction failed; no facts were applied.",
        sourceIds: [...sourceIds],
      },
    ],
  });
}

function validateRequest(request: OpportunityExtractionRequest): OpportunityExtractionRequest {
  if (
    !isRecord(request) ||
    typeof request.operationId !== "string" ||
    request.operationId.length === 0 ||
    request.operationId.length > opportunityBriefMaximumIdLength ||
    !safeIdentifierPattern.test(request.operationId) ||
    !Array.isArray(request.sources) ||
    request.sources.length === 0 ||
    request.sources.length > opportunityBriefMaximumSourceCount
  ) {
    throw new Error("The extraction request is invalid.");
  }

  const sourceIds = new Set<string>();
  const sources: OpportunityExtractionSource[] = [];
  for (const source of request.sources) {
    if (
      !isRecord(source) ||
      typeof source.id !== "string" ||
      source.id.length === 0 ||
      source.id.length > opportunityBriefMaximumIdLength ||
      !safeIdentifierPattern.test(source.id) ||
      sourceIds.has(source.id) ||
      !extractionClassifications.includes(
        source.classification as OpportunityExtractionSourceClassification,
      ) ||
      !extractionStatuses.includes(source.status as OpportunityExtractionSourceStatus) ||
      typeof source.mediaType !== "string" ||
      source.mediaType.trim() === "" ||
      source.mediaType.length > opportunityBriefMaximumTextLength ||
      typeof source.checksum !== "string" ||
      !checksumPattern.test(source.checksum) ||
      typeof source.text !== "string" ||
      source.text.length === 0
    ) {
      throw new Error("The extraction source material is invalid.");
    }
    sourceIds.add(source.id);
    sources.push({
      id: source.id,
      classification: source.classification as OpportunityExtractionSourceClassification,
      status: source.status as OpportunityExtractionSourceStatus,
      mediaType: source.mediaType.trim(),
      checksum: source.checksum,
      text: source.text,
    });
  }

  return Object.freeze({
    operationId: request.operationId,
    sources: Object.freeze(sources.map((source) => Object.freeze(source))),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  });
}

function assertCitations(
  proposal: OpportunityExtractionProposal,
  sourceIds: ReadonlySet<string>,
): void {
  const assertSourceIds = (citedSourceIds: readonly string[]): void => {
    if (citedSourceIds.some((sourceId) => !sourceIds.has(sourceId))) {
      throw new Error("The extraction proposal cites an unavailable source.");
    }
  };
  if (proposal.role !== null) assertSourceIds(proposal.role.sourceIds);
  if (proposal.employer !== null) assertSourceIds(proposal.employer.sourceIds);
  for (const responsibility of proposal.responsibilities) {
    assertSourceIds(responsibility.sourceIds);
  }
  for (const requirement of proposal.requirements) {
    assertSourceIds(requirement.sourceIds);
  }
  for (const priority of proposal.priorities) {
    assertSourceIds(priority.sourceIds);
  }
  for (const contradiction of proposal.contradictions) {
    assertSourceIds(contradiction.sourceIds);
  }
}

function mapSourcedText(
  value: OpportunityExtractionProposal["role"],
): OpportunityBriefSourcedText | null {
  return value === null ? null : { value: value.value, sourceIds: [...value.sourceIds] };
}

function mapResponsibilities(
  values: OpportunityExtractionProposal["responsibilities"],
): readonly OpportunityBriefResponsibility[] {
  const seen = new Set<string>();
  const responsibilities: OpportunityBriefResponsibility[] = [];
  for (const value of values) {
    const key = semanticKey("responsibility", value.text, value.sourceIds);
    if (seen.has(key)) continue;
    seen.add(key);
    responsibilities.push({
      id: generatedEntryId("responsibility", value.text, value.sourceIds),
      text: value.text,
      sourceIds: [...value.sourceIds],
    });
  }
  return responsibilities;
}

function mapRequirements(
  values: OpportunityExtractionProposal["requirements"],
): readonly OpportunityBriefRequirement[] {
  const seen = new Set<string>();
  const requirements: OpportunityBriefRequirement[] = [];
  for (const value of values) {
    const key = semanticKey("requirement", value.text, value.sourceIds, value.priority);
    if (seen.has(key)) continue;
    seen.add(key);
    requirements.push({
      id: generatedEntryId("requirement", value.text, value.sourceIds, value.priority),
      text: value.text,
      priority: value.priority,
      sourceIds: [...value.sourceIds],
    });
  }
  return requirements;
}

function mapPriorities(
  values: OpportunityExtractionProposal["priorities"],
): readonly OpportunityBriefPriority[] {
  const seen = new Set<string>();
  const priorities: OpportunityBriefPriority[] = [];
  for (const value of values) {
    const key = semanticKey("priority", value.text, value.sourceIds);
    if (seen.has(key)) continue;
    seen.add(key);
    priorities.push({
      id: generatedEntryId("priority", value.text, value.sourceIds),
      text: value.text,
      sourceIds: [...value.sourceIds],
    });
  }
  return priorities;
}

const contradictionMessages: Readonly<
  Record<OpportunityExtractionProposal["contradictions"][number]["field"], string>
> = {
  role: "Extracted role evidence contains a contradiction.",
  employer: "Extracted employer evidence contains a contradiction.",
  responsibilities: "Extracted responsibility evidence contains a contradiction.",
  requirements: "Extracted requirement evidence contains a contradiction.",
  priorities: "Extracted priority evidence contains a contradiction.",
};

function mapContradictions(
  values: OpportunityExtractionProposal["contradictions"],
  operationId: string,
): readonly OpportunityBriefIssue[] {
  const seen = new Set<string>();
  const issues: OpportunityBriefIssue[] = [];
  for (const value of values) {
    const key = semanticKey(value.field, value.field, value.sourceIds);
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push({
      id: extractionIssueId(`contradiction-${value.field}`, operationId, value.sourceIds),
      code: "contradiction",
      status: "open",
      severity: "warning",
      message: contradictionMessages[value.field],
      sourceIds: [...value.sourceIds],
    });
  }
  return issues;
}

function mapProposal(
  proposal: OpportunityExtractionProposal,
  operationId: string,
): OpportunityExtractionResult {
  return cloneAndFreeze({
    role: mapSourcedText(proposal.role),
    employer: mapSourcedText(proposal.employer),
    responsibilities: mapResponsibilities(proposal.responsibilities),
    requirements: mapRequirements(proposal.requirements),
    priorities: mapPriorities(proposal.priorities),
    issues: mapContradictions(proposal.contradictions, operationId),
  });
}

/** Process one provider proposal into application-owned, metadata-only facts. */
export async function processOpportunityExtraction(
  port: OpportunityExtractionPort,
  request: OpportunityExtractionRequest,
): Promise<OpportunityExtractionResult> {
  try {
    const validatedRequest = validateRequest(request);
    const proposal = opportunityExtractionProposalSchema.parse(
      await port.extract(validatedRequest),
    );
    assertCitations(proposal, new Set(validatedRequest.sources.map((source) => source.id)));
    return mapProposal(proposal, validatedRequest.operationId);
  } catch {
    const operationId =
      isRecord(request) && typeof request.operationId === "string"
        ? request.operationId
        : "extraction";
    const sources =
      isRecord(request) && Array.isArray(request.sources)
        ? (request.sources as readonly OpportunityExtractionSource[])
        : [];
    return extractionFailure(operationId, sources);
  }
}

/** Create a frozen processor when a caller prefers an object boundary. */
export function createOpportunityExtractionProcessor(
  port: OpportunityExtractionPort,
): OpportunityExtractionProcessor {
  const extract = (request: OpportunityExtractionRequest): Promise<OpportunityExtractionResult> =>
    processOpportunityExtraction(port, request);
  return Object.freeze({ extract });
}
