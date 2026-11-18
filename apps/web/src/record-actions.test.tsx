import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RecordActionsPanel } from "./record-actions.js";

const panelProps = {
  title: "Download or delete this candidate's data",
  busy: false,
  messages: [],
  onExport: () => {},
  onDelete: () => {},
};

describe("record export and deletion panel", () => {
  it("offers the archive and a delete form that asks for the id and warns it is final", () => {
    const html = renderToStaticMarkup(<RecordActionsPanel {...panelProps} />);

    expect(html).toContain("<summary>Download or delete this candidate&#x27;s data</summary>");
    expect(html).toContain('<button type="button">Download everything</button>');
    expect(html).toContain("It cannot be undone.");
    expect(html).toContain('<label for="delete-record-confirm">Type DELETE to confirm</label>');
    expect(html).toContain(
      '<button type="submit" class="danger">Delete all documents and applications</button>',
    );
    expect(html).toContain("The account stays");
    expect(html).not.toContain("candidate-ana");
    expect(html).not.toContain('role="alert"');
  });

  it("disables both actions while one is under way, and shows refusals", () => {
    const html = renderToStaticMarkup(
      <RecordActionsPanel
        {...panelProps}
        busy={true}
        messages={["Stop the run first. A run on this record is queued or running."]}
      />,
    );

    expect(html).toContain('<button type="button" disabled="">Download everything</button>');
    expect(html).toContain(
      'class="danger" disabled="">Delete all documents and applications</button>',
    );
    expect(html).toContain('role="alert">Stop the run first.');
  });
});
