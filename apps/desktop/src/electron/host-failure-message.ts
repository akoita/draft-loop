import {
  CliUserError,
  canonicalCandidateProfileTimestampErrorMessage,
  EmbeddingModelInstallError,
  JobRequirementUserError,
  OpportunityJobPageUnreadableError,
  OpportunityJobTextGarbledError,
  opportunityBriefVersionStaleErrorMessage,
  SourceIngestionUserError,
} from "@draft-loop/application";

import type { BridgeCommand, BridgeErrorCode } from "@draft-loop/ui/bridge";
import type { ReviewAction } from "@draft-loop/ui/model";
import { opportunityVersionConflictMessage } from "../opportunity-brief-review-model.js";
import { userFixableProfileDerivationMessage } from "./profile-derivation-errors.js";

const bridgeErrorCodes: ReadonlySet<string> = new Set([
  "invalid-command",
  "invalid-input",
  "capability-unavailable",
  "permission-denied",
  "not-found",
  "operation-failed",
] satisfies readonly BridgeErrorCode[]);

const reviewActionLabels: Readonly<Record<ReviewAction["type"], string>> = {
  "finding-decision": "Saving the finding decision",
  "edit-block": "Saving the draft edit",
  pause: "Pausing the review",
  "acknowledge-provider-transmission": "Acknowledging the provider transmission policy",
  start: "Starting the review",
  resume: "Resuming the review",
  "recover-to-review": "Recovering the review",
  "recover-round-limit": "Recovering from the round limit",
  stop: "Stopping the review",
  "request-revision": "Requesting a revision",
  "set-autopilot": "Changing autopilot",
  approve: "Approving the draft",
  export: "Exporting the draft",
};

const capabilityLabels: Readonly<Record<string, string>> = {
  "profile.derive": "Generating the candidate profile",
  "profile.freshness": "Checking the career profile against the career evidence",
  "application.list": "Listing the applications",
  "application.get": "Reading the application",
  "application.job": "Reading the job description",
  "application.create": "Creating the application",
  "application.import": "Importing the workspace as an application",
  "workspace.compact-history": "Compacting the run history",
  "application.archive": "Archiving the application",
  "application.rename": "Renaming the application",
  "application.delete": "Deleting the application",
  "application.set-models": "Choosing the application's models",
  "application.choose-run": "Choosing the run whose draft the application uses",
  "run.status": "Reading the review status",
  "run.start": "Starting the review",
  "run.pause": "Pausing the review",
  "run.resume": "Resuming the review",
  "run.stop": "Stopping the review",
  "review.load": "Loading the review",
  "file.select": "Adding the selected file",
  "source.add-url": "Adding the source URL",
  "export.write": "Exporting the draft",
  "models.list": "Listing provider models",
  "credential.test": "Testing the API key",
  "writing-policy.read": "Reading the writing policy",
  "writing-policy.save": "Saving the writing policy",
  "models.saved-profiles.read": "Reading the saved model profiles",
  "models.saved-profiles.save": "Saving the model profiles",
  "embedding-model.status": "Checking the local search model",
  "embedding-model.plan-install": "Preparing the local search model download",
  "embedding-model.install": "Installing the local search model",
  "embedding-model.progress": "Reading the model download progress",
  "embedding-model.cancel": "Cancelling the model download",
  "embedding-model.remove": "Removing the local search model",
  "workspace.retrieval-mode.get": "Reading the retrieval mode",
  "workspace.retrieval-mode.set": "Saving the retrieval mode",
};

const capabilityGroupLabels: Readonly<Record<string, string>> = {
  workspace: "The workspace action",
  knowledge: "The candidate knowledge action",
  opportunity: "The opportunity action",
  profile: "The candidate profile action",
  credential: "The API key action",
  "provider-auth": "The provider sign-in action",
  models: "The model action",
  "embedding-model": "The local search model action",
};

/** A short, content-free name for what a desktop command was doing. */
export function describeDesktopOperation(command: BridgeCommand): string {
  if (command.type === "review.dispatch") return reviewActionLabels[command.input.action.type];
  const label = capabilityLabels[command.type];
  if (label !== undefined) return label;
  const group = command.type.slice(0, command.type.indexOf("."));
  return capabilityGroupLabels[group] ?? "The desktop action";
}

function startsRun(command: BridgeCommand): boolean {
  return (
    command.type === "run.start" ||
    (command.type === "review.dispatch" && command.input.action.type === "start")
  );
}

function resumesRun(command: BridgeCommand): boolean {
  return (
    command.type === "run.resume" ||
    (command.type === "review.dispatch" && command.input.action.type === "resume")
  );
}

function isExport(command: BridgeCommand): boolean {
  return (
    command.type === "export.write" ||
    (command.type === "review.dispatch" && command.input.action.type === "export")
  );
}

// Some application messages quote a workspace path; one with a path separator is never shown.
const pathSeparator = /[\\/]/u;

function hasBridgeErrorCode(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  try {
    const code: unknown = Reflect.get(error, "code");
    return typeof code === "string" && bridgeErrorCodes.has(code);
  } catch {
    return false;
  }
}

/**
 * The message the renderer shows for a failed host command, or `undefined`
 * when the error already carries a bridge code and message of its own.
 *
 * Only fixed, path-free application messages a person can act on cross the
 * bridge verbatim. Any other unexpected failure names the operation that
 * failed, never the error text, which may hold local paths or source content.
 */
export function hostFailureMessage(command: BridgeCommand, error: unknown): string | undefined {
  if (error instanceof SourceIngestionUserError) return error.message;
  // An unreadable job page fails with a fixed sentence that tells the person to paste the text.
  if (
    command.type === "opportunity.create" &&
    (error instanceof OpportunityJobPageUnreadableError ||
      error instanceof OpportunityJobTextGarbledError)
  ) {
    return error.message;
  }
  if (startsRun(command) && error instanceof JobRequirementUserError) return error.summary;
  // A refused start or resume is worded for a person; a message that quotes a path stays generic.
  if (
    (startsRun(command) || resumesRun(command)) &&
    error instanceof CliUserError &&
    !pathSeparator.test(error.message)
  ) {
    return error.message;
  }
  // A refused export (a failed rendering check) is worded for a person and names no path.
  if (isExport(command) && error instanceof CliUserError && !pathSeparator.test(error.message)) {
    return error.message;
  }
  if (command.type === "profile.derive") {
    const message = userFixableProfileDerivationMessage(error);
    if (message !== undefined) return message;
  }
  // The application words its policy validation (a bad directive value, too
  // many rules, empty or oversized text) for a person and never quotes the
  // text, so the editor can show it as written.
  if (command.type === "writing-policy.save" && error instanceof CliUserError) {
    return error.message;
  }
  // Creating, importing, renaming, archiving, deleting or choosing models for an application fails with a
  // fixed sentence about the name, the pasted job text, the model pair or why it can only be
  // archived; it names no path.
  if (
    (command.type === "application.create" ||
      command.type === "application.import" ||
      command.type === "application.archive" ||
      command.type === "application.rename" ||
      command.type === "application.delete" ||
      command.type === "application.set-models" ||
      command.type === "application.choose-run") &&
    error instanceof CliUserError
  ) {
    return error.message;
  }
  // Compacting names why it stopped (a run is working, the chain did not verify, no space) and
  // never a path, so the settings can show it as written.
  if (
    command.type === "workspace.compact-history" &&
    error instanceof CliUserError &&
    !pathSeparator.test(error.message)
  ) {
    return error.message;
  }
  // Saving or reading the applied profile pair fails with a fixed sentence that names profiles
  // and models but no path, so the dialog can say why the pair was not applied.
  if (
    (command.type === "models.saved-profiles.save" ||
      command.type === "models.saved-profiles.read") &&
    error instanceof CliUserError
  ) {
    return error.message;
  }
  // A model install failure is worded for a person (checksum, size, network, unsupported
  // platform) and never names a local path, so it can be shown as written.
  if (command.type.startsWith("embedding-model.") && error instanceof EmbeddingModelInstallError) {
    return error.message;
  }
  // An evidence-kind refusal names the kind list or a source id, never a path or source text.
  if (
    command.type === "knowledge.source-evidence-kind.set" &&
    error instanceof CliUserError &&
    !pathSeparator.test(error.message)
  ) {
    return error.message;
  }
  // The retrieval-mode file's own validation message names the setting, never a path.
  if (command.type.startsWith("workspace.retrieval-mode.") && error instanceof CliUserError) {
    return error.message;
  }
  // A profile edit or review dated well before its parent version is refused with a fixed sentence.
  if (
    (command.type === "profile.edit" || command.type === "profile.review") &&
    error instanceof Error &&
    error.message === canonicalCandidateProfileTimestampErrorMessage
  ) {
    return error.message;
  }
  // A stale brief version is the one opportunity failure a person can act on: reload and retry.
  if (
    (command.type === "opportunity.edit" || command.type === "opportunity.review") &&
    error instanceof Error &&
    error.message === opportunityBriefVersionStaleErrorMessage
  ) {
    return opportunityVersionConflictMessage;
  }
  if (hasBridgeErrorCode(error)) return undefined;
  return `${describeDesktopOperation(command)} failed with an unexpected error.`;
}

/**
 * The message the review screen shows when a run continuing in the background fails before it
 * records a step of its own. It follows the same rules as a refused resume: a fixed, path-free
 * application message is shown as written, anything else names only the operation.
 */
export function backgroundRunFailureMessage(error: unknown): string {
  const resume: BridgeCommand = {
    type: "review.dispatch",
    input: { workspaceId: "background", runId: "background", action: { type: "resume" } },
  };
  return (
    hostFailureMessage(resume, error) ??
    `${describeDesktopOperation(resume)} failed with an unexpected error.`
  );
}
