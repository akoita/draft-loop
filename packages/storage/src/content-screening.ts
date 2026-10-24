import {
  type ContentScreeningResult,
  contentScreeningResultSchema,
} from "@draft-loop/schemas/content-screening";

/**
 * Stored screening results and quarantine (ADR 0011, phase 2d). Untrusted text is screened for
 * prompt injection before any model reads it (`@draft-loop/schemas/content-screening`); this port
 * keeps each result against the thing it covers and derives from the results which of those things
 * are quarantined. It holds only the port, its records, its input rules and its errors; storage
 * implements it, within one tenant that storage sets before every statement.
 *
 * - A result is content-free: closed signal codes and screener identity, never a quote of the text.
 * - Results are append-only. A subject's latest result decides its status, so a re-screen replaces
 *   the verdict without losing the earlier ones.
 * - A subject is quarantined while its latest result is `flagged` or `unscreened` and no release
 *   covers that result. A newer `clear` result lifts the quarantine, and a newer flagged or
 *   unscreened result after a release quarantines the subject again.
 * - A release is a member's decision to let one result's text through. It covers that result only,
 *   carries a short member-written reason that is never candidate material, and is audited.
 */

/**
 * A pasted job source of an opportunity brief. `workspaceId` is the history workspace id the
 * brief's storage addresses (not the API's record id), `briefId` the brief's id, and `sourceId`
 * the source's id within the brief, which is stable across the brief's versions. The brief need
 * not be saved yet: text is screened before it becomes a brief.
 */
export interface JobSourceScreeningSubject {
  readonly kind: "job-source";
  readonly workspaceId: string;
  readonly briefId: string;
  readonly sourceId: string;
}

/** One uploaded version of a candidate knowledge source; the base, source and version must exist. */
export interface KnowledgeSourceVersionScreeningSubject {
  readonly kind: "knowledge-source-version";
  readonly knowledgeBaseId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
}

export type ContentScreeningSubject =
  | JobSourceScreeningSubject
  | KnowledgeSourceVersionScreeningSubject;

/** One stored result with the subject it covers. */
export interface StoredContentScreeningResult {
  readonly id: string;
  readonly subject: ContentScreeningSubject;
  readonly result: ContentScreeningResult;
  readonly recordedAt: string;
}

/** A member's decision to let one result's text through despite its verdict. */
export interface ContentScreeningRelease {
  readonly resultId: string;
  readonly memberId: string;
  readonly reason: string;
  readonly releasedAt: string;
}

/** A subject's latest result, whether it is quarantined and the release that covers it, if any. */
export interface ContentScreeningStatus extends StoredContentScreeningResult {
  readonly quarantined: boolean;
  readonly release?: ContentScreeningRelease;
}

export interface ContentScreeningReleaseInput {
  /** The result to release; it must be its subject's latest and flagged or unscreened. */
  readonly resultId: string;
  readonly memberId: string;
  /** Why the member lets the text through: a short note of 1 to 500 characters. */
  readonly reason: string;
  /**
   * The history workspace id whose audit chain records the release, which is the record's. For a
   * job source it must be the subject's own workspace.
   */
  readonly historyId: string;
}

export interface ContentScreeningStore {
  /** Appends a result for the subject, validated against the content-screening schema. */
  recordResult(
    subject: ContentScreeningSubject,
    result: ContentScreeningResult,
  ): Promise<StoredContentScreeningResult>;
  /** The subject's latest result and status, or undefined when it was never screened. */
  latestFor(subject: ContentScreeningSubject): Promise<ContentScreeningStatus | undefined>;
  /**
   * One stored result by id, latest or not, so an adapter can check whose it is before it
   * releases it. Undefined when the tenant has no result with that id.
   */
  resultById(resultId: string): Promise<StoredContentScreeningResult | undefined>;
  /**
   * The subjects among those given that are quarantined, with their latest result, in a stable
   * order. At most `maximumScreeningSubjectsPerQuery` subjects are asked about at once.
   */
  quarantined(
    subjects: readonly ContentScreeningSubject[],
  ): Promise<readonly ContentScreeningStatus[]>;
  /**
   * Releases a quarantined result and appends a content-free `content-screening.released` audit
   * event with the result id and member id. Releasing a result again returns its release without
   * a second event. A result that is not its subject's latest is refused as superseded, and a
   * clear one is not releasable.
   */
  release(input: ContentScreeningReleaseInput): Promise<ContentScreeningRelease>;
  /** The latest status of every job source screened in the workspace, in a stable order. */
  listForRecord(workspaceId: string): Promise<readonly ContentScreeningStatus[]>;
  /** The latest status of every source version screened in the knowledge base, in a stable order. */
  listForKnowledgeBase(knowledgeBaseId: string): Promise<readonly ContentScreeningStatus[]>;
}

export type ContentScreeningStoreErrorCode =
  /** An id, a reason or a result does not satisfy the port's rules. */
  | "invalid_input"
  /** The subject names a knowledge base, source or version the tenant does not have. */
  | "subject_not_found"
  /** The tenant has no result with that id. */
  | "result_not_found"
  /** A newer result exists for the subject, so releasing this one would not lift anything. */
  | "result_superseded"
  /** The result is clear, so there is nothing to release. */
  | "not_releasable";

/**
 * Why the port refused. Its message is safe to show, and its code lets an adapter choose the
 * answer, such as 400, 404 or 409.
 */
export class ContentScreeningStoreError extends Error {
  readonly code: ContentScreeningStoreErrorCode;

  constructor(code: ContentScreeningStoreErrorCode, message: string) {
    super(message);
    this.name = "ContentScreeningStoreError";
    this.code = code;
  }
}

export const maximumScreeningReleaseReasonLength = 500;
export const maximumScreeningSubjectsPerQuery = 500;
const maximumIdLength = 256;
const memberIdPattern = /^[^\s]{1,128}$/u;

function invalid(message: string): ContentScreeningStoreError {
  return new ContentScreeningStoreError("invalid_input", message);
}

function requireId(value: string, label: string): string {
  if (value.length === 0 || value.length > maximumIdLength || value.trim() !== value) {
    throw invalid(`Invalid ${label}.`);
  }
  return value;
}

/** The subject with every id checked, as a fresh object. */
export function requireScreeningSubject(subject: ContentScreeningSubject): ContentScreeningSubject {
  if (subject.kind === "job-source") {
    return {
      kind: "job-source",
      workspaceId: requireId(subject.workspaceId, "workspace id"),
      briefId: requireId(subject.briefId, "brief id"),
      sourceId: requireId(subject.sourceId, "job source id"),
    };
  }
  if (subject.kind === "knowledge-source-version") {
    return {
      kind: "knowledge-source-version",
      knowledgeBaseId: requireId(subject.knowledgeBaseId, "knowledge base id"),
      sourceId: requireId(subject.sourceId, "source id"),
      sourceVersionId: requireId(subject.sourceVersionId, "source version id"),
    };
  }
  throw invalid("Invalid screening subject.");
}

export function requireScreeningWorkspaceId(workspaceId: string): string {
  return requireId(workspaceId, "workspace id");
}

export function requireScreeningKnowledgeBaseId(knowledgeBaseId: string): string {
  return requireId(knowledgeBaseId, "knowledge base id");
}

export function requireScreeningResultId(resultId: string): string {
  if (resultId.length === 0 || resultId.length > 128 || resultId.trim() !== resultId) {
    throw invalid("Invalid result id.");
  }
  return resultId;
}

/** Parses a result with the content-screening schema; anything else is refused. */
export function requireScreeningResult(result: ContentScreeningResult): ContentScreeningResult {
  const parsed = contentScreeningResultSchema.safeParse(result);
  if (!parsed.success) throw invalid("The screening result does not satisfy its schema.");
  return parsed.data;
}

export function requireScreeningRelease(
  input: ContentScreeningReleaseInput,
): ContentScreeningReleaseInput {
  const reason = input.reason.trim();
  if (reason.length === 0 || reason.length > maximumScreeningReleaseReasonLength) {
    throw invalid(`A release reason is 1 to ${maximumScreeningReleaseReasonLength} characters.`);
  }
  if (!memberIdPattern.test(input.memberId)) throw invalid("Invalid releasing member.");
  return {
    resultId: requireScreeningResultId(input.resultId),
    memberId: input.memberId,
    reason,
    historyId: requireId(input.historyId, "history workspace id"),
  };
}

/**
 * Whether a subject is quarantined: its latest result is flagged or unscreened and no release
 * covers that result.
 */
export function isScreeningQuarantined(
  verdict: ContentScreeningResult["verdict"],
  released: boolean,
): boolean {
  return verdict !== "clear" && !released;
}
