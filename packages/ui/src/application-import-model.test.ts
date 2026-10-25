import { describe, expect, it } from "vitest";

import {
  applicationImportCountsText,
  applicationImportErrorNotice,
  applicationImportFailureFallback,
  applicationImportSuccessNotice,
} from "./application-import-model.js";

const counts = { runs: 2, briefs: 1, briefVersions: 1, exports: 1, skippedExports: 0 };

describe("application import wording", () => {
  it("counts what was imported with the right plurals", () => {
    expect(applicationImportCountsText(counts)).toBe("Imported 2 runs, 1 brief version, 1 export.");
    expect(applicationImportCountsText({ ...counts, skippedExports: 1 })).toBe(
      "Imported 2 runs, 1 brief version, 1 export. 1 export was not imported because its file was missing.",
    );
    expect(applicationImportCountsText({ ...counts, skippedExports: 2 })).toContain(
      "2 exports were not imported because their files were missing.",
    );
  });

  it("names the imported application in the success notice", () => {
    expect(applicationImportSuccessNotice("Acme", counts)).toEqual({
      kind: "success",
      message: 'Imported "Acme" as an application. Imported 2 runs, 1 brief version, 1 export.',
    });
  });

  it("is silent when the picker was closed and shows a refusal as the host worded it", () => {
    const cancelled = Object.assign(new Error("Choosing a workspace to import was cancelled."), {
      code: "permission-denied",
    });
    expect(applicationImportErrorNotice(cancelled)).toBeNull();
    expect(
      applicationImportErrorNotice(new Error("The selected folder is not a DraftLoop workspace.")),
    ).toEqual({ kind: "error", message: "The selected folder is not a DraftLoop workspace." });
    expect(applicationImportErrorNotice(new Error("This workspace was already imported."))).toEqual(
      { kind: "error", message: "This workspace was already imported." },
    );
  });

  it("falls back to a fixed sentence for an empty or oversized message", () => {
    for (const error of [new Error(""), new Error("x".repeat(400)), "boom", undefined]) {
      expect(applicationImportErrorNotice(error)).toEqual({
        kind: "error",
        message: applicationImportFailureFallback,
      });
    }
  });
});
