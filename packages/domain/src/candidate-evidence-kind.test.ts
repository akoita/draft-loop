import { describe, expect, it } from "vitest";
import { candidateEvidenceKinds, isCandidateEvidenceKind } from "./candidate-evidence-kind.js";

describe("isCandidateEvidenceKind", () => {
  it("accepts every declared kind", () => {
    for (const kind of candidateEvidenceKinds) {
      expect(isCandidateEvidenceKind(kind)).toBe(true);
    }
  });

  it("rejects unknown and non-string values", () => {
    for (const value of ["file", "CV", "", undefined, null, 3, {}]) {
      expect(isCandidateEvidenceKind(value)).toBe(false);
    }
  });
});
