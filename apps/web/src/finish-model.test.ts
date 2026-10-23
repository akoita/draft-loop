import { describe, expect, it } from "vitest";

import {
  approvalNeedsRationale,
  approveRequest,
  canExport,
  exportFileName,
  exportRequestBody,
} from "./finish-model.js";
import { syntheticReview } from "./test-fixtures.js";

const ready = {
  ...syntheticReview,
  readiness:
    syntheticReview.readiness === null ? null : { ...syntheticReview.readiness, ready: true },
  approvalCheck: { applicationReady: true, blockers: [] },
};

describe("approval", () => {
  it("needs a reason only past open checks", () => {
    expect(approvalNeedsRationale(syntheticReview)).toBe(true);
    expect(approvalNeedsRationale(ready)).toBe(false);
    expect(approveRequest(syntheticReview, " ")).toEqual({
      problem: "Say why you approve the draft with its open checks.",
    });
    expect(approveRequest(syntheticReview, " Checked by hand ")).toEqual({
      body: { readinessOverrideRationale: "Checked by hand" },
    });
    expect(approveRequest(ready, "")).toEqual({ body: {} });
  });
});

describe("export", () => {
  it("sends the template except for Markdown", () => {
    expect(exportRequestBody("docx", "modern")).toEqual({ format: "docx", templateId: "modern" });
    expect(exportRequestBody("markdown", "modern")).toEqual({ format: "markdown" });
  });

  it("names the downloaded file by day, export and format", () => {
    expect(
      exportFileName({
        id: "export-1",
        runId: "run-1",
        format: "docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        createdAt: "2026-10-23T02:00:00.000Z",
        checksum: "0".repeat(64),
        sizeBytes: 9_000,
      }),
    ).toBe("cv-2026-10-23-export-1.docx");
  });

  it("exports only an approved draft", () => {
    expect(canExport(syntheticReview)).toBe(false);
    expect(
      canExport({ ...syntheticReview, run: { ...syntheticReview.run, state: "approved" } }),
    ).toBe(true);
  });
});
