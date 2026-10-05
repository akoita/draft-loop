import { JobRequirementUserError, SourceIngestionUserError } from "@draft-loop/application";

import type { BridgeCommand, BridgeErrorCode } from "../bridge.js";
import type { ReviewAction } from "../model.js";
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
};

const capabilityGroupLabels: Readonly<Record<string, string>> = {
  workspace: "The workspace action",
  knowledge: "The candidate knowledge action",
  opportunity: "The opportunity action",
  profile: "The candidate profile action",
  credential: "The API key action",
  "provider-auth": "The provider sign-in action",
  models: "The model action",
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
  if (startsRun(command) && error instanceof JobRequirementUserError) return error.message;
  if (command.type === "profile.derive") {
    const message = userFixableProfileDerivationMessage(error);
    if (message !== undefined) return message;
  }
  if (hasBridgeErrorCode(error)) return undefined;
  return `${describeDesktopOperation(command)} failed with an unexpected error.`;
}
