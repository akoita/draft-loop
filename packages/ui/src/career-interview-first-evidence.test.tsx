import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CareerInterviewSessionView } from "./career-interview-model.js";
import { CareerInterviewPanel } from "./career-interview-panel.js";

/** Confirming a summary on a record with no knowledge base (#2733). Invented words only. */
const summarised: CareerInterviewSessionView = {
  id: "cis_fixture0001",
  status: "open",
  topics: [
    {
      key: "career-start:work-history",
      kind: "career-start",
      reason: "Your record has no work history yet.",
      title: "work history",
      status: "summarised",
      turns: [],
      summary: "I planned delivery routes from 2021.",
    },
  ],
};

function render(createsFirstBase: boolean): string {
  return renderToStaticMarkup(
    <CareerInterviewPanel
      session={summarised}
      proposal={undefined}
      knowledgeBases={[]}
      createsFirstBase={createsFirstBase}
      onStart={async () => undefined}
      onAction={async () => undefined}
      loadConflicts={async () => []}
    />,
  );
}

describe("confirming an interview summary with no knowledge base", () => {
  it("lets the person confirm and says it becomes their first career evidence", () => {
    const html = render(true);
    expect(html).toContain("This becomes your first career evidence.");
    expect(html).not.toContain("Save to");
    expect(html).toMatch(
      /<button type="submit" class="button button-primary">Confirm as evidence/u,
    );
  });

  it("keeps the confirmation closed when the host cannot create a base", () => {
    const html = render(false);
    expect(html).toContain("Save to");
    expect(html).toMatch(/<button type="submit" class="button button-primary" disabled="">/u);
  });
});
