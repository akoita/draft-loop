import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ApiRequestError } from "./api-client.js";
import { ResearchBriefView, type ResearchBriefViewProps } from "./research-brief.js";
import {
  type ResearchBrief,
  researchDisclosure,
  researchFindings,
  researchProblem,
  researchStateNote,
} from "./research-brief-model.js";

// An invented employer and invented pages.
const brief: ResearchBrief = {
  id: "rbr_fixture0001",
  application_id: "app_fixture0001",
  queries: ["Example Corp news"],
  from_date: "2025-11-08",
  sources: [
    {
      id: "src_1",
      kind: "web-result",
      url: "https://example.org/news",
      title: "Example Corp opens a clinic team",
      excerpt: "A fictional page.",
      published_on: "2026-10-03",
    },
    { id: "src_2", kind: "web-result", title: "About Example Corp", excerpt: "Undated." },
  ],
  findings: [
    {
      id: "fnd_1",
      text: "Example Corp builds tools for clinics.",
      source_ids: ["src_1", "src_2"],
    },
  ],
  dropped: { flagged: 1, outdated: 2 },
  search_provider: "claude",
  model: { provider: "anthropic", model: "claude-haiku-5-5" },
  cost_usd: 0.07,
  created_at: "2026-11-08T09:00:00.000Z",
};

const props: ResearchBriefViewProps = {
  brief: undefined,
  state: undefined,
  confirming: false,
  busy: false,
  problem: undefined,
  onStart: () => {},
  onApprove: () => {},
  onCancel: () => {},
  onDelete: () => {},
};

const render = (overrides: Partial<ResearchBriefViewProps>) =>
  renderToStaticMarkup(<ResearchBriefView {...props} {...overrides} />);

describe("research in the Prepare panel", () => {
  it("offers research and names what it sends, to whom and its cap before approval", () => {
    expect(render({})).toContain("Research this application");
    const approval = render({ confirming: true });
    expect(approval).toContain("Approve and research");
    expect(approval).toContain("Anthropic (Claude)");
    expect(approval).toContain("Nothing about you is sent");
    expect(approval).toContain("US$0.20");
    expect(researchDisclosure()).toContain("search provider");
  });

  it("shows each finding with dated sources, marks undated ones and offers delete", () => {
    const html = render({ brief, state: { status: "done", outcome: "researched" } });
    // Folded, so the Draft button stays near the tabs.
    expect(html).toMatch(
      /<details class="research-brief-details"><summary>Show 1 fact about the employer<\/summary>/u,
    );
    expect(html).toContain("Example Corp builds tools for clinics.");
    expect(html).toContain('href="https://example.org/news"');
    expect(html).toContain("2026-10-03");
    expect(html).toContain("undated");
    expect(html).toContain("3 dropped");
    expect(html).toContain("Delete this research");
    expect(html).toContain("Research again");
    expect(researchFindings(brief)[0]?.sources.map((source) => source.id)).toEqual([
      "src_1",
      "src_2",
    ]);
  });

  it("follows a run and explains each way it ends without a brief", () => {
    const pending = render({ state: { status: "pending" } });
    expect(pending).toContain("Researching");
    expect(pending).toMatch(/<button[^>]*disabled=""[^>]*>Research this application/u);
    expect(researchStateNote({ status: "failed" })).toContain("nothing was saved");
    expect(researchStateNote({ status: "done", outcome: "no-employer" })).toContain("no employer");
    expect(researchStateNote({ status: "done", outcome: "unavailable" })).toContain(
      "does not research",
    );
    expect(researchStateNote({ status: "done", outcome: "researched" })).toBeUndefined();
    expect(researchProblem(new ApiRequestError(503, "research_unavailable", "x"))).toContain(
      "does not research",
    );
  });
});
