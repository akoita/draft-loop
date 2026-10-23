import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReviewPanel, type ReviewPanelProps } from "./review.js";
import { syntheticReview } from "./test-fixtures.js";

const props: ReviewPanelProps = {
  review: syntheticReview,
  busy: false,
  messages: [],
  onDecide: async () => true,
  onEdit: async () => true,
};

describe("review screen", () => {
  it("shows the draft with each claim's evidence", () => {
    const html = renderToStaticMarkup(<ReviewPanel {...props} />);

    expect(html).toContain("<h3>Experience</h3>");
    expect(html).toContain("Built TypeScript services for Example Ledger&#x27;s billing platform.");
    expect(html).toContain("<summary>Evidence for 1 claim</summary>");
    expect(html).toContain(
      "<blockquote>Built TypeScript services with deterministic testing.</blockquote>",
    );
    expect(html).toContain("career.md, Experience, line 4");
    expect(html).toContain(" · edited by you");
  });

  it("shows findings by section with their decisions, and the general ones apart", () => {
    const html = renderToStaticMarkup(<ReviewPanel {...props} />);

    expect(html).toContain("1 finding(s) to decide");
    expect(html).toContain("Say what the services changed for the billing team.");
    expect(html).toContain("Findings about the whole CV");
    expect(html).toContain("Requirement: Postgres");
    expect(html).toContain("Decision: Accepted");
    expect(html).toContain('title="keep the draft as is, with a reason"');
  });

  it("shows readiness, the independent review and what blocks approval", () => {
    const html = renderToStaticMarkup(<ReviewPanel {...props} />);

    expect(html).toContain("Author anthropic, critic openai");
    expect(html).toContain("Not ready · coverage 75% (needs 80%)");
    expect(html).toContain("<li>One error finding is not resolved.</li>");
  });

  it("takes no decision or edit once the run moved on", () => {
    const html = renderToStaticMarkup(
      <ReviewPanel
        {...props}
        review={{ ...syntheticReview, run: { ...syntheticReview.run, state: "approved" } }}
      />,
    );

    expect(html).toContain("the run no longer takes decisions or edits");
    expect(html).not.toContain("Decide later");
    expect(html).not.toContain(">Edit</button>");
  });

  it("waits for a draft", () => {
    const html = renderToStaticMarkup(
      <ReviewPanel {...props} review={{ ...syntheticReview, draft: null }} />,
    );

    expect(html).toContain("The run has no draft yet.");
  });
});
