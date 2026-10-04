import { describe, expect, it } from "vitest";

import { isKnowledgeOperationCancelled } from "./knowledge-cancel.js";
import { DesktopBridgeError } from "./native.js";

describe("knowledge dialog cancellation", () => {
  it("treats a dismissed store dialog as a choice, not a failure", () => {
    for (const message of [
      "Candidate knowledge store opening was cancelled.",
      "Candidate knowledge store creation was cancelled.",
      "Candidate knowledge file intake was cancelled.",
    ]) {
      expect(
        isKnowledgeOperationCancelled(new DesktopBridgeError("permission-denied", message)),
      ).toBe(true);
    }
  });

  it("keeps every other failure visible", () => {
    expect(
      isKnowledgeOperationCancelled(
        new DesktopBridgeError(
          "permission-denied",
          "The requested candidate knowledge base is archived.",
        ),
      ),
    ).toBe(false);
    expect(
      isKnowledgeOperationCancelled(
        new DesktopBridgeError(
          "operation-failed",
          "Candidate knowledge store opening was cancelled.",
        ),
      ),
    ).toBe(false);
    expect(isKnowledgeOperationCancelled(new Error("boom"))).toBe(false);
    expect(isKnowledgeOperationCancelled(undefined)).toBe(false);
    expect(isKnowledgeOperationCancelled("cancelled")).toBe(false);
  });
});
