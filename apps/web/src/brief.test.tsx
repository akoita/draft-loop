import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BriefEditor, BriefPanel, type BriefPanelProps, PasteJob } from "./brief.js";
import { briefEdit, staleVersionMessage } from "./brief-model.js";
import { syntheticBrief } from "./test-fixtures.js";

const props: BriefPanelProps = {
  brief: syntheticBrief,
  busy: false,
  stale: false,
  messages: [],
  onSave: async () => true,
  onReview: () => {},
  onReload: () => {},
  onPasteAnother: () => {},
};

describe("job brief screen", () => {
  it("asks for the job post first", () => {
    const html = renderToStaticMarkup(<PasteJob busy={false} messages={[]} onSubmit={() => {}} />);

    expect(html).toContain('<label for="job-text">Job post</label>');
    expect(html).toContain("Read the job post");
  });

  it("shows what was read and offers review of a draft", () => {
    const html = renderToStaticMarkup(<BriefPanel {...props} />);

    expect(html).toContain("Version 2 · draft, review it before a run");
    expect(html).toContain("<dd>Platform Engineer</dd>");
    expect(html).toContain(
      '<span class="priority priority-critical">critical</span> TypeScript services',
    );
    expect(html).toContain("Run the billing platform");
    expect(html).toContain("Mark version 2 reviewed");
  });

  it("holds review until the brief has a requirement", () => {
    const html = renderToStaticMarkup(
      <BriefPanel {...props} brief={{ ...syntheticBrief, requirements: [] }} />,
    );

    expect(html).toContain("Add at least one with Edit before marking the brief");
    expect(html).toContain('<button type="button" disabled="">Mark version 2 reviewed</button>');
  });

  it("offers no review once reviewed", () => {
    const html = renderToStaticMarkup(
      <BriefPanel {...props} brief={{ ...syntheticBrief, status: "reviewed" }} />,
    );

    expect(html).toContain("reviewed, ready for a run");
    expect(html).not.toContain("Mark version");
  });

  it("asks to reload after a stale edit", () => {
    const html = renderToStaticMarkup(
      <BriefPanel {...props} stale={true} messages={[staleVersionMessage]} />,
    );

    expect(html).toContain("Reload the brief");
    expect(html).toContain("changed since you opened it");
  });

  it("edits the role, employer and requirements", () => {
    const html = renderToStaticMarkup(
      <BriefEditor
        brief={syntheticBrief}
        edit={briefEdit(syntheticBrief)}
        busy={false}
        messages={[]}
        onChange={() => {}}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(html).toContain('value="Platform Engineer"');
    expect(html).toContain('aria-label="Requirement 1" value="TypeScript services"');
    expect(html).toContain("Saving makes version 3");
  });

  it("shows the screening status under the heading", () => {
    const html = renderToStaticMarkup(
      <BriefPanel {...props} screening={<p>Quarantined: flagged</p>} />,
    );

    expect(html.indexOf("Quarantined: flagged")).toBeGreaterThan(html.indexOf("<h2>Job brief"));
    expect(html.indexOf("Quarantined: flagged")).toBeLessThan(html.indexOf("<dt>Role</dt>"));
  });
});
