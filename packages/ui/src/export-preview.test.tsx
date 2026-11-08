import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExportPreviewDialog, previewPageFit } from "./export-preview.js";
import { exportTemplatePageTargets, exportTemplates } from "./export-template.js";
import { HostPanelsContext } from "./host-panels.js";
import { createFixtureReviewState } from "./model.js";
import { ReviewWorkspace } from "./review.js";
import { ReviewFooter, type ReviewFooterProps } from "./review-footer.js";

const noop = () => undefined;
const load = async () => new Blob(["%PDF-"], { type: "application/pdf" });

describe("export preview dialog", () => {
  it("opens on the chosen template and format, drawing, with nothing saved until export", () => {
    const html = renderToStaticMarkup(
      <ExportPreviewDialog
        workspaceId="workspace-1"
        runId="run-1"
        format="pdf"
        template="compact"
        onFormatChange={noop}
        onTemplateChange={noop}
        load={load}
        onExport={noop}
        exportDisabled={false}
        onClose={noop}
      />,
    );

    expect(html).toContain(
      'role="dialog" aria-modal="true" aria-labelledby="export-preview-title"',
    );
    expect(html).toContain('checked="" value="compact"');
    expect(html).toMatch(/<option value="pdf" selected="">PDF<\/option>/u);
    expect(html).toContain("Drawing the preview…");
    expect(html).toContain("Nothing is saved until you export.");
    expect(html).toMatch(/type="button">Export this file…<\/button>/u);
    expect(html).toContain('aria-label="Close the preview"');
  });

  it("keeps Export this file disabled while another action is pending", () => {
    const html = renderToStaticMarkup(
      <ExportPreviewDialog
        workspaceId="workspace-1"
        runId="run-1"
        format="markdown"
        template="modern"
        onFormatChange={noop}
        onTemplateChange={noop}
        load={load}
        onExport={noop}
        exportDisabled
        onClose={noop}
      />,
    );

    expect(html).toMatch(/disabled="">Export this file…<\/button>/u);
  });

  it("says how the pages fit the template's target", () => {
    expect(previewPageFit(2, "modern")).toEqual({
      text: "2 pages · Modern aims for 2",
      over: false,
    });
    expect(previewPageFit(1, "compact")).toEqual({
      text: "1 page · Compact aims for 1",
      over: false,
    });
    expect(previewPageFit(2, "compact")).toEqual({
      text: "2 pages · Compact aims for 1",
      over: true,
    });
  });

  it("names a page target for every template", () => {
    for (const template of exportTemplates) {
      expect(exportTemplatePageTargets[template]).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("Preview button", () => {
  const exportAction: ReviewFooterProps["exportAction"] = {
    disabled: false,
    pathLabel: "Available now",
    again: false,
    pendingSeconds: null,
    format: "pdf",
    onFormatChange: noop,
    template: "modern",
    onTemplateChange: noop,
    note: null,
    onExport: noop,
  };

  it("shows beside Export only when the host can preview", () => {
    const state = {
      ...createFixtureReviewState(),
      state: "approved" as const,
      approval: "approved" as const,
    };
    const withHost = renderToStaticMarkup(
      <HostPanelsContext.Provider value={{ exportPreview: load }}>
        <ReviewWorkspace state={state} onAction={noop} />
      </HostPanelsContext.Provider>,
    );
    const withoutHost = renderToStaticMarkup(<ReviewWorkspace state={state} onAction={noop} />);

    expect(withHost).toMatch(/aria-keyshortcuts="Alt\+P"/u);
    expect(withoutHost).not.toMatch(/aria-keyshortcuts="Alt\+P"/u);
  });

  it("is disabled with Export", () => {
    const footer = (disabled: boolean) =>
      renderToStaticMarkup(
        <ReviewFooter
          {...({
            blocker: { kind: "approved", text: "Approved · ready to export", tone: "safe" },
          } as unknown as ReviewFooterProps)}
          readOnly={false}
          errorMessage={null}
          statusLine=""
          detail={null}
          conditions={[]}
          editNote={null}
          detailsOpen={false}
          onDetailsOpenChange={noop}
          recovery={null}
          approve={{ disabled: true, onApprove: noop }}
          override={null}
          revision={{ disabled: true, onRequest: noop, direction: "", onDirectionChange: noop }}
          exportAction={{ ...exportAction, disabled, onPreview: noop }}
        />,
      );

    expect(footer(false)).toMatch(/aria-keyshortcuts="Alt\+P" title="[^"]*">Preview<kbd>/u);
    expect(footer(true)).toMatch(/aria-keyshortcuts="Alt\+P" title="[^"]*" disabled="">Preview/u);
  });
});
