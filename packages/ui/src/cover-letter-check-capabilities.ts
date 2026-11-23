/**
 * Check my letter (#3280) from the capability port: a function only when the host offers the
 * command. A host without it (the local-first desktop) shows no check.
 */
import type { BridgeResult, CapabilityPort } from "./bridge.js";
import type { CoverLetterCheckView } from "./cover-letter-check-contract.js";

/** Checks the letter for one application; the host does not keep the text. */
export type CheckCoverLetter = (
  workspaceId: string,
  applicationId: string,
  text: string,
) => Promise<CoverLetterCheckView>;

export function createCoverLetterCheckCapability(
  port: CapabilityPort,
  unwrap: <Value>(result: BridgeResult<Value>) => Value,
): CheckCoverLetter | undefined {
  if (!port.hasCapability("application.check-cover-letter")) return undefined;
  return async (workspaceId, applicationId, text) =>
    unwrap(
      await port.execute({
        type: "application.check-cover-letter",
        input: { workspaceId, applicationId, text },
      }),
    ).check;
}
