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
  applicationMaterialGuidanceFor,
  applicationMaterialMarkdown,
  applicationMaterialModelLabel,
  applicationMaterialProblem,
  applicationMaterialReviewNote,
  applicationMaterialVersionLabel,
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
  prompt_version: "application-material-v4",
  cost_usd: 0.002,
};

const props: ApplicationMaterialViewProps = {
  kind: "cover-letter",
  draft: undefined,
  versions: [],
  problem: undefined,
  busy: false,
  guidance: {},
  onGuidance: () => {},
  models: [],
  modelId: undefined,
  onModel: () => {},
  samples: undefined,
  samplesSaved: true,
  onSamples: () => {},
  onSaveSamples: () => {},
  collapsed: false,
  onToggle: () => {},
  onKind: () => {},
  onDraft: () => {},
  onDownload: () => {},
  onSelect: () => {},
  onDelete: () => {},
};

const saved = (id: string, created_at: string): ApplicationMaterialDraft => ({
  ...draft,
  id,
  created_at,
});

describe("the prepare panel", () => {
  it("names what it sends to Anthropic before the first draft", () => {
    const html = renderToStaticMarkup(<ApplicationMaterialView {...props} />);
    expect(html).toContain('aria-expanded="true" aria-controls="material-body"');
    expect(html).toContain("Optional · cover letter or interview guide");
    expect(html).toContain("to Anthropic (Claude)");
    expect(html).toContain("name and contact details are never sent");
    expect(html).toContain("saved with this application");
    expect(html).toContain('aria-pressed="true">Cover letter</button>');
    expect(html).toContain('aria-pressed="false">Interview preparation guide</button>');
    expect(html).not.toContain(">Interview questions</button>");
    expect(html).toContain('class="button button-primary"');
    expect(html).not.toContain("Download Markdown");
  });

  it("folds to its heading row, which says it is optional", () => {
    const html = renderToStaticMarkup(<ApplicationMaterialView {...props} collapsed />);
    expect(html).toContain('aria-expanded="false" aria-controls="material-body"');
    expect(html).toContain("Optional · cover letter or interview guide");
    expect(html).toContain('<div id="material-body" class="application-material-body" hidden="">');
  });

  it("shows each citation beside its item and offers the download", () => {
    const html = renderToStaticMarkup(
      <ApplicationMaterialView {...props} kind="interview-guide" draft={draft} />,
    );
    expect(html).toContain("<h3>How do you report with SQL?</h3>");
    expect(html).toContain('<aside aria-label="Sources"><ul><li>role title: Data Analyst</li>');
    expect(html).toContain("Download Markdown");
    expect(html).toContain("Draft a new interview guide");
    expect(html).not.toContain("to Anthropic (Claude)");
  });

  it("offers earlier saved versions and deletes the one on screen", () => {
    const newest = saved("amd_fixture0002", "2026-11-07T10:00:00.000Z");
    const versions = [newest, saved("amd_fixture0001", "2026-11-07T09:00:00.000Z")];
    const html = renderToStaticMarkup(
      <ApplicationMaterialView
        {...props}
        kind="interview-guide"
        draft={newest}
        versions={versions}
      />,
    );
    expect(html).toContain("Version<select");
    expect(html).toContain('<option value="amd_fixture0002" selected="">');
    expect(html).toContain('<option value="amd_fixture0001">');
    expect(html).toContain("Delete this version");
    const single = renderToStaticMarkup(
      <ApplicationMaterialView {...props} draft={newest} versions={[newest]} />,
    );
    expect(single).not.toContain("Version<select");
    expect(single).toContain("Delete this version");
    const unsaved = renderToStaticMarkup(<ApplicationMaterialView {...props} draft={draft} />);
    expect(unsaved).not.toContain("Delete this version");
  });

  it("offers guidance, with an addressee for a cover letter only", () => {
    const html = renderToStaticMarkup(
      <ApplicationMaterialView {...props} guidance={{ emphasis: "Leadership", tone: "warm" }} />,
    );
    expect(html).toContain("Guide this draft (optional)");
    expect(html).toContain(">Leadership</textarea>");
    expect(html).toContain('<option value="warm" selected="">Warm</option>');
    expect(html).toContain("Address it to");
    expect(html).toContain("Every claim still comes from your career record.");
    const questions = renderToStaticMarkup(
      <ApplicationMaterialView {...props} kind="interview-guide" />,
    );
    expect(questions).not.toContain("Address it to");
  });

  it("shows a cover letter's writing check, and says it is not an AI detector", () => {
    const letter: ApplicationMaterialDraft = {
      ...draft,
      kind: "cover-letter",
      tells: [
        {
          code: "stock_phrase",
          paragraph: 0,
          sentence: "I am passionate about data.",
          match: "passionate about",
        },
        { code: "word_count", match: "120" },
      ],
    };
    const html = renderToStaticMarkup(<ApplicationMaterialView {...props} draft={letter} />);
    expect(html).toContain("<q>I am passionate about data.</q>");
    expect(html).toContain("Stock phrase &quot;passionate about&quot;");
    expect(html).toContain("The letter has 120 words: aim for 250 to 350.");
    expect(html).toContain("not an AI detector");
    const clean = renderToStaticMarkup(
      <ApplicationMaterialView {...props} draft={{ ...letter, tells: [] }} />,
    );
    expect(clean).toContain("No common machine-writing habit found.");
    expect(
      renderToStaticMarkup(<ApplicationMaterialView {...props} draft={draft} />),
    ).not.toContain("Writing check");
  });

  it("offers the server's models with their cost, the default selected", () => {
    const models = [
      { model_id: "claude-sonnet-5-5" as const, default: true, estimated_cost_usd: 0.048 },
      { model_id: "claude-haiku-5-5" as const, default: false, estimated_cost_usd: 0.004 },
    ];
    const html = renderToStaticMarkup(<ApplicationMaterialView {...props} models={models} />);
    expect(html).toContain(
      '<option value="claude-sonnet-5-5" selected="">Claude Sonnet (best writing), about US$0.05 a draft</option>',
    );
    expect(html).toContain("Claude Haiku (economy), under US$0.01 a draft");
    expect(renderToStaticMarkup(<ApplicationMaterialView {...props} />)).not.toContain(
      "Model<select",
    );
    expect(applicationMaterialModelLabel({ model_id: "claude-haiku-5-5", default: false })).toBe(
      "Claude Haiku (economy)",
    );
  });

  it("offers three sample fields when the server keeps samples, saved or not", () => {
    const html = renderToStaticMarkup(
      <ApplicationMaterialView
        {...props}
        samples={["An old letter I wrote."]}
        samplesSaved={false}
      />,
    );
    expect(html).toContain("Your writing samples");
    expect(html).toContain(">An old letter I wrote.</textarea>");
    expect(html.match(/aria-label="Writing sample \d"/gu)).toHaveLength(3);
    expect(html).toContain(">Save samples</button>");
    expect(html).toContain("never what the samples say");
    expect(renderToStaticMarkup(<ApplicationMaterialView {...props} />)).not.toContain(
      "Your writing samples",
    );
  });

  it("edits each paragraph in place and marks the candidate's own text", () => {
    const saved = {
      ...draft,
      id: "amd_editedversion01",
      created_at: "2026-11-08T03:00:00.000Z",
      based_on: "amd_draftedversion1",
      items: draft.items.map((item, index) =>
        index === 0 ? { ...item, edited: true, unsupported_numbers: ["12"] } : item,
      ),
    };
    const shown = renderToStaticMarkup(
      <ApplicationMaterialView {...props} draft={saved} versions={[saved]} onEdit={() => {}} />,
    );
    expect(shown).toContain("Edited by you");
    expect(shown).toContain("none of the sources states 12");
    expect(shown).toContain(">Edit</button>");
    const editing = renderToStaticMarkup(
      <ApplicationMaterialView
        {...props}
        draft={saved}
        versions={[saved]}
        onEdit={() => {}}
        edits={saved.items.map((item) => item.text)}
      />,
    );
    expect(editing.match(/aria-label="Item \d"/gu)).toHaveLength(saved.items.length);
    expect(editing).toContain(">Save as a new version</button>");
    expect(editing).not.toContain(">Edit</button>");
    expect(editing).toContain("Sources");
  });

  it("offers Word and PDF downloads of a saved draft with the template, Modern first", () => {
    const saved = { ...draft, id: "amd_savedversion001", created_at: "2026-11-08T03:00:00.000Z" };
    const html = renderToStaticMarkup(
      <ApplicationMaterialView
        {...props}
        draft={saved}
        versions={[saved]}
        template="modern"
        onDocument={() => {}}
      />,
    );
    expect(html).toContain(">Download Word</button>");
    expect(html).toContain(">Download PDF</button>");
    expect(html).toContain('<option value="modern" selected="">Modern</option>');
    expect(
      renderToStaticMarkup(
        <ApplicationMaterialView {...props} draft={draft} onDocument={() => {}} />,
      ),
    ).not.toContain("Download Word");
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

  it("says while the critic checks a letter, then shows what it flagged", () => {
    const checking = renderToStaticMarkup(
      <ApplicationMaterialView {...props} draft={{ ...draft, kind: "cover-letter" }} reviewing />,
    );
    expect(checking).toContain("A critic from another company is checking this letter");
    const revised: ApplicationMaterialDraft = {
      ...saved("amd_revisionfixture1", "2026-11-07T09:06:00.000Z"),
      kind: "cover-letter",
      based_on: "amd_fixture0001",
      critic_findings: [
        { paragraph: 0, sentence: "I am a passionate analyst.", reason: "stock word" },
      ],
      critic_model: { provider: "openai", model: "critic-model" },
    };
    const html = renderToStaticMarkup(
      <ApplicationMaterialView
        {...props}
        draft={revised}
        reviewNote={applicationMaterialReviewNote({ status: "done", outcome: "revised" })}
      />,
    );
    expect(html).toContain("What the critic flagged");
    expect(html).toContain("<q>I am a passionate analyst.</q> stock word");
    expect(html).toContain("The revised version is open");
    expect(applicationMaterialVersionLabel(revised, { locale: "en-GB", timeZone: "UTC" })).toBe(
      "7 Nov 2026, 09:06 · revised after the critic's check",
    );
    expect(applicationMaterialReviewNote({ status: "failed" })).toContain("stands as drafted");
    expect(applicationMaterialReviewNote({ status: "done", outcome: "kept" })).toContain(
      "does not support",
    );
    expect(applicationMaterialReviewNote({ status: "done", outcome: "skipped" })).toBeUndefined();
    expect(applicationMaterialReviewNote({ status: "none" })).toBeUndefined();
  });

  it("lists the sentences a free-form letter left out", () => {
    const html = renderToStaticMarkup(
      <ApplicationMaterialView
        {...props}
        draft={{ ...draft, kind: "cover-letter", dropped_sentences: ["I led a team of 40."] }}
      />,
    );
    expect(html).toContain("Left out");
    expect(html).toContain("<q>I led a team of 40.</q>");
    expect(
      renderToStaticMarkup(<ApplicationMaterialView {...props} draft={draft} />),
    ).not.toContain("Left out");
  });

  it("names a saved version by its time and model", () => {
    expect(
      applicationMaterialVersionLabel(saved("amd_fixture0001", "2026-11-07T09:05:00.000Z"), {
        locale: "en-GB",
        timeZone: "UTC",
      }),
    ).toBe("7 Nov 2026, 09:05 · claude-sonnet-5-5");
    expect(applicationMaterialVersionLabel(draft)).toBe("Unsaved draft");
  });

  it("sends only the guidance the candidate filled in for the kind", () => {
    expect(applicationMaterialGuidanceFor("cover-letter", {})).toBeUndefined();
    expect(applicationMaterialGuidanceFor("cover-letter", { emphasis: "  " })).toBeUndefined();
    expect(
      applicationMaterialGuidanceFor("interview-questions", {
        emphasis: " Leadership ",
        addressee: "Team",
        length: "short",
      }),
    ).toEqual({ emphasis: "Leadership", length: "short" });
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
