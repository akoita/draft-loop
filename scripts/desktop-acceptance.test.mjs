import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertAcceptanceReport } from "./desktop-acceptance.mjs";

const artifactChecksum = "a".repeat(64);
const completeChecks = Object.freeze({
  installLaunch: true,
  workspaceCreation: true,
  candidateImport: true,
  approvedJobUrl: true,
  provenance: true,
  providerPreflight: true,
  authorCriticRun: true,
  observableProgress: true,
  inFlightCancellation: true,
  revision: true,
  restartResume: true,
  interruptedRunExplanation: true,
  approval: true,
  exportMarkdown: true,
  exportDocx: true,
  exportPdf: true,
  durableHistory: true,
});

describe("installed-app acceptance evidence", () => {
  it("accepts the complete content-free recovery report", () => {
    assert.doesNotThrow(() =>
      assertAcceptanceReport({ artifactChecksum, checks: completeChecks }, artifactChecksum),
    );
  });

  for (const check of [
    "observableProgress",
    "inFlightCancellation",
    "restartResume",
    "interruptedRunExplanation",
  ]) {
    it(`fails closed when ${check} is false or missing`, () => {
      for (const value of [false, undefined]) {
        assert.throws(
          () =>
            assertAcceptanceReport(
              {
                artifactChecksum,
                checks: { ...completeChecks, [check]: value },
              },
              artifactChecksum,
            ),
          new RegExp(`did not pass check ${check}\\.$`, "u"),
        );
      }
    });
  }

  it("rejects missing report structure and a mismatched artifact", () => {
    assert.throws(
      () => assertAcceptanceReport(undefined, artifactChecksum),
      /reported the wrong artifact checksum\.$/u,
    );
    assert.throws(
      () => assertAcceptanceReport({ artifactChecksum: "b".repeat(64) }, artifactChecksum),
      /reported the wrong artifact checksum\.$/u,
    );
  });
});
