import { resolve } from "node:path";
import { redactText } from "@draft-loop/security";
import { CliUserError } from "./cli-user-error.js";

export function safeErrorMessage(error: unknown): string {
  if (error instanceof CliUserError) return error.message;
  if (error instanceof Error) {
    const redacted = redactText(error.message).value;
    return redacted.length > 0 && redacted.length <= 240
      ? redacted
      : "The command could not be completed.";
  }
  return "The command could not be completed.";
}

export function workspaceRoot(value: string | undefined): string {
  return resolve(value ?? process.cwd());
}
