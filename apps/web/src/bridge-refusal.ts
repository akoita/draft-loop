import type { BridgeErrorCode } from "@draft-loop/ui/bridge";

/** A refusal the bridge makes itself, before any request, in words for the owner. */
export class Refusal extends Error {
  constructor(
    readonly code: BridgeErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const refuse = (message: string): never => {
  throw new Refusal("operation-failed", message);
};
