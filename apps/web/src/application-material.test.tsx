import { HostApplicationPanel, HostPanelsContext } from "@draft-loop/ui/host-panels";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ApiRequestError } from "./api-client.js";
import {
  ApplicationMaterialView,
  type ApplicationMaterialViewProps,
} from "./application-material.js";
import {
  type ApplicationMaterialDraft,
  applicationMaterialFileName,
  applicationMaterialMarkdown,
  applicationMaterialProblem,
} from "./application-material-model.js";

// An invented draft.
const draft: ApplicationMaterialDraft = {
  kind: "interview-questions",
  items: [
    {
      question: "How do you report with SQL?",
      text: "As a Data Analyst I cut report time by 40%.",
      citations: [
        { fact_id: "t", text: "role title: Data Analyst" },
        { fact_id: "o", text: "achievement outcome: Cut report time by 40%" },
      ],
    },
  ],
  model: { provider: "anthropic", model: "claude-sonnet-5-5" },
  prompt_version: "application-material-v3",
  cost_usd: 0.002,
};

const props: ApplicationMaterialViewProps = {
  kind: "cover-letter",
  draft: undefined,
  problem: undefined,
  busy: false,
  onKind: () => {},
  onDraft: () => {},
  onDownload: () => {},
};

describe("the prepare panel", () => {
  it("names what it sends to Anthropic before the first draft", () => {
    const html = renderToStaticMarkup(<ApplicationMaterialView {...props} />);
    expect(html).toContain('<h2 id="material-heading">Prepare</h2>');
    expect(html).toContain("to Anthropic (Claude)");
    expect(html).toContain("name and contact details are never sent");
    expect(html).toContain('checked="" value="cover-letter"');
    expect(html).toContain("Interview questions");
    expect(html).not.toContain("Download Markdown");
  });

  it("shows each citation beside its item and offers the download", () => {
    const html = renderToStaticMarkup(
      <ApplicationMaterialView {...props} kind="interview-questions" draft={draft} />,
    );
    expect(html).toContain("<h3>How do you report with SQL?</h3>");
    expect(html).toContain('<aside aria-label="Sources"><ul><li>role title: Data Analyst</li>');
    expect(html).toContain("Download Markdown");
    expect(html).toContain("Draft again");
    expect(html).not.toContain("to Anthropic (Claude)");
  });

  it("shows a refusal in the panel while the controls stay usable", () => {
    const problem = applicationMaterialProblem(
      new ApiRequestError(503, "material_model_unavailable", "No route."),
    );
    const html = renderToStaticMarkup(<ApplicationMaterialView {...props} problem={problem} />);
    expect(html).toContain('<p role="alert">Drafting is not available on this server');
    expect(html).not.toContain("disabled");
  });

  it("renders only where the host fills the application slot", () => {
    expect(renderToStaticMarkup(<HostApplicationPanel applicationId="app_1" />)).toBe("");
    const html = renderToStaticMarkup(
      <HostPanelsContext.Provider
        value={{ application: ({ applicationId }) => <p>panel for {applicationId}</p> }}
      >
        <HostApplicationPanel applicationId="app_1" />
      </HostPanelsContext.Provider>,
    );
    expect(html).toBe("<p>panel for app_1</p>");
  });
});

describe("the prepare panel's model", () => {
  it("explains consent and invalid-draft refusals and falls back to the API's words", () => {
    expect(
      applicationMaterialProblem(new ApiRequestError(403, "consent_required", "Consent.")),
    ).toContain("permission to send career material to Anthropic");
    expect(applicationMaterialProblem(new ApiRequestError(422, "invalid_draft", "x"))).toContain(
      "was refused",
    );
    expect(applicationMaterialProblem(new ApiRequestError(429, "rate_limited", "Slow."))).toBe(
      "Slow.",
    );
    expect(applicationMaterialProblem(new TypeError("fetch failed"))).toContain(
      "could not be reached",
    );
  });

  it("downloads the draft as Markdown with its sources under each item", () => {
    expect(applicationMaterialFileName("cover-letter")).toBe("cover-letter.md");
    expect(applicationMaterialMarkdown(draft)).toBe(
      [
        "# Interview questions",
        "",
        "## 1. How do you report with SQL?",
        "",
        "As a Data Analyst I cut report time by 40%.",
        "",
        "> Source: role title: Data Analyst",
        "> Source: achievement outcome: Cut report time by 40%",
        "",
        "_Drafted by claude-sonnet-5-5 (anthropic). Check before use._",
        "",
      ].join("\n"),
    );
  });

  it("writes cover letter paragraphs without question headings", () => {
    const markdown = applicationMaterialMarkdown({
      ...draft,
      kind: "cover-letter",
      items: [{ question: "", text: "Paragraph.", citations: [] }],
    });
    expect(markdown.startsWith("# Cover letter\n\nParagraph.\n")).toBe(true);
    expect(markdown).not.toContain("## ");
  });
});
