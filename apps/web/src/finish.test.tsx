import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FinishPanel, type FinishPanelProps } from "./finish.js";
import { syntheticReview } from "./test-fixtures.js";

const props: FinishPanelProps = {
  review: syntheticReview,
  exports: [],
  busy: false,
  onApprove: () => {},
  onRevise: () => {},
  onExport: () => {},
  onDownload: () => {},
};

const approved = { ...syntheticReview, run: { ...syntheticReview.run, state: "approved" } };

describe("approve and export screen", () => {
  it("asks for a reason to approve past open checks, and offers another round", () => {
    const html = renderToStaticMarkup(<FinishPanel {...props} />);

    expect(html).toContain("Why approve with the open checks (required)");
    expect(html).toContain("Approve this draft");
    expect(html).toContain("Ask for another round");
  });

  it("makes the note optional when the draft is ready", () => {
    const html = renderToStaticMarkup(
      <FinishPanel
        {...props}
        review={{
          ...syntheticReview,
          readiness: null,
          approvalCheck: { applicationReady: true, blockers: [] },
        }}
      />,
    );

    expect(html).toContain("Note for the record (optional)");
  });

  it("exports an approved draft as DOCX with Modern by default, and lists downloads", () => {
    const html = renderToStaticMarkup(
      <FinishPanel
        {...props}
        review={approved}
        exports={[
          {
            id: "export-1",
            runId: "run-1",
            format: "pdf",
            mimeType: "application/pdf",
            createdAt: "2026-10-23T02:00:00.000Z",
            checksum: "0".repeat(64),
            sizeBytes: 81_000,
            templateId: "modern",
          },
        ]}
      />,
    );

    expect(html).toContain('<option value="docx" selected="">Word (DOCX)</option>');
    expect(html).toContain('<option value="modern" selected="">Modern</option>');
    expect(html).toContain("PDF · modern · 79 KB · 2026-10-23 02:00 UTC");
    expect(html).toContain("Download");
    expect(html).not.toContain("Approve this draft");
  });

  it("shows nothing while the run is still drafting", () => {
    const html = renderToStaticMarkup(
      <FinishPanel
        {...props}
        review={{ ...syntheticReview, run: { ...syntheticReview.run, state: "revising" } }}
      />,
    );

    expect(html).toBe("");
  });
});
