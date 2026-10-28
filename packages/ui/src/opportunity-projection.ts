/**
 * The renderer's view of a saved job brief, projected from the record a host's service returns:
 * the desktop's application service, or the hosted API's brief view (ADR 0011, D9). Both hosts
 * run the same projection, so neither can show the screens a field the other leaves out.
 */

import type { OpportunityLatestBrief, OpportunityRecordResult } from "./bridge.js";

/** How a host refuses a record it cannot project; it never returns. */
export type ProjectionFailure = (message: string) => never;

function opportunityRecordObject(
  value: unknown,
  fail: ProjectionFailure,
): {
  readonly brief: Record<string, unknown>;
  readonly checksum: string | null;
  readonly extraction?: "pending" | "failed";
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("The opportunity service returned an invalid record.");
  }
  const record = value as Record<string, unknown>;
  const brief = record.brief;
  if (typeof brief === "object" && brief !== null && !Array.isArray(brief)) {
    return {
      brief: brief as Record<string, unknown>,
      checksum: typeof record.checksum === "string" ? record.checksum : null,
      ...(record.extraction === "pending" || record.extraction === "failed"
        ? { extraction: record.extraction }
        : {}),
    };
  }
  return { brief: record, checksum: null };
}

function opportunitySourcedText(
  value: unknown,
  fail: ProjectionFailure,
): OpportunityRecordResult["role"] {
  if (value === null) return null;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("The opportunity service returned an invalid fact.");
  }
  const fact = value as Record<string, unknown>;
  return { value: fact.value, sourceIds: fact.sourceIds } as OpportunityRecordResult["role"];
}

function opportunitySource(
  value: unknown,
  fail: ProjectionFailure,
): OpportunityRecordResult["sources"][number] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("The opportunity service returned an invalid source.");
  }
  const source = value as Record<string, unknown>;
  const provenance = source.provenance;
  if (typeof provenance !== "object" || provenance === null || Array.isArray(provenance)) {
    return fail("The opportunity service returned an invalid source.");
  }
  const provenanceRecord = provenance as Record<string, unknown>;
  const kind = provenanceRecord.kind;
  const checksum =
    kind === "approved-url" ? provenanceRecord.contentChecksum : provenanceRecord.checksum;
  if (typeof kind !== "string" || typeof source.id !== "string") {
    return fail("The opportunity service returned an invalid source.");
  }
  return {
    id: source.id,
    kind,
    classification: source.classification,
    status: source.status,
    checksum: checksum === null || typeof checksum === "string" ? checksum : null,
    capturedAt: provenanceRecord.capturedAt,
    ...(provenanceRecord.textOrigin === "job-posting-json-ld"
      ? { textOrigin: "job-posting-json-ld" }
      : {}),
  } as OpportunityRecordResult["sources"][number];
}

function opportunityFactCollection<
  Value extends "responsibilities" | "requirements" | "priorities",
>(value: unknown, field: Value, fail: ProjectionFailure): OpportunityRecordResult[Value] {
  if (!Array.isArray(value)) {
    return fail("The opportunity service returned invalid facts.");
  }
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return fail("The opportunity service returned invalid facts.");
    }
    const fact = entry as Record<string, unknown>;
    return {
      id: fact.id,
      text: fact.text,
      sourceIds: fact.sourceIds,
      ...(field === "requirements" ? { priority: fact.priority } : {}),
      ...(field !== "priorities" && fact.excerpt !== undefined ? { excerpt: fact.excerpt } : {}),
    } as OpportunityRecordResult[Value][number];
  }) as OpportunityRecordResult[Value];
}

function opportunityInstructions(
  value: unknown,
  fail: ProjectionFailure,
): OpportunityRecordResult["candidateInstructions"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("The opportunity service returned invalid instructions.");
  }
  const instructions = value as Record<string, unknown>;
  const list = (candidate: unknown): readonly unknown[] => {
    if (!Array.isArray(candidate)) {
      return fail("The opportunity service returned invalid instructions.");
    }
    return candidate;
  };
  return {
    tone: opportunitySourcedText(instructions.tone, fail),
    applicationGoal: opportunitySourcedText(instructions.applicationGoal, fail),
    forbiddenLanguage: list(instructions.forbiddenLanguage).map((entry) =>
      opportunitySourcedText(entry, fail),
    ),
    focusAreas: list(instructions.focusAreas).map((entry) => opportunitySourcedText(entry, fail)),
  } as OpportunityRecordResult["candidateInstructions"];
}

function opportunityIssues(
  value: unknown,
  fail: ProjectionFailure,
): OpportunityRecordResult["issues"] {
  if (!Array.isArray(value)) {
    return fail("The opportunity service returned invalid issues.");
  }
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return fail("The opportunity service returned invalid issues.");
    }
    const issue = entry as Record<string, unknown>;
    return {
      id: issue.id,
      code: issue.code,
      status: issue.status,
      severity: issue.severity,
      message: issue.message,
      sourceIds: issue.sourceIds,
    };
  }) as OpportunityRecordResult["issues"];
}

/**
 * Projects a persisted opportunity record before it reaches the renderer.
 *
 * In particular, URL provenance (originalUrl/finalUrl) and local file
 * paths/display names are intentionally not copied. This projection is kept
 * separate from bridge validation so a future application/storage field cannot
 * accidentally become renderer-visible merely by being added to a brief.
 */
export function projectOpportunityRecord(
  workspaceId: string,
  value: unknown,
  fail: ProjectionFailure,
): OpportunityRecordResult {
  const { brief, checksum, extraction } = opportunityRecordObject(value, fail);
  if (
    typeof brief.id !== "string" ||
    typeof brief.version !== "number" ||
    (brief.priorVersion !== null && typeof brief.priorVersion !== "number") ||
    (brief.reviewedAt !== null && typeof brief.reviewedAt !== "string") ||
    typeof brief.createdAt !== "string" ||
    typeof brief.status !== "string"
  ) {
    return fail("The opportunity service returned an invalid record.");
  }
  const sources = Array.isArray(brief.sources)
    ? brief.sources.map((source) => opportunitySource(source, fail))
    : fail("The opportunity service returned invalid sources.");
  return {
    workspaceId,
    briefId: brief.id,
    version: brief.version,
    priorVersion: brief.priorVersion,
    status: brief.status as OpportunityRecordResult["status"],
    createdAt: brief.createdAt,
    reviewedAt: brief.reviewedAt,
    checksum,
    sources,
    role: opportunitySourcedText(brief.role, fail),
    employer: opportunitySourcedText(brief.employer, fail),
    responsibilities: opportunityFactCollection(brief.responsibilities, "responsibilities", fail),
    requirements: opportunityFactCollection(brief.requirements, "requirements", fail),
    priorities: opportunityFactCollection(brief.priorities, "priorities", fail),
    candidateInstructions: opportunityInstructions(brief.candidateInstructions, fail),
    issues: opportunityIssues(brief.issues, fail),
    ...(extraction === undefined ? {} : { extraction }),
  };
}

/** The brief fields the latest-brief projection reads; text is only compared, never returned. */
interface LatestBriefRecord {
  /** The service's extraction of this version, when a hosted worker still owes it. */
  readonly extraction?: "pending" | "failed";
  readonly brief: {
    readonly id: string;
    readonly version: number;
    readonly status: string;
    readonly requirements: readonly BriefFact[];
    readonly responsibilities?: readonly BriefFact[];
  };
}

/** A requirement or responsibility as the latest-brief projection reads it: id, text, priority. */
interface BriefFact {
  readonly id?: string;
  readonly text?: string;
  readonly priority?: string;
}

function comparableText(text: string | undefined): string | undefined {
  return text?.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

/**
 * How many responsibilities a run checks next to the requirements. A run checks each
 * responsibility like a requirement, except one whose id or text repeats a requirement, which is
 * left to that requirement; this counts them the same way, so setup and coverage agree.
 */
function checkedResponsibilityCount(
  requirements: readonly BriefFact[],
  responsibilities: readonly BriefFact[],
): number {
  const seenIds = new Set(requirements.map(({ id }) => id).filter((id) => id !== undefined));
  const seenTexts = new Set(
    requirements.map(({ text }) => comparableText(text)).filter((text) => text !== undefined),
  );
  let count = 0;
  for (const { id, text } of responsibilities) {
    const comparable = comparableText(text);
    if (
      (id !== undefined && seenIds.has(id)) ||
      (comparable !== undefined && seenTexts.has(comparable))
    ) {
      continue;
    }
    if (id !== undefined) seenIds.add(id);
    if (comparable !== undefined) seenTexts.add(comparable);
    count += 1;
  }
  return count;
}

/**
 * The content-free summary of a workspace's latest brief version: identity, review status,
 * requirement counts and how many responsibilities a run would check beside them. This is what lets setup offer to resume a draft after the app restarts.
 */
export function projectLatestOpportunity(
  workspaceId: string,
  record: LatestBriefRecord,
): OpportunityLatestBrief {
  const { brief } = record;
  return {
    workspaceId,
    briefId: brief.id,
    version: brief.version,
    status: brief.status === "reviewed" ? "reviewed" : "draft",
    requirementCount: brief.requirements.length,
    criticalCount: brief.requirements.filter((requirement) => requirement.priority === "critical")
      .length,
    responsibilityCount: checkedResponsibilityCount(
      brief.requirements,
      brief.responsibilities ?? [],
    ),
    ...(record.extraction === undefined ? {} : { extraction: record.extraction }),
  };
}
