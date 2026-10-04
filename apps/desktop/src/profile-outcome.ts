import {
  type CanonicalCandidateProfileFactResult,
  type CanonicalCandidateProfileIssueResult,
  type CanonicalCandidateProfileRecordResult,
  canonicalCandidateProfileGenerationCancelledMessage,
} from "./bridge.js";

const absoluteUrlPattern = /\b(?:https?|ftp):\/\/[^\s<>"']+/iu;
const genericProfileOperationFailure =
  "The canonical candidate profile operation could not be completed.";
const historicalMalformedStreamFailure =
  "DeepInfra returned a malformed GLM stream. Check provider/model compatibility and update DraftLoop to the latest supported version; no facts were saved.";
const safeMalformedStreamFailure =
  "DeepInfra returned a malformed GLM stream. Check provider or model compatibility and update DraftLoop; no facts were saved.";

export type CanonicalCandidateProfileOutcomeKind =
  | "unloaded"
  | "no-version"
  | "extraction-failure"
  | "empty"
  | "blocked"
  | "draft-review"
  | "reviewed";

export interface CanonicalCandidateProfileOutcome {
  readonly kind: CanonicalCandidateProfileOutcomeKind;
  readonly message: string;
  readonly failureReasons: readonly string[];
  readonly retry: boolean;
}

const noVersionOutcome: CanonicalCandidateProfileOutcome = {
  kind: "no-version",
  message: "No saved profile version exists for this name yet.",
  failureReasons: [],
  retry: false,
};

const unloadedOutcome: CanonicalCandidateProfileOutcome = {
  kind: "unloaded",
  message: "Enter a profile name and load a saved version to see its status.",
  failureReasons: [],
  retry: false,
};

/** A cancelled generation is a user decision, not a failure, so it keeps its own message. */
export function isCanonicalCandidateProfileGenerationCancelled(reason: unknown): boolean {
  return (
    reason instanceof Error &&
    reason.message.trim() === canonicalCandidateProfileGenerationCancelledMessage
  );
}

/** Keep provider and saved issue text path-free and bounded before showing it in the renderer. */
export function safeCanonicalCandidateProfileFeedback(reason: unknown): string {
  const rawMessage =
    typeof reason === "string"
      ? reason.trim()
      : reason instanceof Error
        ? reason.message.trim()
        : "";
  const message =
    rawMessage === historicalMalformedStreamFailure ? safeMalformedStreamFailure : rawMessage;
  if (
    message === "" ||
    message.length > 240 ||
    message.includes("/") ||
    message.includes("\\") ||
    absoluteUrlPattern.test(message)
  ) {
    return genericProfileOperationFailure;
  }
  return message;
}

function hasOpenIssues(issues: readonly CanonicalCandidateProfileIssueResult[]): boolean {
  return issues.some((issue) => issue.status === "open");
}

function recordedExtractionFailure(record: CanonicalCandidateProfileRecordResult): boolean {
  return (
    record.facts.length === 0 &&
    record.issues.some((issue) => issue.code === "omission" && issue.severity === "error")
  );
}

function safeFailureReasons(
  issues: readonly CanonicalCandidateProfileIssueResult[],
): readonly string[] {
  const reasons = new Set<string>();
  for (const issue of issues) {
    reasons.add(safeCanonicalCandidateProfileFeedback(issue.message));
    if (reasons.size === 3) break;
  }
  return [...reasons];
}

/** Project only the current loaded record; a previous name's result is never attached to a new one. */
export function projectCanonicalCandidateProfileOutcome(
  record: CanonicalCandidateProfileRecordResult | null,
  currentProfileId: string,
  loadedProfileId: string | null,
  draftFacts: readonly CanonicalCandidateProfileFactResult[] = record?.facts ?? [],
  draftIssues: readonly CanonicalCandidateProfileIssueResult[] = record?.issues ?? [],
): CanonicalCandidateProfileOutcome {
  if (currentProfileId === "" || loadedProfileId !== currentProfileId) {
    return unloadedOutcome;
  }

  if (record === null) {
    return noVersionOutcome;
  }

  if (record.profileId !== currentProfileId || record.profileId !== loadedProfileId) {
    return unloadedOutcome;
  }

  if (recordedExtractionFailure(record)) {
    return {
      kind: "extraction-failure",
      message: "Profile generation saved no facts. Review the recorded cause before retrying.",
      failureReasons: safeFailureReasons(record.issues),
      retry: true,
    };
  }

  if (record.facts.length === 0 || draftFacts.length === 0) {
    return {
      kind: "empty",
      message:
        "This profile version has no facts to review. Check the selected source material before retrying.",
      failureReasons: safeFailureReasons(record.issues),
      retry: record.facts.length === 0,
    };
  }

  if (
    record.status === "reviewed" &&
    !hasOpenIssues(record.issues) &&
    !hasOpenIssues(draftIssues)
  ) {
    return {
      kind: "reviewed",
      message: `Reviewed profile version ${record.version} is loaded and selected.`,
      failureReasons: [],
      retry: false,
    };
  }

  if (hasOpenIssues(record.issues) || hasOpenIssues(draftIssues)) {
    return {
      kind: "blocked",
      message: "Resolve or acknowledge draft issues and save the issue decisions before review.",
      failureReasons: [],
      retry: false,
    };
  }

  return {
    kind: "draft-review",
    message: `Draft profile version ${record.version} is saved and requires human review.`,
    failureReasons: [],
    retry: false,
  };
}

/** Completion status must be projected from the record returned by the operation itself. */
export function projectCanonicalCandidateProfileOperationResult(
  record: CanonicalCandidateProfileRecordResult | null,
): CanonicalCandidateProfileOutcome {
  if (record === null) return noVersionOutcome;
  return projectCanonicalCandidateProfileOutcome(record, record.profileId, record.profileId);
}

export function canSelectReviewedCanonicalCandidateProfile(
  record: CanonicalCandidateProfileRecordResult | null,
): boolean {
  return (
    record !== null &&
    record.status === "reviewed" &&
    record.facts.length > 0 &&
    !hasOpenIssues(record.issues)
  );
}

/** Empty records and open issues must not cross the review boundary, even if a fixture is malformed. */
export function canReviewCanonicalCandidateProfile(
  record: CanonicalCandidateProfileRecordResult | null,
  draftFacts: readonly CanonicalCandidateProfileFactResult[],
  draftIssues: readonly CanonicalCandidateProfileIssueResult[],
): boolean {
  return (
    record !== null &&
    record.status === "draft" &&
    record.facts.length > 0 &&
    draftFacts.length > 0 &&
    !hasOpenIssues(record.issues) &&
    !hasOpenIssues(draftIssues)
  );
}
